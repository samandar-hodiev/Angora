package jobs

import (
	"context"
	"sync"
)

// Progress is how far a running job has got: Done of Total steps. Optional — most jobs are
// over in seconds and never report any; a long one (a grammar topic in three languages and
// six levels) reports each step so the page can show a real percentage, not a guess.
type Progress struct {
	Done  int `json:"done"`
	Total int `json:"total"`
}

// ProgressRecorder is a queue that can store a running job's progress. Both queues here
// implement it; one that does not simply has jobs that report nothing.
type ProgressRecorder interface {
	SetProgress(ctx context.Context, job *Job, p Progress) error
}

type progressKey struct{}

// Tracker counts a job's steps and records each one. Safe for concurrent steps.
type Tracker struct {
	mu     sync.Mutex
	done   int
	total  int
	report func(Progress)
}

// TrackerFrom returns the job's tracker, or one that records nowhere when the job has none
// (a test, or a queue without progress), so callers never have to check.
func TrackerFrom(ctx context.Context) *Tracker {
	if t, ok := ctx.Value(progressKey{}).(*Tracker); ok {
		return t
	}
	return &Tracker{report: func(Progress) {}}
}

// SetTotal fixes how many steps the job has and reports where it stands.
func (t *Tracker) SetTotal(total int) {
	t.mu.Lock()
	t.total = total
	p := Progress{Done: t.done, Total: t.total}
	t.mu.Unlock()
	t.report(p)
}

// Step marks one step done.
func (t *Tracker) Step() {
	t.mu.Lock()
	t.done++
	if t.total < t.done {
		t.total = t.done
	}
	p := Progress{Done: t.done, Total: t.total}
	t.mu.Unlock()
	t.report(p)
}

func withTracker(ctx context.Context, queue Queue, job *Job) context.Context {
	recorder, ok := queue.(ProgressRecorder)
	if !ok {
		return ctx
	}
	// Recorded on the parent context: a step reported as the job times out still lands.
	store := context.WithoutCancel(ctx)
	return context.WithValue(ctx, progressKey{}, &Tracker{report: func(p Progress) {
		_ = recorder.SetProgress(store, job, p)
	}})
}
