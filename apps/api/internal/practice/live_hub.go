package practice

import (
	"context"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
)

// LiveHub is the live coach's admission desk and switchboard for one API instance.
//
// It exists because a WebSocket is not a request. An HTTP handler that gets slow is a slow
// page; a thousand open conversations that all get slow is a thousand learners talking to a
// coach who has stopped answering. So the hub decides, before a connection is upgraded,
// whether there is room for one more conversation — and says "busy, try again in a minute"
// when there is not, which is a better answer than a coach who takes twenty seconds a turn.
//
// It also makes sure one learner holds one conversation, across every instance (a lock in
// Redis), so ten open tabs cannot spend ten times the budget; and on shutdown it lets turns
// in progress finish and tells everyone else to reconnect, instead of the deploy cutting
// learners off mid-sentence. http.Server.Shutdown does not wait for hijacked connections —
// without this, every deploy would drop every conversation.
type LiveHub struct {
	max   int
	redis *redis.Client

	mu sync.Mutex
	// reserved counts admitted conversations, from admission to release. Capacity is
	// checked against it, not against sessions: a burst of a thousand learners arriving at
	// once would all pass a check made before any of their connections was upgraded.
	reserved int
	sessions map[*liveSession]struct{}
	// local backs the per-learner lock when there is no Redis (tests, a single dev
	// instance). It is per instance, which is all a single instance needs.
	local    map[uuid.UUID]struct{}
	draining atomic.Bool
	empty    chan struct{}

	// Counters for the metrics page and load tests.
	admitted atomic.Int64
	rejected atomic.Int64
	turns    atomic.Int64
	turnErrs atomic.Int64
	latency  latencyWindow
}

const (
	liveLockTTL     = 60 * time.Second
	liveLockRefresh = 20 * time.Second
)

// NewLiveHub sizes the hub. A nil Redis client keeps the per-learner lock in memory.
func NewLiveHub(maxSessions int, rdb *redis.Client) *LiveHub {
	if maxSessions <= 0 {
		maxSessions = 1500
	}
	return &LiveHub{
		max: maxSessions, redis: rdb,
		sessions: map[*liveSession]struct{}{}, local: map[uuid.UUID]struct{}{},
	}
}

// liveTicket is an admitted conversation's place in the hub. release gives it back.
type liveTicket struct {
	hub    *LiveHub
	userID uuid.UUID
	token  string
	stop   chan struct{}
	once   sync.Once
}

// admit reserves room for one conversation for userID, or explains why there is none.
func (h *LiveHub) admit(ctx context.Context, userID uuid.UUID) (*liveTicket, error) {
	if h.draining.Load() {
		h.rejected.Add(1)
		return nil, apperr.New(apperr.CodeUnavailable, "The coach is restarting. Try again in a few seconds.")
	}
	h.mu.Lock()
	if h.reserved >= h.max {
		h.mu.Unlock()
		h.rejected.Add(1)
		return nil, apperr.New(apperr.CodeUnavailable, "The coach is busy right now. Try again in a minute.")
	}
	h.reserved++
	h.mu.Unlock()

	t := &liveTicket{hub: h, userID: userID, token: uuid.NewString(), stop: make(chan struct{})}
	if err := h.lock(ctx, t); err != nil {
		h.unreserve()
		h.rejected.Add(1)
		return nil, err
	}
	go t.keepAlive()
	h.admitted.Add(1)
	return t, nil
}

// check answers "could this learner start a conversation now?" without reserving anything —
// the browser cannot read why a WebSocket upgrade was refused, so the client asks first.
func (h *LiveHub) check(ctx context.Context, userID uuid.UUID) error {
	if h.draining.Load() {
		return apperr.New(apperr.CodeUnavailable, "The coach is restarting. Try again in a few seconds.")
	}
	h.mu.Lock()
	full := h.reserved >= h.max
	_, heldLocally := h.local[userID]
	h.mu.Unlock()
	if full {
		return apperr.New(apperr.CodeUnavailable, "The coach is busy right now. Try again in a minute.")
	}
	held := heldLocally
	if h.redis != nil {
		if n, err := h.redis.Exists(ctx, h.lockKey(userID)).Result(); err == nil {
			held = n > 0
		}
	}
	if held {
		return apperr.Conflict("A conversation with your coach is already open in another tab or device. Close it, then try again.")
	}
	return nil
}

func (h *LiveHub) lockKey(userID uuid.UUID) string { return "live:session:" + userID.String() }

func (h *LiveHub) lock(ctx context.Context, t *liveTicket) error {
	busy := apperr.Conflict("A conversation with your coach is already open in another tab or device. Close it, then try again.")
	if h.redis == nil {
		h.mu.Lock()
		defer h.mu.Unlock()
		if _, held := h.local[t.userID]; held {
			return busy
		}
		h.local[t.userID] = struct{}{}
		return nil
	}
	ok, err := h.redis.SetNX(ctx, h.lockKey(t.userID), t.token, liveLockTTL).Result()
	if err != nil {
		// Redis being down must not take the coach down with it: admit, unlocked. The
		// worst case is a learner with two tabs, which the budget still bounds.
		return nil
	}
	if !ok {
		return busy
	}
	return nil
}

// keepAlive refreshes the Redis lock while the conversation lives. The TTL is what frees
// the lock if this instance dies without releasing it.
func (t *liveTicket) keepAlive() {
	if t.hub.redis == nil {
		return
	}
	tick := time.NewTicker(liveLockRefresh)
	defer tick.Stop()
	for {
		select {
		case <-t.stop:
			return
		case <-tick.C:
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			_ = refreshLock.Run(ctx, t.hub.redis, []string{t.hub.lockKey(t.userID)}, t.token, int(liveLockTTL.Milliseconds())).Err()
			cancel()
		}
	}
}

// Compare-and-act scripts: only the holder of the token may refresh or delete the lock, so
// a conversation whose lock expired and was taken over cannot release the new one.
var (
	refreshLock = redis.NewScript(`
if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("PEXPIRE", KEYS[1], ARGV[2]) end
return 0`)
	releaseLock = redis.NewScript(`
if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end
return 0`)
)

func (h *LiveHub) unreserve() {
	h.mu.Lock()
	h.reserved--
	h.mu.Unlock()
}

func (t *liveTicket) release() {
	t.once.Do(func() {
		close(t.stop)
		h := t.hub
		h.unreserve()
		if h.redis == nil {
			h.mu.Lock()
			delete(h.local, t.userID)
			h.mu.Unlock()
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = releaseLock.Run(ctx, h.redis, []string{h.lockKey(t.userID)}, t.token).Err()
	})
}

func (h *LiveHub) register(s *liveSession) {
	h.mu.Lock()
	h.sessions[s] = struct{}{}
	h.mu.Unlock()
}

func (h *LiveHub) unregister(s *liveSession) {
	h.mu.Lock()
	delete(h.sessions, s)
	if len(h.sessions) == 0 && h.empty != nil {
		close(h.empty)
		h.empty = nil
	}
	h.mu.Unlock()
}

// Draining reports whether the instance is shutting down.
func (h *LiveHub) Draining() bool { return h.draining.Load() }

// Drain stops admitting conversations, wakes idle ones so they can tell their learner to
// reconnect, and waits until every conversation has ended or ctx is done. Turns already in
// progress are allowed to finish: the learner spoke, and the answer is on its way.
func (h *LiveHub) Drain(ctx context.Context) {
	h.draining.Store(true)

	h.mu.Lock()
	if len(h.sessions) == 0 {
		h.mu.Unlock()
		return
	}
	done := make(chan struct{})
	h.empty = done
	for s := range h.sessions {
		s.wake()
	}
	h.mu.Unlock()

	select {
	case <-done:
	case <-ctx.Done():
		// Out of time: close what is left. Their turns are saved by abandon as usual.
		h.mu.Lock()
		for s := range h.sessions {
			s.closeNow()
		}
		h.mu.Unlock()
	}
}

// LiveStats is the hub's state for the system metrics page.
type LiveStats struct {
	Active        int     `json:"active"`
	Capacity      int     `json:"capacity"`
	Draining      bool    `json:"draining"`
	Admitted      int64   `json:"admitted"`
	Rejected      int64   `json:"rejected"`
	Turns         int64   `json:"turns"`
	TurnErrors    int64   `json:"turn_errors"`
	TurnLatencyMs Latency `json:"turn_latency_ms"`
}

func (h *LiveHub) Stats() LiveStats {
	h.mu.Lock()
	active := h.reserved
	h.mu.Unlock()
	return LiveStats{
		Active: active, Capacity: h.max, Draining: h.draining.Load(),
		Admitted: h.admitted.Load(), Rejected: h.rejected.Load(),
		Turns: h.turns.Load(), TurnErrors: h.turnErrs.Load(), TurnLatencyMs: h.latency.percentiles(),
	}
}

func (h *LiveHub) observeTurn(d time.Duration, failed bool) {
	h.turns.Add(1)
	if failed {
		h.turnErrs.Add(1)
		return
	}
	h.latency.add(d)
}

// ---- latency window ---------------------------------------------------------------------------

// Latency is a summary of recent turn times, in milliseconds.
type Latency struct {
	P50 int64 `json:"p50"`
	P95 int64 `json:"p95"`
	P99 int64 `json:"p99"`
	N   int   `json:"n"`
}

// latencyWindow keeps the last few thousand turn times. Recent is what matters on a metrics
// page: "how slow is the coach now", not since the process started.
type latencyWindow struct {
	mu   sync.Mutex
	buf  [2048]int64
	next int
	full bool
}

func (w *latencyWindow) add(d time.Duration) {
	w.mu.Lock()
	w.buf[w.next] = d.Milliseconds()
	w.next = (w.next + 1) % len(w.buf)
	if w.next == 0 {
		w.full = true
	}
	w.mu.Unlock()
}

func (w *latencyWindow) percentiles() Latency {
	w.mu.Lock()
	n := w.next
	if w.full {
		n = len(w.buf)
	}
	vals := make([]int64, n)
	copy(vals, w.buf[:n])
	w.mu.Unlock()
	if n == 0 {
		return Latency{}
	}
	slices.Sort(vals)
	at := func(q float64) int64 { return vals[min(n-1, int(q*float64(n)))] }
	return Latency{P50: at(0.50), P95: at(0.95), P99: at(0.99), N: n}
}
