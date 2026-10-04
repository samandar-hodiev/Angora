package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/samandar-hodiev/engora/apps/api/internal/platform/cache"
)

// RedisQueue is a reliable list-based queue: Reserve atomically moves a job to a
// processing list (BLMOVE), so a crashed worker leaves the job recoverable instead of
// losing it. Delayed retries and a stale-job reaper are natural next steps.
type RedisQueue struct {
	client     *redis.Client
	queue      string
	processing string
	dead       string
	name       string
	stateTTL   time.Duration
}

func NewRedisQueue(client *redis.Client, name string) *RedisQueue {
	return &RedisQueue{
		client:     client,
		name:       name,
		queue:      cache.Key("jobs", name, "queue"),
		processing: cache.Key("jobs", name, "processing"),
		dead:       cache.Key("jobs", name, "dead"),
		stateTTL:   7 * 24 * time.Hour,
	}
}

func (q *RedisQueue) stateKey(id uuid.UUID) string {
	return cache.Key("jobs", q.name, "state", id.String())
}

func (q *RedisQueue) Enqueue(ctx context.Context, job Job) error {
	raw, err := json.Marshal(job)
	if err != nil {
		return err
	}
	state, err := json.Marshal(stateOf(&job, StatusQueued))
	if err != nil {
		return err
	}
	_, err = q.client.TxPipelined(ctx, func(p redis.Pipeliner) error {
		p.Set(ctx, q.stateKey(job.ID), state, q.stateTTL)
		p.LPush(ctx, q.queue, raw)
		return nil
	})
	if err != nil {
		return fmt.Errorf("enqueue job: %w", err)
	}
	return nil
}

// reservePoll is how often Reserve looks for a job while it waits.
const reservePoll = 500 * time.Millisecond

// Reserve takes the next job, waiting up to wait for one to arrive.
//
// It polls with LMOVE rather than blocking with BLMOVE. A blocked call needs the server to
// time it out on schedule, and a Redis whose timers are coalesced — a background service on
// a laptop — answers seconds late; the client's read deadline fires first, the worker logs
// an i/o timeout every few seconds, and a job the server moved after the client gave up sits
// in the processing list with nobody working on it. A poll cannot strand a job that way.
func (q *RedisQueue) Reserve(ctx context.Context, wait time.Duration) (*Job, error) {
	deadline := time.Now().Add(wait)
	var raw string
	for {
		var err error
		raw, err = q.client.LMove(ctx, q.queue, q.processing, "RIGHT", "LEFT").Result()
		if err == nil {
			break
		}
		if !errors.Is(err, redis.Nil) {
			return nil, err
		}
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return nil, nil
		}
		select {
		case <-ctx.Done():
			return nil, nil
		case <-time.After(min(reservePoll, remaining)):
		}
	}
	var job Job
	if err := json.Unmarshal([]byte(raw), &job); err != nil {
		// Unreadable payloads can never succeed; park them for inspection.
		_, _ = q.client.TxPipelined(ctx, func(p redis.Pipeliner) error {
			p.LRem(ctx, q.processing, 1, raw)
			p.LPush(ctx, q.dead, raw)
			return nil
		})
		return nil, fmt.Errorf("decode job: %w", err)
	}
	job.raw = raw
	job.Attempts++
	if err := q.setState(ctx, stateOf(&job, StatusRunning)); err != nil {
		return nil, err
	}
	return &job, nil
}

func (q *RedisQueue) Finish(ctx context.Context, job *Job, out Outcome) error {
	state := stateOf(job, out.Status)
	state.ErrorCode = out.ErrorCode
	state.Result = out.Result
	stateRaw, err := json.Marshal(state)
	if err != nil {
		return err
	}
	var requeue []byte
	if out.Status == StatusRetrying {
		if requeue, err = json.Marshal(job); err != nil {
			return err
		}
	}

	_, err = q.client.TxPipelined(ctx, func(p redis.Pipeliner) error {
		p.LRem(ctx, q.processing, 1, job.raw)
		p.Set(ctx, q.stateKey(job.ID), stateRaw, q.stateTTL)
		switch out.Status {
		case StatusRetrying:
			p.LPush(ctx, q.queue, requeue)
		case StatusFailed:
			p.LPush(ctx, q.dead, job.raw)
		}
		return nil
	})
	return err
}

func (q *RedisQueue) State(ctx context.Context, id uuid.UUID) (*State, error) {
	raw, err := q.client.Get(ctx, q.stateKey(id)).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, ErrStateNotFound
	}
	if err != nil {
		return nil, err
	}
	var s State
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func (q *RedisQueue) setState(ctx context.Context, s State) error {
	raw, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return q.client.Set(ctx, q.stateKey(s.ID), raw, q.stateTTL).Err()
}
