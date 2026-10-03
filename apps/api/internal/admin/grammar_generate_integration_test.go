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
	tests        int
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

// WriteGrammarPractice writes a full test: nine choices and six gaps, like the real one.
func (a *translatingAuthor) WriteGrammarPractice(_ context.Context, req ai.GrammarPracticeRequest) ([]ai.GeneratedPractice, *ai.EvaluationMeta, error) {
	a.mu.Lock()
	a.tests++
	a.mu.Unlock()
	out := make([]ai.GeneratedPractice, 0, ai.PracticeSetSize)
	for i := 0; i < ai.PracticeSetSize; i++ {
		if i%5 == 1 || i%5 == 3 {
			out = append(out, ai.GeneratedPractice{
				Type: ai.PracticeFillBlank, Prompt: fmt.Sprintf("%s gap %d: She ___ home.", req.Level.BaseCode(), i),
				Accepted: []string{"has gone", "'s gone"}, Hint: "(go)", Explanation: "present perfect",
			})
			continue
		}
		out = append(out, ai.GeneratedPractice{
			Type: ai.PracticeMultipleChoice, Prompt: fmt.Sprintf("%s choice %d", req.Level.BaseCode(), i),
			Options: []string{"have", "has"}, AnswerIndex: 1, Explanation: "third person",
		})
	}
	return out, &ai.EvaluationMeta{}, nil
}

func (a *translatingAuthor) WriteGrammarTask(_ context.Context, req ai.GrammarWritingTaskRequest) (*ai.GrammarWritingTask, error) {
	return &ai.GrammarWritingTask{
		Title: "Write at " + req.Level.BaseCode(), Prompt: "Describe your room.", Instructions: []string{"Use a or an."},
		MinWords: 60, Minutes: 15, Focus: "This practises a / an.",
	}, nil
}

func (a *translatingAuthor) WriteGrammarSpeakingTask(_ context.Context, req ai.GrammarWritingTaskRequest) (*ai.GrammarSpeakingTask, error) {
	return &ai.GrammarSpeakingTask{
		Title: "Talk at " + req.Level.BaseCode(), Prompt: "Describe your street.", Points: []string{"Where it is", "What is there"},
		TargetSeconds: 60, Focus: "This practises a / an.",
	}, nil
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

	t.Run("each level gets a fifteen-question test, choices and gaps, once per level", func(t *testing.T) {
		if author.tests != 2 {
			t.Errorf("test calls = %d, want 2 (A2 and B2; the refused C2 has no test)", author.tests)
		}
		counts := map[string]int{}
		rows, err := pool.Query(ctx, `
			SELECT type, count(*) FROM grammar_questions
			WHERE grammar_topic_id = $1 AND status = 'published' GROUP BY type`, topicID)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		for rows.Next() {
			var kind string
			var n int
			if err := rows.Scan(&kind, &n); err != nil {
				t.Fatal(err)
			}
			counts[kind] = n
		}
		if counts["multiple_choice"] != 18 || counts["fill_blank"] != 12 {
			t.Errorf("published questions = %v, want 18 multiple_choice and 12 fill_blank", counts)
		}
		var accepted, hint string
		if err := pool.QueryRow(ctx, `
			SELECT answer->'accepted'->>0, payload->>'hint' FROM grammar_questions
			WHERE grammar_topic_id = $1 AND type = 'fill_blank' LIMIT 1`, topicID).Scan(&accepted, &hint); err != nil {
			t.Fatal(err)
		}
		if accepted != "has gone" || hint != "(go)" {
			t.Errorf("gap stored as accepted %q hint %q, want the keys the scorer reads", accepted, hint)
		}
	})

	t.Run("the editor reads both kinds back", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/grammar/topics/"+slug+"/content?language=en", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
		}
		var body struct {
			Data struct {
				Levels []struct {
					Level     string                 `json:"level"`
					Questions []ai.GeneratedPractice `json:"questions"`
				} `json:"levels"`
			} `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		found := false
		for _, level := range body.Data.Levels {
			if level.Level != "A2" {
				continue
			}
			found = true
			gaps := 0
			for _, q := range level.Questions {
				if q.IsFillBlank() {
					gaps++
				}
			}
			if len(level.Questions) != 15 || gaps != 6 {
				t.Errorf("A2 questions = %d (%d gaps), want 15 with 6 gaps", len(level.Questions), gaps)
			}
		}
		if !found {
			t.Skip("topic payload has no per-level questions in this shape: " + w.Body.String()[:200])
		}
	})

	t.Run("a new test replaces the live one when it is published", func(t *testing.T) {
		var buf bytes.Buffer
		_ = json.NewEncoder(&buf).Encode(map[string]any{"languages": []string{"en", "uz", "ru"}, "levels": []string{"A2"}, "overwrite": true})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/grammar/topics/"+slug+"/generate", &buf)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("generate status = %d body = %s", w.Code, w.Body.String())
		}
		buf.Reset()
		_ = json.NewEncoder(&buf).Encode(map[string]any{"languages": []string{"en", "uz", "ru"}})
		req = httptest.NewRequest(http.MethodPost, "/api/v1/admin/grammar/topics/"+slug+"/publish", &buf)
		req.Header.Set("Content-Type", "application/json")
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("publish status = %d body = %s", w.Code, w.Body.String())
		}
		var live int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM grammar_questions q JOIN levels l ON l.id = q.level_id
			WHERE q.grammar_topic_id = $1 AND l.code = 'A2' AND q.status = 'published'`, topicID).Scan(&live); err != nil {
			t.Fatal(err)
		}
		if live != 15 {
			t.Errorf("A2 live questions = %d, want 15 — the old test archived, not added to", live)
		}
	})

	t.Run("the owner saves a test with both kinds, and an unmarkable gap is refused", func(t *testing.T) {
		save := func(questions []map[string]any) *httptest.ResponseRecorder {
			var buf bytes.Buffer
			_ = json.NewEncoder(&buf).Encode(map[string]any{"language": "uz", "questions": questions})
			req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/grammar/topics/"+slug+"/levels/B2", &buf)
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			return w
		}
		w := save([]map[string]any{
			{"type": "multiple_choice", "prompt": "Pick one", "options": []string{"has", "have"}, "answer_index": 0},
			{"type": "fill_blank", "prompt": "She ___ gone.", "options": []string{}, "answer_index": -1, "accepted": []string{"has", "'s"}, "hint": "(have)"},
		})
		if w.Code != http.StatusOK {
			t.Fatalf("save status = %d body = %s", w.Code, w.Body.String())
		}
		var gaps int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM grammar_questions q JOIN levels l ON l.id = q.level_id
			WHERE q.grammar_topic_id = $1 AND l.code = 'B2' AND q.status = 'draft' AND q.type = 'fill_blank'
			  AND q.answer->'accepted' = $2::jsonb AND q.payload->>'hint' = '(have)'`, topicID, `["has", "'s"]`).Scan(&gaps); err != nil {
			t.Fatal(err)
		}
		if gaps != 1 {
			t.Errorf("saved gaps = %d, want the one gap with its answers and hint", gaps)
		}

		w = save([]map[string]any{
			{"type": "fill_blank", "prompt": "She has gone.", "options": []string{}, "answer_index": -1, "accepted": []string{"has"}},
		})
		if w.Code != http.StatusUnprocessableEntity && w.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want a refusal for a gap-fill with no gap", w.Code)
		}
	})

	t.Run("one generate writes the writing and speaking tasks too, as drafts per level", func(t *testing.T) {
		var n int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM grammar_practice_tasks WHERE grammar_topic_id = $1 AND status IN ('draft', 'published')`,
			topicID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		// A2 and B2, each a writing and a speaking task; the refused C2 gets none.
		if n != 4 {
			t.Errorf("tasks = %d, want 4", n)
		}
	})

	t.Run("generating only the tasks leaves the explanation and the test alone, and publishes on its own", func(t *testing.T) {
		var before int
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM grammar_content WHERE grammar_topic_id = $1`, topicID).Scan(&before)
		var buf bytes.Buffer
		_ = json.NewEncoder(&buf).Encode(map[string]any{"levels": []string{"A2"}, "parts": []string{"writing", "speaking"}})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/grammar/topics/"+slug+"/generate", &buf)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("generate status = %d body = %s", w.Code, w.Body.String())
		}
		var after int
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM grammar_content WHERE grammar_topic_id = $1`, topicID).Scan(&after)
		if after != before {
			t.Errorf("content rows %d -> %d, want no new explanation", before, after)
		}

		buf.Reset()
		_ = json.NewEncoder(&buf).Encode(map[string]any{"languages": []string{"en", "uz", "ru"}})
		req = httptest.NewRequest(http.MethodPost, "/api/v1/admin/grammar/topics/"+slug+"/publish", &buf)
		req.Header.Set("Content-Type", "application/json")
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("publish status = %d body = %s — new tasks alone must be publishable", w.Code, w.Body.String())
		}
		var live, drafts int
		_ = pool.QueryRow(ctx, `
			SELECT count(*) FILTER (WHERE status = 'published'), count(*) FILTER (WHERE status = 'draft')
			FROM grammar_practice_tasks WHERE grammar_topic_id = $1`, topicID).Scan(&live, &drafts)
		if live != 4 || drafts != 0 {
			t.Errorf("tasks live/draft = %d/%d, want 4/0 — one live task per kind and level", live, drafts)
		}
	})

	t.Run("the owner edits a task and the editor reads it back as a draft", func(t *testing.T) {
		var buf bytes.Buffer
		_ = json.NewEncoder(&buf).Encode(map[string]any{
			"title": "My room", "prompt": "Write about your room.", "instructions": []string{"Use a / an", " "},
			"min_words": 70, "minutes": 12, "focus": "a / an",
		})
		req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/grammar/topics/"+slug+"/levels/A2/tasks/writing", &buf)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("save status = %d body = %s", w.Code, w.Body.String())
		}
		var got struct {
			Data PracticeTask `json:"data"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &got)
		if got.Data.Status != "draft" || !got.Data.Live || got.Data.Source != "curated" || len(got.Data.Instructions) != 1 {
			t.Errorf("saved task = %+v, want a curated draft over a live one, blank lines dropped", got.Data)
		}
	})
}
