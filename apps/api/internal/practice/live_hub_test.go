package practice

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
)

func TestLiveHubAdmission(t *testing.T) {
	ctx := context.Background()

	t.Run("a full instance says busy instead of taking one more", func(t *testing.T) {
		h := NewLiveHub(2, nil)
		a, err := h.admit(ctx, uuid.New())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := h.admit(ctx, uuid.New()); err != nil {
			t.Fatal(err)
		}
		_, err = h.admit(ctx, uuid.New())
		if apperr.From(err).Code != apperr.CodeUnavailable {
			t.Fatalf("third admit: %v, want SERVICE_UNAVAILABLE", err)
		}
		a.release()
		if _, err := h.admit(ctx, uuid.New()); err != nil {
			t.Fatalf("after a release there is room again: %v", err)
		}
	})

	t.Run("a burst never overshoots capacity", func(t *testing.T) {
		const capacity, arrivals = 100, 1000
		h := NewLiveHub(capacity, nil)
		var admitted atomic.Int64
		var wg sync.WaitGroup
		for range arrivals {
			wg.Go(func() {
				if _, err := h.admit(ctx, uuid.New()); err == nil {
					admitted.Add(1)
				}
			})
		}
		wg.Wait()
		if admitted.Load() != capacity {
			t.Fatalf("admitted %d of %d arrivals, want exactly %d", admitted.Load(), arrivals, capacity)
		}
		if got := h.Stats(); got.Active != capacity || got.Rejected != arrivals-capacity {
			t.Fatalf("stats = %+v", got)
		}
	})

	t.Run("one learner holds one conversation", func(t *testing.T) {
		h := NewLiveHub(10, nil)
		learner := uuid.New()
		first, err := h.admit(ctx, learner)
		if err != nil {
			t.Fatal(err)
		}
		_, err = h.admit(ctx, learner)
		if apperr.From(err).Code != apperr.CodeConflict {
			t.Fatalf("second tab: %v, want CONFLICT", err)
		}
		first.release()
		first.release() // releasing twice is harmless
		if _, err := h.admit(ctx, learner); err != nil {
			t.Fatalf("after closing the first tab: %v", err)
		}
		if got := h.Stats().Active; got != 1 {
			t.Fatalf("active = %d, want 1 (a double release must not free a slot twice)", got)
		}
	})

	t.Run("a draining instance admits nobody", func(t *testing.T) {
		h := NewLiveHub(10, nil)
		h.Drain(ctx)
		if _, err := h.admit(ctx, uuid.New()); apperr.From(err).Code != apperr.CodeUnavailable {
			t.Fatalf("admit while draining: %v, want SERVICE_UNAVAILABLE", err)
		}
	})
}
