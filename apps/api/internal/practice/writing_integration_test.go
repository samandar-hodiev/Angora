package practice

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
	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/middleware"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/internal/subscriptions"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
)

// Writing practice against PostgreSQL: the budget is charged before the evaluator runs,
// refunded when it fails, and a successful check leaves an analysis, mistakes, weaknesses and
// a skill standing behind it. Run with:
//
//	TEST_DATABASE_URL=postgres://localhost:5432/engora_test?sslmode=disable go test -p 1 -run TestWritingPractice ./internal/practice/

type stubWritingEvaluator struct {
	calls int
	fail  bool
}

func (s *stubWritingEvaluator) EvaluateWriting(context.Context, ai.WritingAssessmentInput) (*ai.WritingAssessment, ai.EvaluationMeta, error) {
	s.calls++
	if s.fail {
		return nil, ai.EvaluationMeta{}, fmt.Errorf("provider unavailable")
	}
	return &ai.WritingAssessment{
			TaskResponse: 60, Grammar: 52, Vocabulary: 64, Coherence: 56, CEFREstimate: "B1", Confidence: 0.8,
			Mistakes: []ai.AssessmentMistake{
				{Category: "grammar.tense.past_simple", Original: "I go yesterday", Correction: "I went yesterday",
					Explanation: "Past time needs the past simple.", Severity: "high"},
			},
		},
		ai.EvaluationMeta{Versions: ai.Versions{SchemaVersion: "1", ModelVersion: "stub", PromptVersion: "p1",
			RubricVersion: "r1", AnalysisVersion: "a1"}, Provider: "stub"}, nil
}

func TestWritingPracticeFlowPostgres(t *testing.T) {
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
		Email: fmt.Sprintf("writer-%d@example.com", time.Now().UnixNano()), DisplayName: "Writer", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, learner.ID) })

	evaluator := &stubWritingEvaluator{}
	plans := subscriptions.NewService(subscriptions.NewPostgresStore(pool))
	module := NewModule(Deps{Pool: pool, Plans: plans, Usage: plans, Evaluator: evaluator, Tracker: &analytics.Memory{}})

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: learner.ID, Role: authz.RoleUser, SessionID: uuid.New()})
		c.Next()
	})
	module.RegisterRoutes(r.Group("/api/v1"))

	post := func(path string, body any) (*httptest.ResponseRecorder, map[string]any) {
		t.Helper()
		var buf bytes.Buffer
		_ = json.NewEncoder(&buf).Encode(body)
		req := httptest.NewRequest(http.MethodPost, "/api/v1"+path, &buf)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var envelope map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &envelope)
		return w, envelope
	}

	essay := strings.Repeat("Yesterday I go to the museum with my friend and we see many interesting things there. ", 3)

	t.Run("too short is refused before anything is charged", func(t *testing.T) {
		before := evaluator.calls
		w, _ := post("/writing/submissions", map[string]any{"text": "Too short."})
		if w.Code < 400 {
			t.Fatalf("status = %d, want a validation failure", w.Code)
		}
		if evaluator.calls != before {
			t.Error("the evaluator was called for a submission that was too short")
		}
	})

	t.Run("a check produces feedback and a record", func(t *testing.T) {
		w, body := post("/writing/submissions", map[string]any{"prompt": "Describe a place you visited.", "text": essay})
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
		}
		data, _ := body["data"].(map[string]any)
		if status, _ := data["status"].(string); status != "completed" {
			t.Errorf("status = %q, want completed", status)
		}
		feedback, _ := data["feedback"].(map[string]any)
		if feedback == nil {
			t.Fatal("no feedback returned")
		}
		if cefr, _ := feedback["cefr_estimate"].(string); cefr != "B1" {
			t.Errorf("cefr_estimate = %q, want B1", cefr)
		}
		if score, _ := data["overall_score"].(float64); score != 58 {
			t.Errorf("overall_score = %v, want 58 (mean of the four criteria)", data["overall_score"])
		}

		var analyses, mistakes, weaknesses, sessions int
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM ai_analyses WHERE user_id = $1`, learner.ID).Scan(&analyses)
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM mistakes WHERE user_id = $1`, learner.ID).Scan(&mistakes)
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM weaknesses WHERE user_id = $1`, learner.ID).Scan(&weaknesses)
		_ = pool.QueryRow(ctx, `
			SELECT coalesce(sum(sessions_count), 0) FROM skill_progress sp JOIN skills s ON s.id = sp.skill_id
			WHERE sp.user_id = $1 AND s.code = 'writing'`, learner.ID).Scan(&sessions)

		if analyses != 1 {
			t.Errorf("ai_analyses = %d, want 1 — the evaluation must be recorded with its versions", analyses)
		}
		if mistakes != 1 || weaknesses != 1 {
			t.Errorf("mistakes = %d, weaknesses = %d, want 1 each", mistakes, weaknesses)
		}
		if sessions != 1 {
			t.Errorf("writing sessions = %d, want 1", sessions)
		}
	})

	t.Run("a failed evaluation refunds the learner", func(t *testing.T) {
		used := func() int {
			var n int
			_ = pool.QueryRow(ctx, `
				SELECT coalesce(sum(used), 0) FROM usage_counters
				WHERE user_id = $1 AND entitlement_key = 'writing.evaluations'`, learner.ID).Scan(&n)
			return n
		}
		before := used()

		evaluator.fail = true
		t.Cleanup(func() { evaluator.fail = false })
		w, _ := post("/writing/submissions", map[string]any{"prompt": "Another task.", "text": essay})
		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("status = %d, want 503 when the provider fails", w.Code)
		}
		if after := used(); after != before {
			t.Errorf("usage after a failed check = %d, want %d — the reserved unit must be refunded", after, before)
		}

		var failed int
		_ = pool.QueryRow(ctx, `
			SELECT count(*) FROM writing_submissions WHERE user_id = $1 AND status = 'failed'`, learner.ID).Scan(&failed)
		if failed != 1 {
			t.Errorf("failed submissions = %d, want 1 — a failed check must be visible, not silently dropped", failed)
		}
	})

	t.Run("the free plan's daily budget runs out", func(t *testing.T) {
		// The free plan grants two writing evaluations a day (migration 000004). One was
		// spent by the successful check above and the failure was refunded, so one is left.
		if w, _ := post("/writing/submissions", map[string]any{"prompt": "Task.", "text": essay}); w.Code != http.StatusOK {
			t.Fatalf("second check: status = %d", w.Code)
		}
		w, _ := post("/writing/submissions", map[string]any{"prompt": "Task.", "text": essay})
		if w.Code != http.StatusTooManyRequests {
			t.Fatalf("third check: status = %d, want 429 once the budget is spent", w.Code)
		}
	})
}
