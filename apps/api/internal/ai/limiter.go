package ai

import (
	"context"
	"errors"
	"math/rand/v2"
	"sync"
	"time"
)

// ErrBusy means no capacity was free for the call within the queue wait.
var ErrBusy = errors.New("ai: at capacity")

// taskLimiter is one counting semaphore per task. Pools are created on first use, so a
// task nobody calls costs nothing.
type taskLimiter struct {
	max   int
	mu    sync.Mutex
	pools map[Task]chan struct{}
}

func newTaskLimiter(max int) *taskLimiter {
	return &taskLimiter{max: max, pools: map[Task]chan struct{}{}}
}

func (l *taskLimiter) pool(task Task) chan struct{} {
	l.mu.Lock()
	defer l.mu.Unlock()
	p, ok := l.pools[task]
	if !ok {
		p = make(chan struct{}, l.max)
		l.pools[task] = p
	}
	return p
}

// acquire takes a slot for task, waiting at most wait. The returned release must be called
// exactly once.
func (l *taskLimiter) acquire(ctx context.Context, task Task, wait time.Duration) (func(), error) {
	if l.max <= 0 {
		return func() {}, nil
	}
	p := l.pool(task)
	release := func() { <-p }

	select {
	case p <- struct{}{}:
		return release, nil
	default:
	}
	if wait <= 0 {
		return nil, ErrBusy
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case p <- struct{}{}:
		return release, nil
	case <-timer.C:
		return nil, ErrBusy
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (l *taskLimiter) inFlight(task Task) int { return len(l.pool(task)) }

func (l *taskLimiter) snapshot() map[Task]int {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make(map[Task]int, len(l.pools))
	for task, p := range l.pools {
		out[task] = len(p)
	}
	return out
}

func retryable(err error) bool {
	var pe *ProviderError
	return errors.As(err, &pe) && (pe.StatusCode == 429 || pe.StatusCode >= 500)
}

// retryDelay is jittered so that a burst of rate-limited calls does not come back as the
// same burst.
func retryDelay() time.Duration {
	return 300*time.Millisecond + time.Duration(rand.IntN(500))*time.Millisecond
}
