package jobs

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
)

// MemoryQueue is an in-process Queue for tests. It is not durable.
type MemoryQueue struct {
	ch     chan Job
	mu     sync.Mutex
	states map[uuid.UUID]State
}

func NewMemoryQueue(buffer int) *MemoryQueue {
	return &MemoryQueue{ch: make(chan Job, buffer), states: map[uuid.UUID]State{}}
}

func (q *MemoryQueue) Enqueue(ctx context.Context, job Job) error {
	q.put(stateOf(&job, StatusQueued))
	select {
	case q.ch <- job:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (q *MemoryQueue) Reserve(ctx context.Context, wait time.Duration) (*Job, error) {
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case job := <-q.ch:
		job.Attempts++
		q.put(stateOf(&job, StatusRunning))
		return &job, nil
	case <-timer.C:
		return nil, nil
	case <-ctx.Done():
		return nil, nil
	}
}

func (q *MemoryQueue) Finish(ctx context.Context, job *Job, out Outcome) error {
	s := stateOf(job, out.Status)
	s.ErrorCode, s.Result = out.ErrorCode, out.Result
	q.put(s)
	if out.Status == StatusRetrying {
		select {
		case q.ch <- *job:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

func (q *MemoryQueue) State(_ context.Context, id uuid.UUID) (*State, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	s, ok := q.states[id]
	if !ok {
		return nil, ErrStateNotFound
	}
	return &s, nil
}

func (q *MemoryQueue) put(s State) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.states[s.ID] = s
}
