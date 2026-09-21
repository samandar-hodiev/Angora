package grammar

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/middleware"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/internal/subscriptions"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
)

// Entitlement enforcement on the grammar AI routes, against PostgreSQL.
//
// The claim being tested is the one that matters for revenue and for cost: a learner on the
// free plan cannot reach a paid feature, cannot exceed a metered budget, and is not charged
// for work that failed — and in every refusal the AI provider is never called. Run with:
//
//	TEST_DATABASE_URL=postgres://localhost:5432/engora_test?sslmode=disable go test -p 1 -run TestGrammarEntitlements ./internal/grammar/

// countingTutor records how often the provider would have been called.
type countingTutor struct {
	mu       sync.Mutex
	explains int
	asks     int
	failWith error
}

func (t *countingTutor) ExplainGrammar(context.Context, ai.GrammarTopicContext, ai.GrammarLearner) (*ai.GrammarExplanation, *ai.EvaluationMeta, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.explains++
	if t.failWith != nil {
		return nil, nil, t.failWith
	}
	return &ai.GrammarExplanation{Summary: "Past Simple describes a finished action."},
		&ai.EvaluationMeta{Versions: ai.Versions{ModelVersion: "stub"}}, nil
}

func (t *countingTutor) AskGrammar(context.Context, ai.GrammarTopicContext, ai.GrammarLearner, []ai.Message, string) (*ai.TextResponse, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.asks++
	return &ai.TextResponse{Text: "Because the action finished in the past."}, nil
}

func (t *countingTutor) AnalyzeGrammarWriting(context.Context, ai.GrammarTopicContext, ai.GrammarLearner, string, string) (*ai.GrammarWritingAnalysis, *ai.EvaluationMeta, error) {
	return &ai.GrammarWritingAnalysis{}, &ai.EvaluationMeta{}, nil
}

func (t *countingTutor) VisualizeGrammar(context.Context, ai.GrammarTopicContext, *ai.GrammarTopicContext, string, ai.GrammarLearner) (*ai.GeneratedVisual, uuid.UUID, error) {
	return &ai.GeneratedVisual{SVG: "<svg/>", AltText: "alt", Caption: "caption"}, uuid.New(), nil
}

func (t *countingTutor) counts() (int, int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.explains, t.asks
}

func TestGrammarEntitlementsPostgres(t *testing.T) {
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
	// Registered as a cleanup, not deferred: deferred closes run before t.Cleanup, which
	// would leave every other cleanup in this test talking to a closed pool. Cleanups run
	// last-in-first-out, so registering this first closes the pool last.
	t.Cleanup(pool.Close)

	learner, err := users.NewPostgresRepository(pool).CreateAccount(ctx, users.NewAccount{
		Email: fmt.Sprintf("grammar-ent-%d@example.com", time.Now().UnixNano()), DisplayName: "Learner", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, learner.ID) })

	// Six topics: the explanation cache keys on the topic, so exhausting a monthly budget
	// means visiting six different rules, exactly as a learner would.
	slugs := seedTopics(ctx, t, pool, 6)

	tutor := &countingTutor{}
	plans := subscriptions.NewService(subscriptions.NewPostgresStore(pool))
	module := NewModule(Deps{Pool: pool, Tutor: tutor, Tracker: &analytics.Memory{}, Plans: plans,
		Log: slog.New(slog.DiscardHandler)})

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: learner.ID, Role: authz.RoleUser, SessionID: uuid.New()})
		c.Next()
	})
	module.RegisterRoutes(r.Group("/api/v1"))

	post := func(path string, body any) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		req := httptest.NewRequest(http.MethodPost, "/api/v1"+path, &buf)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	errorCode := func(w *httptest.ResponseRecorder) string {
		var envelope struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &envelope)
		return envelope.Error.Code
	}

	// The learner has no subscription, so they are on the default free plan.
	t.Run("the tutor is not on the free plan", func(t *testing.T) {
		_, asksBefore := tutor.counts()
		w := post("/grammar/topics/"+slugs[0]+"/ai/ask", map[string]string{"question": "Why is this past?"})
		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want 403; body = %s", w.Code, w.Body.String())
		}
		if code := errorCode(w); code != "ENTITLEMENT_REQUIRED" {
			t.Errorf("code = %q, want ENTITLEMENT_REQUIRED", code)
		}
		if _, asksAfter := tutor.counts(); asksAfter != asksBefore {
			t.Error("the provider was called for a learner whose plan does not include the tutor")
		}
	})

	t.Run("explanations are metered and then refused", func(t *testing.T) {
		// migration 000015 gives the free plan five explanations a month.
		for i := 0; i < 5; i++ {
			if w := post("/grammar/topics/"+slugs[i]+"/ai/explain", nil); w.Code != http.StatusOK {
				t.Fatalf("explanation %d: status = %d body = %s", i+1, w.Code, w.Body.String())
			}
		}

		explainsBefore, _ := tutor.counts()
		w := post("/grammar/topics/"+slugs[5]+"/ai/explain", nil)
		if w.Code != http.StatusTooManyRequests {
			t.Fatalf("sixth explanation: status = %d, want 429; body = %s", w.Code, w.Body.String())
		}
		if code := errorCode(w); code != "USAGE_LIMIT_REACHED" {
			t.Errorf("code = %q, want USAGE_LIMIT_REACHED", code)
		}
		if explainsAfter, _ := tutor.counts(); explainsAfter != explainsBefore {
			t.Error("the provider was called after the learner's budget was exhausted")
		}
	})

	t.Run("a cached explanation is free", func(t *testing.T) {
		// The learner is out of budget, but re-reading a topic they already unlocked must
		// still work: the cache is hit before anything is charged.
		explainsBefore, _ := tutor.counts()
		w := post("/grammar/topics/"+slugs[0]+"/ai/explain", nil)
		if w.Code != http.StatusOK {
			t.Fatalf("re-reading a cached explanation: status = %d body = %s", w.Code, w.Body.String())
		}
		if explainsAfter, _ := tutor.counts(); explainsAfter != explainsBefore {
			t.Error("a cached explanation called the provider again")
		}
	})

	t.Run("failed work is refunded", func(t *testing.T) {
		used := usageOf(ctx, t, pool, learner.ID, "grammar.ai_explanation")
		if used == 0 {
			t.Fatal("expected the learner to have spent explanations by now")
		}
		// Give one unit back so there is budget for exactly one more call, then make the
		// provider fail: the learner must not be charged for an answer they never got.
		if err := plans.ReleaseUsage(ctx, learner.ID, "grammar.ai_explanation", 1); err != nil {
			t.Fatal(err)
		}
		tutor.failWith = fmt.Errorf("provider exploded")
		t.Cleanup(func() { tutor.failWith = nil })

		if w := post("/grammar/topics/"+slugs[5]+"/ai/explain", nil); w.Code < 500 && w.Code != http.StatusServiceUnavailable && w.Code != http.StatusBadGateway {
			t.Logf("provider failure surfaced as %d: %s", w.Code, w.Body.String())
		}
		if after := usageOf(ctx, t, pool, learner.ID, "grammar.ai_explanation"); after != used-1 {
			t.Errorf("usage after a failed call = %d, want %d (the reserved unit must be refunded)", after, used-1)
		}
	})
}

func seedTopics(ctx context.Context, t *testing.T, pool *pgxpool.Pool, n int) []string {
	t.Helper()
	var categoryID uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO grammar_categories (slug, name, description, sort_order)
		VALUES ($1, 'Entitlement test', '', 999)
		ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
		RETURNING id`, fmt.Sprintf("ent-test-%d", time.Now().UnixNano())).Scan(&categoryID)
	if err != nil {
		t.Fatal(err)
	}

	slugs := make([]string, 0, n)
	stamp := time.Now().UnixNano()
	for i := 0; i < n; i++ {
		slug := fmt.Sprintf("ent-topic-%d-%d", stamp, i)
		if _, err := pool.Exec(ctx, `
			INSERT INTO grammar_topics (slug, name, description, level_id, category_id, status, published_at)
			VALUES ($1, $2, 'A topic used by the entitlement test',
			        (SELECT id FROM levels WHERE code = 'B1'), $3, 'published', now())`,
			slug, "Entitlement topic "+slug, categoryID); err != nil {
			t.Fatal(err)
		}
		slugs = append(slugs, slug)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM grammar_topics WHERE slug LIKE $1`, fmt.Sprintf("ent-topic-%d-%%", stamp))
		_, _ = pool.Exec(context.Background(), `DELETE FROM grammar_categories WHERE id = $1`, categoryID)
	})
	return slugs
}

func usageOf(ctx context.Context, t *testing.T, pool *pgxpool.Pool, userID uuid.UUID, key string) int {
	t.Helper()
	var used int
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(sum(used), 0) FROM usage_counters WHERE user_id = $1 AND entitlement_key = $2`,
		userID, key).Scan(&used)
	if err != nil {
		t.Fatal(err)
	}
	return used
}
