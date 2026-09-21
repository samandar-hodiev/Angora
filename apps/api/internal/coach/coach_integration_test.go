package coach

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/middleware"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/internal/subscriptions"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
)

// The coach against PostgreSQL: a thread that remembers, a budget that runs out, and a
// provider failure that costs the learner nothing. Run with:
//
//	TEST_DATABASE_URL=postgres://localhost:5432/engora_test?sslmode=disable go test -p 1 -run TestCoach ./internal/coach/

type stubGenerator struct {
	calls   int
	lastReq ai.TextRequest
	fail    bool
}

func (s *stubGenerator) GenerateText(_ context.Context, _ ai.CallMeta, req ai.TextRequest) (*ai.TextResponse, error) {
	s.calls++
	s.lastReq = req
	if s.fail {
		return nil, fmt.Errorf("provider unavailable")
	}
	return &ai.TextResponse{Text: "Use the past simple for a finished action: I went to the market.", Model: "stub"}, nil
}

func TestCoachConversationPostgres(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	if err := database.MigrateUp(url); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Connect(ctx, database.Options{URL: url, MaxConns: 4})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	learner, err := users.NewPostgresRepository(pool).CreateAccount(ctx, users.NewAccount{
		Email: fmt.Sprintf("coach-%d@example.com", time.Now().UnixNano()), DisplayName: "Learner", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, learner.ID) })

	generator := &stubGenerator{}
	plans := subscriptions.NewService(subscriptions.NewPostgresStore(pool))
	module := NewModule(Deps{Pool: pool, AI: generator, Plans: plans})

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: learner.ID, Role: authz.RoleUser, SessionID: uuid.New()})
		c.Next()
	})
	module.RegisterRoutes(r.Group("/api/v1"))

	post := func(body any) (*httptest.ResponseRecorder, map[string]any) {
		t.Helper()
		var buf bytes.Buffer
		_ = json.NewEncoder(&buf).Encode(body)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/coach/messages", &buf)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var envelope map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &envelope)
		return w, envelope
	}

	t.Run("the free plan does not include the coach", func(t *testing.T) {
		before := generator.calls
		w, _ := post(map[string]any{"message": "Why is this past simple?"})
		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want 403; body = %s", w.Code, w.Body.String())
		}
		if generator.calls != before {
			t.Error("the provider was called for a learner whose plan excludes the coach")
		}
	})

	// Put the learner on a plan that includes the coach.
	var proID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM subscription_plans WHERE code = 'pro'`).Scan(&proID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO subscriptions (user_id, plan_id, status, provider) VALUES ($1, $2, 'active', 'manual')`,
		learner.ID, proID); err != nil {
		t.Fatal(err)
	}

	var conversationID string
	t.Run("a thread is started and remembered", func(t *testing.T) {
		w, body := post(map[string]any{"message": "When do I use the past simple?"})
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
		}
		conv, _ := body["data"].(map[string]any)
		conversationID, _ = conv["id"].(string)
		messages, _ := conv["messages"].([]any)
		if len(messages) != 2 {
			t.Fatalf("messages = %d, want the question and the answer", len(messages))
		}
		if title, _ := conv["title"].(string); !strings.Contains(title, "past simple") {
			t.Errorf("title = %q — the first question should name the thread", title)
		}

		// Replying in the same thread sends the history, so the coach has context.
		w, body = post(map[string]any{"conversation_id": conversationID, "message": "And with 'ago'?"})
		if w.Code != http.StatusOK {
			t.Fatalf("second message: status = %d", w.Code)
		}
		conv, _ = body["data"].(map[string]any)
		messages, _ = conv["messages"].([]any)
		if len(messages) != 4 {
			t.Errorf("messages = %d, want four after two exchanges", len(messages))
		}
		if len(generator.lastReq.Messages) < 3 {
			t.Errorf("the provider received %d messages; the thread must be sent for context", len(generator.lastReq.Messages))
		}
		if !strings.Contains(generator.lastReq.System, "CEFR") {
			t.Error("the system prompt must tell the coach what level to pitch at")
		}
	})

	t.Run("a provider failure keeps the question and refunds the message", func(t *testing.T) {
		used := func() int {
			var n int
			_ = pool.QueryRow(ctx, `
				SELECT coalesce(sum(used), 0) FROM usage_counters
				WHERE user_id = $1 AND entitlement_key = 'ai_coach.messages'`, learner.ID).Scan(&n)
			return n
		}
		before := used()
		generator.fail = true
		t.Cleanup(func() { generator.fail = false })

		w, _ := post(map[string]any{"conversation_id": conversationID, "message": "What about the present perfect?"})
		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("status = %d, want 503", w.Code)
		}
		if after := used(); after != before {
			t.Errorf("usage = %d, want %d — a failed reply must be refunded", after, before)
		}

		// The learner's question is still there, so they do not have to retype it.
		var count int
		_ = pool.QueryRow(ctx, `
			SELECT count(*) FROM coach_messages WHERE conversation_id = $1 AND role = 'user'`,
			conversationID).Scan(&count)
		if count != 3 {
			t.Errorf("user messages = %d, want 3 — the question must survive a failed reply", count)
		}
	})

	t.Run("another learner cannot open the thread", func(t *testing.T) {
		other, err := users.NewPostgresRepository(pool).CreateAccount(ctx, users.NewAccount{
			Email: fmt.Sprintf("coach-other-%d@example.com", time.Now().UnixNano()), DisplayName: "Other", Timezone: "UTC", EmailVerified: true,
		})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, other.ID) })

		r2 := gin.New()
		r2.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
			authz.SetPrincipal(c, authz.Principal{UserID: other.ID, Role: authz.RoleUser, SessionID: uuid.New()})
			c.Next()
		})
		module.RegisterRoutes(r2.Group("/api/v1"))

		w := httptest.NewRecorder()
		r2.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/coach/conversations/"+conversationID, nil))
		if w.Code != http.StatusNotFound {
			t.Errorf("status = %d, want 404", w.Code)
		}
	})
}
