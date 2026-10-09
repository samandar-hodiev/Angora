package practice

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/middleware"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/internal/storage"
	"github.com/samandar-hodiev/engora/apps/api/internal/subscriptions"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
)

// The live speaking coach against PostgreSQL and a real WebSocket. Run with:
//
//	TEST_DATABASE_URL=postgres://localhost:5432/engora_test?sslmode=disable go test -p 1 -run TestLiveSpeaking ./internal/practice/

func TestLiveSpeakingPostgres(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	if err := database.MigrateUp(dbURL); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Connect(ctx, database.Options{URL: dbURL, MaxConns: 4})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	repo := users.NewPostgresRepository(pool)
	learner, err := repo.CreateAccount(ctx, users.NewAccount{
		Email: fmt.Sprintf("live-%d@example.com", time.Now().UnixNano()), DisplayName: "Live", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, learner.ID) })

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	speaker := &stubSpeaker{
		transcript: strings.Repeat("I usually visit my grandmother on Sunday and we cook together. ", 3),
		seconds:    24,
	}
	plans := subscriptions.NewService(subscriptions.NewPostgresStore(pool))
	conversation := &stubConversation{output: `{"say": "Yaxshi! “I usually visit” to'g'ri.", "ask": "What do you cook together?"}`}
	module := NewModule(Deps{Pool: pool, Plans: plans, Usage: plans, Speaker: speaker, Storage: store,
		MaxUploadBytes: 5 << 20, Tracker: &analytics.Memory{}, Conversation: conversation})

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: learner.ID, Role: authz.RoleUser, SessionID: uuid.New()})
		c.Next()
	})
	module.RegisterRoutes(r.Group("/api/v1"))

	server := httptest.NewServer(r)
	t.Cleanup(server.Close)
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/api/v1/speaking/live"

	dial := func(t *testing.T) (*websocket.Conn, *http.Response, error) {
		t.Helper()
		// The previous subtest's connection is released by the server after the client
		// closes it; one learner may hold only one conversation, so wait for that first.
		for i := 0; i < 200 && module.live.Stats().Active > 0; i++ {
			time.Sleep(10 * time.Millisecond)
		}
		return websocket.DefaultDialer.Dial(wsURL, nil)
	}

	readMessage := func(t *testing.T, conn *websocket.Conn) liveServerMessage {
		t.Helper()
		_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
		var msg liveServerMessage
		if err := conn.ReadJSON(&msg); err != nil {
			t.Fatalf("read: %v", err)
		}
		return msg
	}

	send := func(t *testing.T, conn *websocket.Conn, v any) {
		t.Helper()
		if err := conn.WriteJSON(v); err != nil {
			t.Fatalf("write: %v", err)
		}
	}

	status := func(t *testing.T) (int, string) {
		t.Helper()
		res, err := http.Get(server.URL + "/api/v1/speaking/live/status")
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = res.Body.Close() }()
		var envelope struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.NewDecoder(res.Body).Decode(&envelope)
		return res.StatusCode, envelope.Error.Code
	}

	t.Run("the pre-flight explains a missing plan", func(t *testing.T) {
		if code, errCode := status(t); code != http.StatusForbidden || errCode != "ENTITLEMENT_REQUIRED" {
			t.Fatalf("status = %d %s, want 403 ENTITLEMENT_REQUIRED", code, errCode)
		}
	})

	t.Run("the free plan cannot open a session", func(t *testing.T) {
		_, res, err := dial(t)
		if err == nil {
			t.Fatal("a free learner opened a live session")
		}
		if res == nil || res.StatusCode != http.StatusForbidden {
			t.Fatalf("status = %v, want 403 before the upgrade", res)
		}
		var envelope struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.NewDecoder(res.Body).Decode(&envelope)
		if envelope.Error.Code != "ENTITLEMENT_REQUIRED" {
			t.Errorf("code = %q, want ENTITLEMENT_REQUIRED", envelope.Error.Code)
		}
	})

	// Put the learner on a plan that includes the live coach.
	if _, err := pool.Exec(ctx, `
		INSERT INTO subscriptions (user_id, plan_id, status, current_period_start, current_period_end)
		VALUES ($1, (SELECT id FROM subscription_plans WHERE code = 'pro'), 'active', now(), now() + interval '30 days')`,
		learner.ID); err != nil {
		t.Fatal(err)
	}

	t.Run("a turn comes back transcribed, judged and answered", func(t *testing.T) {
		for i := 0; i < 200 && module.live.Stats().Active > 0; i++ {
			time.Sleep(10 * time.Millisecond)
		}
		if code, _ := status(t); code != http.StatusOK {
			t.Fatalf("pre-flight = %d, want 200 for a learner on the plan", code)
		}
		conn, _, err := dial(t)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer func() { _ = conn.Close() }()

		send(t, conn, map[string]any{"type": "start", "topic": "Food from your country", "feedback_lang": "uz"})
		ready := readMessage(t, conn)
		if ready.Type != "ready" || ready.SessionID == nil {
			t.Fatalf("first message = %+v, want ready with a session id", ready)
		}
		sessionID := *ready.SessionID
		if !strings.Contains(ready.Prompt, "Food from your country") {
			t.Errorf("prompt = %q, want the chosen topic in the opener", ready.Prompt)
		}

		if err := conn.WriteMessage(websocket.BinaryMessage, webm()); err != nil {
			t.Fatal(err)
		}
		send(t, conn, map[string]any{"type": "turn_end", "duration_ms": 24000, "mime_type": "audio/webm"})

		turn := readMessage(t, conn)
		if turn.Type != "turn" || turn.Turn == nil {
			t.Fatalf("message = %+v, want a turn", turn)
		}
		if turn.Turn.Transcript == "" {
			t.Error("the learner must be shown what we heard")
		}
		if turn.Turn.Feedback == nil || turn.Turn.Feedback.CEFREstimate != "B1" {
			t.Errorf("feedback = %+v, want the evaluator's verdict", turn.Turn.Feedback)
		}
		if turn.Turn.Reply != "What do you cook together?" {
			t.Errorf("reply = %q, want the coach's next question", turn.Turn.Reply)
		}
		if !strings.HasPrefix(turn.Turn.Say, "Yaxshi!") {
			t.Errorf("say = %q, want the spoken feedback in the learner's language", turn.Turn.Say)
		}
		if !strings.Contains(conversation.lastSystem(), "Uzbek") {
			t.Error("the coach must be told to give feedback in Uzbek")
		}
		if turn.Turn.WordsPerMinute <= 0 {
			t.Error("words per minute should be computed from the turn")
		}

		send(t, conn, map[string]any{"type": "finish"})
		summary := readMessage(t, conn)
		if summary.Type != "summary" || summary.Turns != 1 || summary.OverallScore == nil {
			t.Fatalf("summary = %+v", summary)
		}

		var status, mode string
		var score *float64
		if err := pool.QueryRow(ctx, `
			SELECT status, mode, overall_score::float8 FROM speaking_sessions WHERE id = $1`, sessionID).
			Scan(&status, &mode, &score); err != nil {
			t.Fatal(err)
		}
		if status != "completed" || mode != "live" {
			t.Errorf("session = %s/%s, want completed/live", status, mode)
		}
		if score == nil {
			t.Error("a finished session must carry a score")
		}

		var turns int
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM speaking_turns WHERE session_id = $1`, sessionID).Scan(&turns)
		if turns != 1 {
			t.Errorf("speaking_turns = %d, want 1", turns)
		}

		// The session has to look like practice everywhere else in the product.
		var practised int
		_ = pool.QueryRow(ctx, `
			SELECT coalesce(sessions_count, 0) FROM skill_progress sp JOIN skills s ON s.id = sp.skill_id
			WHERE sp.user_id = $1 AND s.code = 'speaking'`, learner.ID).Scan(&practised)
		if practised == 0 {
			t.Error("a live session must count towards speaking progress")
		}
	})

	t.Run("a turn too short to judge is refused without ending the session", func(t *testing.T) {
		speaker.transcript = "Um."
		speaker.seconds = 1
		t.Cleanup(func() {
			speaker.transcript = strings.Repeat("I usually visit my grandmother on Sunday and we cook together. ", 3)
			speaker.seconds = 24
		})

		conn, _, err := dial(t)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer func() { _ = conn.Close() }()

		send(t, conn, map[string]any{"type": "start"})
		if ready := readMessage(t, conn); ready.Type != "ready" {
			t.Fatalf("message = %+v", ready)
		}

		before := usedEvaluations(t, pool, learner.ID)
		if err := conn.WriteMessage(websocket.BinaryMessage, webm()); err != nil {
			t.Fatal(err)
		}
		send(t, conn, map[string]any{"type": "turn_end", "duration_ms": 1000, "mime_type": "audio/webm"})

		msg := readMessage(t, conn)
		if msg.Type != "error" {
			t.Fatalf("message = %+v, want an error for a one-word turn", msg)
		}
		if after := usedEvaluations(t, pool, learner.ID); after != before {
			t.Errorf("evaluations used = %d, want it refunded back to %d", after, before)
		}

		// The session is still open: the learner can simply speak again.
		send(t, conn, map[string]any{"type": "finish"})
		if summary := readMessage(t, conn); summary.Type != "summary" {
			t.Errorf("message = %+v, want the session to still be alive", summary)
		}
	})

	t.Run("speaking before start is refused", func(t *testing.T) {
		conn, _, err := dial(t)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer func() { _ = conn.Close() }()

		send(t, conn, map[string]any{"type": "turn_end", "duration_ms": 5000})
		if msg := readMessage(t, conn); msg.Type != "error" {
			t.Errorf("message = %+v, want an error", msg)
		}
	})

	t.Run("a second tab is refused while the first is open", func(t *testing.T) {
		first, _, err := dial(t)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer func() { _ = first.Close() }()
		send(t, first, map[string]any{"type": "start"})
		if ready := readMessage(t, first); ready.Type != "ready" {
			t.Fatalf("message = %+v", ready)
		}

		if code, errCode := status(t); code != http.StatusConflict || errCode != "CONFLICT" {
			t.Errorf("pre-flight with a tab open = %d %s, want 409 CONFLICT", code, errCode)
		}
		_, res, err := websocket.DefaultDialer.Dial(wsURL, nil)
		if err == nil {
			t.Fatal("a second conversation opened for the same learner")
		}
		if res == nil || res.StatusCode != http.StatusConflict {
			t.Fatalf("status = %v, want 409", res)
		}
	})

	t.Run("a cross-origin page cannot open a session", func(t *testing.T) {
		_, res, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Origin": []string{"https://evil.example"}})
		if err == nil {
			t.Fatal("an upgrade from another origin succeeded")
		}
		if res == nil || res.StatusCode != http.StatusForbidden {
			t.Errorf("status = %v, want 403", res)
		}
	})

	// Last: a drained hub stays drained.
	t.Run("a deploy tells a waiting learner to reconnect", func(t *testing.T) {
		conn, _, err := dial(t)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer func() { _ = conn.Close() }()
		send(t, conn, map[string]any{"type": "start"})
		if ready := readMessage(t, conn); ready.Type != "ready" {
			t.Fatalf("message = %+v", ready)
		}

		drained := make(chan struct{})
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			module.live.Drain(ctx)
			close(drained)
		}()

		if msg := readMessage(t, conn); msg.Type != "reconnect" {
			t.Fatalf("message = %+v, want reconnect", msg)
		}
		select {
		case <-drained:
		case <-time.After(5 * time.Second):
			t.Fatal("drain did not finish once the conversation had ended")
		}
		if _, res, err := websocket.DefaultDialer.Dial(wsURL, nil); err == nil || res.StatusCode != http.StatusServiceUnavailable {
			t.Errorf("a draining instance accepted a new conversation (status %v)", res)
		}
	})
}

func usedEvaluations(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID) int {
	t.Helper()
	var used int
	_ = pool.QueryRow(context.Background(), `
		SELECT coalesce(sum(used), 0)::int FROM usage_counters
		WHERE user_id = $1 AND entitlement_key = 'speaking.evaluations'`, userID).Scan(&used)
	return used
}

// stubConversation answers every coach turn with a fixed result and remembers the instructions.
type stubConversation struct {
	output string
	mu     sync.Mutex
	system string
}

func (s *stubConversation) AnalyzeText(_ context.Context, _ ai.CallMeta, req ai.AnalysisRequest) (*ai.AnalysisResponse, error) {
	s.mu.Lock()
	s.system = req.Instructions
	s.mu.Unlock()
	return &ai.AnalysisResponse{Output: []byte(s.output)}, nil
}

func (s *stubConversation) lastSystem() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.system
}
