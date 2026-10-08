package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/middleware"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
)

// The AI page prices calls from their tokens, per provider, and the team page reads content
// changes out of the audit log with the person who made them.
func TestAITimelineAndActivityPostgres(t *testing.T) {
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

	staff, err := users.NewPostgresRepository(pool).CreateAccount(ctx, users.NewAccount{
		Email: fmt.Sprintf("activity-%d@example.com", time.Now().UnixNano()), DisplayName: "Content Writer", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, staff.ID) })

	// Two calls on a priced model, one on an unpriced one, all from this test's user.
	for _, row := range []struct {
		provider, model string
		in, out         int
	}{{"openai", "gpt-4.1-mini", 1_000_000, 500_000}, {"openai", "gpt-4.1-mini-2025-04-14", 0, 500_000}, {"mock", "", 10, 10}} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO ai_requests (user_id, task, provider, model, status, input_tokens, output_tokens, audio_seconds, estimated_cost_usd, latency_ms)
			VALUES ($1, 'content_generation', $2, $3, 'succeeded', $4, $5, 0, 0, 10)`, staff.ID, row.provider, row.model, row.in, row.out); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM ai_requests WHERE user_id = $1`, staff.ID) })

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: staff.ID, Role: authz.RoleAdmin, SessionID: uuid.New()})
		c.Next()
	})
	recorder := &recordingAudit{}
	m := NewModule(pool, recorder)
	m.RegisterRoutes(r.Group("/api/v1"))

	get := func(path string, out any) {
		t.Helper()
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1"+path, nil))
		if w.Code != http.StatusOK {
			t.Fatalf("%s = %d %s", path, w.Code, w.Body.String())
		}
		var env struct {
			Data json.RawMessage `json:"data"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &env)
		if err := json.Unmarshal(env.Data, out); err != nil {
			t.Fatal(err)
		}
	}

	t.Run("the timeline prices calls from their tokens, per provider", func(t *testing.T) {
		var tl AITimeline
		get("/admin/ai/timeline?days=7", &tl)
		var openai *ProviderSpend
		for i := range tl.Providers {
			if tl.Providers[i].Provider == "openai" {
				openai = &tl.Providers[i]
			}
		}
		if openai == nil {
			t.Fatal("no openai provider in the timeline")
		}
		// 1M in × $0.40 + 1M out × $1.60 = $2.00 at least (other rows in the DB may add to it).
		if openai.CostUSD < 2.0-1e-9 {
			t.Errorf("openai cost = %v, want at least 2.00", openai.CostUSD)
		}
		if len(tl.Points) != 7 {
			t.Errorf("points = %d, want one per day for 7 days", len(tl.Points))
		}
		today := tl.Points[len(tl.Points)-1].ByProvider["openai"]
		if today.Tokens < 2_000_000 || math.IsNaN(today.CostUSD) {
			t.Errorf("today = %+v, want this test's calls in the last bucket", today)
		}
	})

	t.Run("content changes are read back with who made them", func(t *testing.T) {
		actor := staff.ID
		if _, err := pool.Exec(ctx, `
			INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
			VALUES ($1, 'lexicon.generated', 'phrases', 'travel', '{"area":"phrases","method":"ai","target":"travel","count":12}'),
			       ($1, 'lexicon.edited', 'phrases', 'look after', '{"area":"phrases","method":"manual","target":"look after"}')`, actor); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM audit_logs WHERE actor_id = $1`, actor) })

		var report ActivityReport
		get("/admin/activity?days=7&actor="+actor.String(), &report)
		if len(report.Workers) != 1 || report.Workers[0].AI != 1 || report.Workers[0].Manual != 1 || report.Workers[0].Name != "Content Writer" {
			t.Fatalf("workers = %+v, want one writer with one AI and one manual change", report.Workers)
		}
		if len(report.Events) != 2 || report.Events[1].Count != 12 || report.Events[1].Area != "phrases" {
			t.Errorf("events = %+v", report.Events)
		}
	})
}
