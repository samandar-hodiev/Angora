package ai_test

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/ai/providers/mock"
)

// slowProvider counts how many calls are in flight at once.
type slowProvider struct {
	*mock.Provider
	inFlight, peak atomic.Int64
	fail           atomic.Int64 // calls left that answer 429
	calls          atomic.Int64
}

func (p *slowProvider) GenerateText(ctx context.Context, req ai.TextRequest) (*ai.TextResponse, error) {
	p.calls.Add(1)
	n := p.inFlight.Add(1)
	defer p.inFlight.Add(-1)
	for {
		peak := p.peak.Load()
		if n <= peak || p.peak.CompareAndSwap(peak, n) {
			break
		}
	}
	if p.fail.Add(-1) >= 0 {
		return nil, &ai.ProviderError{StatusCode: 429}
	}
	select {
	case <-time.After(40 * time.Millisecond):
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return p.Provider.GenerateText(ctx, req)
}

func newLimitedGateway(t *testing.T, p ai.Provider, cfg ai.GatewayConfig) *ai.Gateway {
	t.Helper()
	cfg.DefaultProvider = p.Name()
	g, err := ai.NewGateway(cfg, ai.NopRecorder{}, slog.New(slog.DiscardHandler), p)
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func TestGatewayLoadProtection(t *testing.T) {
	meta := ai.CallMeta{Task: ai.TaskRealtimeConversation}
	req := ai.TextRequest{Messages: []ai.Message{{Role: "user", Content: "hi"}}}

	t.Run("calls in flight never exceed the cap", func(t *testing.T) {
		p := &slowProvider{Provider: mock.New()}
		g := newLimitedGateway(t, p, ai.GatewayConfig{MaxConcurrent: 5, QueueWait: 5 * time.Second})
		var wg sync.WaitGroup
		for range 50 {
			wg.Go(func() {
				if _, err := g.GenerateText(context.Background(), meta, req); err != nil {
					t.Error(err)
				}
			})
		}
		wg.Wait()
		if peak := p.peak.Load(); peak > 5 {
			t.Fatalf("peak in flight = %d, want at most 5", peak)
		}
	})

	t.Run("no slot in time is reported as busy, not as an outage", func(t *testing.T) {
		p := &slowProvider{Provider: mock.New()}
		g := newLimitedGateway(t, p, ai.GatewayConfig{MaxConcurrent: 1, QueueWait: 5 * time.Millisecond})
		var busy atomic.Int64
		var wg sync.WaitGroup
		for range 10 {
			wg.Go(func() {
				if _, err := g.GenerateText(context.Background(), meta, req); err != nil {
					if !errors.Is(err, ai.ErrBusy) {
						t.Errorf("err = %v, want ErrBusy", err)
					}
					busy.Add(1)
				}
			})
		}
		wg.Wait()
		if busy.Load() == 0 {
			t.Fatal("ten calls through one slot with a 5 ms wait: some must be turned away")
		}
	})

	t.Run("a rate-limited call is retried once", func(t *testing.T) {
		p := &slowProvider{Provider: mock.New()}
		p.fail.Store(1)
		g := newLimitedGateway(t, p, ai.GatewayConfig{MaxConcurrent: 1, QueueWait: time.Second})
		if _, err := g.GenerateText(context.Background(), meta, req); err != nil {
			t.Fatalf("a single 429 must be absorbed by the retry: %v", err)
		}
		if calls := p.calls.Load(); calls != 2 {
			t.Errorf("calls = %d, want 2", calls)
		}
	})

	t.Run("a hung vendor is cut off by the call timeout", func(t *testing.T) {
		g := newLimitedGateway(t, &mock.Provider{Latency: time.Hour}, ai.GatewayConfig{CallTimeout: 50 * time.Millisecond})
		start := time.Now()
		if _, err := g.GenerateText(context.Background(), meta, req); err == nil {
			t.Fatal("a call to a vendor that never answers succeeded")
		}
		if waited := time.Since(start); waited > time.Second {
			t.Fatalf("waited %v for a 50 ms timeout", waited)
		}
	})
}
