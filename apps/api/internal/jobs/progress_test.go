package jobs

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// A job's steps land on its state as it runs, so a page polling it can show a percentage.
func TestTrackerRecordsProgressOnTheJobState(t *testing.T) {
	q := NewMemoryQueue(1)
	job := &Job{ID: uuid.New(), Type: "x"}
	ctx := withTracker(context.Background(), q, job)

	tracker := TrackerFrom(ctx)
	tracker.SetTotal(4)
	tracker.Step()
	tracker.Step()

	s, err := q.State(ctx, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if s.Progress == nil || s.Progress.Done != 2 || s.Progress.Total != 4 {
		t.Fatalf("progress = %+v, want 2 of 4", s.Progress)
	}
}

// Without a tracker in the context, reporting is a no-op rather than a nil dereference.
func TestTrackerFromAnEmptyContextIsSafe(t *testing.T) {
	tracker := TrackerFrom(context.Background())
	tracker.SetTotal(3)
	tracker.Step()
}
