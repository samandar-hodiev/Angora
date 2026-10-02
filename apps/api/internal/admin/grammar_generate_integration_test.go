package admin

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

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/middleware"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
)

// translatingAuthor writes English like stubAuthor and "translates" by tagging the prose
// with the target language, so a test can see which language each stored level came from.
type translatingAuthor struct {
	stubAuthor
	mu           sync.Mutex
	translations int
}

func (a *translatingAuthor) RefineGrammarLevel(context.Context, ai.GrammarRefineRequest) (*ai.GeneratedGrammarLevel, *ai.EvaluationMeta, error) {
	return nil, nil, fmt.Errorf("not used")
}

func (a *translatingAuthor) TranslateGrammarLevel(_ context.Context, req ai.GrammarTranslateRequest) (*ai.GeneratedGrammarLevel, *ai.EvaluationMeta, error) {
	a.mu.Lock()
	a.translations++
	a.mu.Unlock()
	out := req.Source
	out.Intro = "[" + req.To + "] " + req.Source.Intro
	return &out, &ai.EvaluationMeta{}, nil
}

func TestGrammarGenerateEveryLanguagePostgres(t *testing.T) {
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

	owner, err := users.NewPostgresRepository(pool).CreateAccount(ctx, users.NewAccount{
		Email: fmt.Sprintf("languages-%d@example.com", time.Now().UnixNano()), DisplayName: "Author", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, owner.ID) })

	var categoryID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM grammar_categories LIMIT 1`).Scan(&categoryID); err != nil {
		t.Skip("no grammar categories seeded")
	}
	slug := fmt.Sprintf("languages-zero-conditional-%d", time.Now().UnixNano())
	var topicID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO grammar_topics (slug, name, description, category_id, level_id, status)
		VALUES ($1, 'Zero conditional (test)', 'Facts.', $2, (SELECT id FROM levels WHERE code = 'B1'), 'draft')
		RETURNING id`, slug, categoryID).Scan(&topicID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM grammar_topics WHERE id = $1`, topicID) })

	author := &translatingAuthor{stubAuthor: stubAuthor{levels: []ai.GeneratedGrammarLevel{
		level("A2", "A2 explanation.", 3),
		level("B2", "B2 explanation.", 3),
		{Level: "C2", Applicable: false, Reason: "Nothing left to teach at C2."},
	}}}

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: owner.ID, Role: authz.RoleAdmin, SessionID: uuid.New()})
		c.Next()
	})
	NewModule(pool, &recordingAudit{}).WithAuthor(author).RegisterRoutes(r.Group("/api/v1"))

	var buf bytes.Buffer
	_ = json.NewEncoder(&buf).Encode(map[string]any{"languages": []string{"en", "uz", "ru"}, "levels": []string{"A2", "B2", "C2"}})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/grammar/topics/"+slug+"/generate", &buf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("generate status = %d body = %s", w.Code, w.Body.String())
	}

	t.Run("english is written once and translated into the others", func(t *testing.T) {
		if author.calls != 1 {
			t.Errorf("generation calls = %d, want one — the other languages are translations", author.calls)
		}
		// Two applicable levels × two target languages; the refused level is not translated.
		if author.translations != 4 {
			t.Errorf("translation calls = %d, want 4", author.translations)
		}
	})

	t.Run("every language has its own drafts", func(t *testing.T) {
		rows, err := pool.Query(ctx, `
			SELECT language, level_code, status, body->>'intro' FROM grammar_content
			WHERE grammar_topic_id = $1 ORDER BY language, level_code`, topicID)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		got := map[string]string{}
		for rows.Next() {
			var language, code, status string
			var intro *string
			if err := rows.Scan(&language, &code, &status, &intro); err != nil {
				t.Fatal(err)
			}
			got[language+":"+code] = status
			if status == "draft" && language != "en" && (intro == nil || (*intro)[:4] != "["+language+"]") {
				t.Errorf("%s %s intro = %v, want the %s translation", language, code, intro, language)
			}
		}
		for _, language := range []string{"en", "uz", "ru"} {
			if got[language+":A2"] != "draft" || got[language+":B2"] != "draft" {
				t.Errorf("%s: A2/B2 = %q/%q, want drafts", language, got[language+":A2"], got[language+":B2"])
			}
			if got[language+":C2"] != ContentNotApplicable {
				t.Errorf("%s: C2 = %q, want the refusal carried into every language", language, got[language+":C2"])
			}
		}
	})

	t.Run("publishing puts every language live together", func(t *testing.T) {
		var buf bytes.Buffer
		_ = json.NewEncoder(&buf).Encode(map[string]any{"languages": []string{"en", "uz", "ru"}})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/grammar/topics/"+slug+"/publish", &buf)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("publish status = %d body = %s", w.Code, w.Body.String())
		}
		var live map[string]int
		rows, err := pool.Query(ctx, `
			SELECT language, count(*) FROM grammar_content
			WHERE grammar_topic_id = $1 AND status = 'published' GROUP BY language`, topicID)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		live = map[string]int{}
		for rows.Next() {
			var language string
			var n int
			if err := rows.Scan(&language, &n); err != nil {
				t.Fatal(err)
			}
			live[language] = n
		}
		for _, language := range []string{"en", "uz", "ru"} {
			if live[language] != 2 {
				t.Errorf("%s: %d levels live, want 2 (A2 and B2) — one publish is every language", language, live[language])
			}
		}
	})

	t.Run("publishing again with nothing new takes nothing offline", func(t *testing.T) {
		var buf bytes.Buffer
		_ = json.NewEncoder(&buf).Encode(map[string]any{"languages": []string{"en", "uz", "ru"}})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/grammar/topics/"+slug+"/publish", &buf)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusConflict {
			t.Errorf("status = %d, want 409 — there was nothing new to publish", w.Code)
		}
		var live int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM grammar_content WHERE grammar_topic_id = $1 AND status = 'published'`,
			topicID).Scan(&live); err != nil {
			t.Fatal(err)
		}
		if live != 6 {
			t.Errorf("%d levels live after a second publish, want all 6 still live", live)
		}
	})

	t.Run("practice is written once per level, not once per language", func(t *testing.T) {
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM grammar_questions WHERE grammar_topic_id = $1`, topicID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 6 {
			t.Errorf("questions = %d, want 6 (3 for A2, 3 for B2)", n)
		}
	})
}
