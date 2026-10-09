// Command live-loadtest opens many live speaking coach conversations at once and reports how
// the coach holds up: how many learners got in, how long each turn took, and what failed.
//
// It talks to a running API exactly as the browser does — a WebSocket with the access token
// in Sec-WebSocket-Protocol, a binary audio frame per turn, then turn_end — so what it
// measures is the real path: admission, storage, transcription, judging, the follow-up
// question and the database writes. Run the API with the mock provider and a realistic
// latency so the AI side behaves like a vendor without costing anything:
//
//	AI_PROVIDER=mock MOCK_AI_LATENCY=800ms go run ./cmd/server
//
//	go run ./cmd/live-loadtest setup -users 1000       # load-test learners on a live-coach plan
//	go run ./cmd/live-loadtest run   -users 1000 -turns 3 -ramp 30s
//	go run ./cmd/live-loadtest teardown                # delete them again
//
// It refuses to run against APP_ENV=production: setup writes accounts and subscriptions.
package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/samandar-hodiev/engora/apps/api/internal/auth"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
)

const emailDomain = "@loadtest.engora.local"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "live-loadtest:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	for _, f := range []string{".env", "../../.env"} {
		if _, err := os.Stat(f); err == nil {
			_ = godotenv.Load(f)
		}
	}
	if os.Getenv("APP_ENV") == "production" {
		return errors.New("refusing to run against a production environment")
	}
	if len(args) == 0 {
		return errors.New("usage: live-loadtest setup|run|teardown [flags]")
	}

	fs := flag.NewFlagSet(args[0], flag.ExitOnError)
	users := fs.Int("users", 1000, "concurrent learners")
	turns := fs.Int("turns", 3, "turns each learner speaks")
	ramp := fs.Duration("ramp", 30*time.Second, "time over which learners arrive")
	think := fs.Duration("think", 2*time.Second, "pause between a reply and the next turn")
	url := fs.String("url", "ws://localhost:8000/api/v1/speaking/live", "live coach WebSocket URL")
	plan := fs.String("plan", "ielts_pro", "subscription plan given to load-test learners")
	_ = fs.Parse(args[1:])

	ctx := context.Background()
	switch args[0] {
	case "setup":
		pool, err := connect(ctx)
		if err != nil {
			return err
		}
		defer pool.Close()
		return setup(ctx, pool, *users, *plan)
	case "teardown":
		pool, err := connect(ctx)
		if err != nil {
			return err
		}
		defer pool.Close()
		return teardown(ctx, pool)
	case "run":
		pool, err := connect(ctx)
		if err != nil {
			return err
		}
		ids, err := learnerIDs(ctx, pool, *users)
		pool.Close()
		if err != nil {
			return err
		}
		if len(ids) < *users {
			return fmt.Errorf("only %d load-test learners exist; run setup -users %d first", len(ids), *users)
		}
		return load(ids, *url, *turns, *ramp, *think)
	default:
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func connect(ctx context.Context) (*pgxpool.Pool, error) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return nil, errors.New("DATABASE_URL is not set")
	}
	return pgxpool.New(ctx, url)
}

// ---- setup / teardown -------------------------------------------------------------------------

func setup(ctx context.Context, pool *pgxpool.Pool, n int, plan string) error {
	start := time.Now()
	_, err := pool.Exec(ctx, `
		WITH new_users AS (
			INSERT INTO users (email, role, status, email_verified_at)
			SELECT 'loadtest-' || lpad(g::text, 5, '0') || $2, 'USER', 'active', now()
			FROM generate_series(1, $1) g
			ON CONFLICT ((lower(email))) DO NOTHING
			RETURNING id
		)
		INSERT INTO profiles (user_id, display_name)
		SELECT id, 'Load test' FROM new_users
		ON CONFLICT DO NOTHING`, n, emailDomain)
	if err != nil {
		return fmt.Errorf("create learners: %w", err)
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO subscriptions (user_id, plan_id, status, current_period_start, current_period_end)
		SELECT u.id, (SELECT id FROM subscription_plans WHERE code = $2), 'active', now(), now() + interval '30 days'
		FROM users u
		WHERE u.email LIKE '%' || $1
		  AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status IN ('trialing','active','past_due'))`,
		emailDomain, plan)
	if err != nil {
		return fmt.Errorf("subscribe learners: %w", err)
	}
	// Daily AI budgets are per learner per day; repeated runs on one day would exhaust them
	// and the test would measure the paywall instead of the coach.
	if _, err := pool.Exec(ctx, `
		DELETE FROM usage_counters WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%' || $1)`, emailDomain); err != nil {
		return fmt.Errorf("reset budgets: %w", err)
	}
	var total int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE email LIKE '%' || $1`, emailDomain).Scan(&total)
	fmt.Printf("%d load-test learners on %s, ready in %v\n", total, plan, time.Since(start).Round(time.Millisecond))
	return nil
}

func teardown(ctx context.Context, pool *pgxpool.Pool) error {
	// The recordings first, while the rows still say whose they are. Local storage keeps
	// each learner's audio under audio/<user id>/, so the whole directory goes.
	if strings.EqualFold(envOr("STORAGE_PROVIDER", "local"), "local") {
		ids, err := learnerIDs(ctx, pool, 1<<20)
		if err != nil {
			return err
		}
		dir := envOr("STORAGE_LOCAL_DIR", "./var/storage")
		for _, id := range ids {
			_ = os.RemoveAll(filepath.Join(dir, "audio", id.String()))
		}
	}
	tag, err := pool.Exec(ctx, `DELETE FROM users WHERE email LIKE '%' || $1`, emailDomain)
	if err != nil {
		return err
	}
	fmt.Printf("deleted %d load-test learners and everything they recorded\n", tag.RowsAffected())
	return nil
}

func learnerIDs(ctx context.Context, pool *pgxpool.Pool, n int) ([]uuid.UUID, error) {
	rows, err := pool.Query(ctx, `
		SELECT id FROM users WHERE email LIKE '%' || $1 ORDER BY email LIMIT $2`, emailDomain, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ---- the load ---------------------------------------------------------------------------------

type result struct {
	connected    atomic.Int64
	rejected     sync.Map // HTTP status → *atomic.Int64
	dialErrors   atomic.Int64
	turnsOK      atomic.Int64
	turnErrors   sync.Map // error code → *atomic.Int64
	dropped      atomic.Int64
	reconnects   atomic.Int64
	completed    atomic.Int64
	mu           sync.Mutex
	turnLatency  []time.Duration
	readyLatency []time.Duration
}

func count(m *sync.Map, key string) {
	v, _ := m.LoadOrStore(key, &atomic.Int64{})
	v.(*atomic.Int64).Add(1)
}

func load(ids []uuid.UUID, url string, turns int, ramp, think time.Duration) error {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		return errors.New("JWT_SECRET is not set (the tool signs access tokens like the API does)")
	}
	issuer := auth.NewTokenIssuer(secret, envOr("JWT_ISSUER", "engora"), time.Hour)
	audio := wav(4 * time.Second)

	dialer := &websocket.Dialer{HandshakeTimeout: 30 * time.Second}
	res := &result{}
	var wg sync.WaitGroup
	start := time.Now()
	gap := ramp / time.Duration(max(1, len(ids)))

	fmt.Printf("%d learners, %d turns each, arriving over %v → %s\n", len(ids), turns, ramp, url)
	progressDone := make(chan struct{})
	go progress(res, len(ids), progressDone)

	for i, id := range ids {
		token, _, err := issuer.Issue(id, authz.RoleUser, uuid.New())
		if err != nil {
			return err
		}
		wg.Go(func() { learner(dialer, url, token, audio, turns, think, res) })
		if i < len(ids)-1 {
			time.Sleep(gap)
		}
	}
	wg.Wait()
	close(progressDone)
	report(res, len(ids), turns, time.Since(start))
	return nil
}

func learner(dialer *websocket.Dialer, url, token string, audio []byte, turns int, think time.Duration, res *result) {
	header := http.Header{"Sec-WebSocket-Protocol": []string{"bearer, " + token}}
	conn, resp, err := dialer.Dial(url, header)
	if err != nil {
		if resp != nil {
			count(&res.rejected, fmt.Sprint(resp.StatusCode))
		} else {
			res.dialErrors.Add(1)
		}
		return
	}
	defer func() { _ = conn.Close() }()
	res.connected.Add(1)

	read := func(timeout time.Duration) (map[string]any, error) {
		_ = conn.SetReadDeadline(time.Now().Add(timeout))
		var msg map[string]any
		err := conn.ReadJSON(&msg)
		return msg, err
	}
	// lost is called when the connection fails. A browser reads messages as they arrive; this
	// client writes first, so a "reconnect" the server sent while it was thinking is still
	// waiting to be read. Read what is left before calling the connection dropped.
	lost := func() {
		for range 3 {
			msg, err := read(2 * time.Second)
			if err != nil {
				break
			}
			if msg["type"] == "reconnect" {
				res.reconnects.Add(1)
				return
			}
		}
		res.dropped.Add(1)
	}

	sent := time.Now()
	if err := conn.WriteJSON(map[string]any{"type": "start"}); err != nil {
		res.dropped.Add(1)
		return
	}
	msg, err := read(30 * time.Second)
	if err != nil || msg["type"] != "ready" {
		res.dropped.Add(1)
		return
	}
	res.mu.Lock()
	res.readyLatency = append(res.readyLatency, time.Since(sent))
	res.mu.Unlock()

	for range turns {
		time.Sleep(think)
		if err := conn.WriteMessage(websocket.BinaryMessage, audio); err != nil {
			lost()
			return
		}
		sent = time.Now()
		if err := conn.WriteJSON(map[string]any{"type": "turn_end", "duration_ms": 4000, "mime_type": "audio/wav"}); err != nil {
			lost()
			return
		}
		msg, err := read(120 * time.Second)
		if err != nil {
			lost()
			return
		}
		switch msg["type"] {
		case "turn":
			res.turnsOK.Add(1)
			res.mu.Lock()
			res.turnLatency = append(res.turnLatency, time.Since(sent))
			res.mu.Unlock()
		case "summary":
			// The server ends the conversation at its turn limit.
			res.completed.Add(1)
			return
		case "reconnect":
			res.reconnects.Add(1)
			return
		default:
			code, _ := msg["code"].(string)
			count(&res.turnErrors, code)
		}
	}
	_ = conn.WriteJSON(map[string]any{"type": "finish"})
	if msg, err := read(60 * time.Second); err == nil && msg["type"] == "summary" {
		res.completed.Add(1)
	}
}

func progress(res *result, n int, done <-chan struct{}) {
	tick := time.NewTicker(5 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-done:
			return
		case <-tick.C:
			fmt.Printf("  … connected %d/%d, turns ok %d, completed %d\n",
				res.connected.Load(), n, res.turnsOK.Load(), res.completed.Load())
		}
	}
}

func report(res *result, n, turns int, took time.Duration) {
	fmt.Printf("\n── live coach load test ─────────────────────────────\n")
	fmt.Printf("learners          %d (took %v)\n", n, took.Round(time.Second))
	fmt.Printf("connected         %d\n", res.connected.Load())
	res.rejected.Range(func(k, v any) bool {
		fmt.Printf("refused (HTTP %s) %d\n", k, v.(*atomic.Int64).Load())
		return true
	})
	if e := res.dialErrors.Load(); e > 0 {
		fmt.Printf("dial errors       %d\n", e)
	}
	fmt.Printf("turns ok          %d of %d\n", res.turnsOK.Load(), int64(n*turns))
	res.turnErrors.Range(func(k, v any) bool {
		fmt.Printf("turn error %-6s %d\n", k, v.(*atomic.Int64).Load())
		return true
	})
	fmt.Printf("dropped           %d\n", res.dropped.Load())
	fmt.Printf("completed         %d\n", res.completed.Load())
	if r := res.reconnects.Load(); r > 0 {
		fmt.Printf("told to reconnect %d\n", r)
	}
	fmt.Printf("ready latency     %s\n", summarize(res.readyLatency))
	fmt.Printf("turn latency      %s\n", summarize(res.turnLatency))
}

func summarize(d []time.Duration) string {
	if len(d) == 0 {
		return "—"
	}
	s := slices.Clone(d)
	sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })
	at := func(q float64) time.Duration { return s[min(len(s)-1, int(q*float64(len(s))))].Round(time.Millisecond) }
	return fmt.Sprintf("p50 %v  p95 %v  p99 %v  max %v  (n=%d)", at(0.5), at(0.95), at(0.99), s[len(s)-1].Round(time.Millisecond), len(s))
}

// wav is a silent 8 kHz 16-bit mono WAV of the given length — a real file the upload
// policy accepts, sized like a short spoken answer.
func wav(d time.Duration) []byte {
	const rate, bytesPerSample = 8000, 2
	data := int(d.Seconds()) * rate * bytesPerSample
	var b bytes.Buffer
	b.WriteString("RIFF")
	_ = binary.Write(&b, binary.LittleEndian, uint32(36+data))
	b.WriteString("WAVEfmt ")
	_ = binary.Write(&b, binary.LittleEndian, uint32(16))
	_ = binary.Write(&b, binary.LittleEndian, uint16(1)) // PCM
	_ = binary.Write(&b, binary.LittleEndian, uint16(1)) // mono
	_ = binary.Write(&b, binary.LittleEndian, uint32(rate))
	_ = binary.Write(&b, binary.LittleEndian, uint32(rate*bytesPerSample))
	_ = binary.Write(&b, binary.LittleEndian, uint16(bytesPerSample))
	_ = binary.Write(&b, binary.LittleEndian, uint16(16))
	b.WriteString("data")
	_ = binary.Write(&b, binary.LittleEndian, uint32(data))
	b.Write(make([]byte, data))
	return b.Bytes()
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
