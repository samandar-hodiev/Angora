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

// The Grammar Map and the content builder, end to end against PostgreSQL. Run with:
//
//	TEST_DATABASE_URL=postgres://localhost:5432/engora_test?sslmode=disable go test -p 1 -run TestGrammarBuilder ./internal/admin/
//
// The model is stubbed — a test that calls OpenAI is a test that fails when somebody else's
// service is slow — but everything below it is real: the rows, the versioning, the
// validation and what a learner would be served.

type stubAuthor struct {
	calls   int
	levels  []ai.GeneratedGrammarLevel
	fail    bool
	lastReq ai.GrammarAuthorRequest
}

func (s *stubAuthor) AuthorGrammarContent(_ context.Context, req ai.GrammarAuthorRequest) (*ai.GeneratedGrammarContent, *ai.EvaluationMeta, error) {
	s.calls++
	s.lastReq = req
	if s.fail {
		return nil, nil, fmt.Errorf("provider unavailable")
	}
	return &ai.GeneratedGrammarContent{Levels: s.levels}, &ai.EvaluationMeta{}, nil
}

func level(code, explanation string, practice int) ai.GeneratedGrammarLevel {
	questions := make([]ai.GeneratedPractice, 0, practice)
	for i := 0; i < practice; i++ {
		questions = append(questions, ai.GeneratedPractice{
			Prompt: fmt.Sprintf("%s question %d", code, i+1), Options: []string{"have", "has"},
			AnswerIndex: i % 2, Explanation: "because", TargetRule: "auxiliary",
		})
	}
	return ai.GeneratedGrammarLevel{
		Level: code, Applicable: true, Title: "Present Perfect (" + code + ")",
		Summary: code + " summary", Intro: code + " intro", Explanation: explanation,
		Usage:    []string{"experience"},
		Examples: []ai.GeneratedExample{{Text: "I have finished.", Note: ""}},
		Practice: questions,
	}
}

func TestGrammarBuilderFlowPostgres(t *testing.T) {
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
		Email: fmt.Sprintf("author-%d@example.com", time.Now().UnixNano()), DisplayName: "Author", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, owner.ID) })

	// A topic of our own, so the test never depends on what the curriculum happens to hold.
	var categoryID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM grammar_categories LIMIT 1`).Scan(&categoryID); err != nil {
		t.Skip("no grammar categories seeded")
	}
	slug := fmt.Sprintf("builder-present-perfect-%d", time.Now().UnixNano())
	var topicID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO grammar_topics (slug, name, description, category_id, level_id, status, cefr_levels)
		VALUES ($1, 'Present Perfect (builder test)', 'For experience.', $2,
		        (SELECT id FROM levels WHERE code = 'B1'), 'draft', ARRAY['A2','B1','B2'])
		RETURNING id`, slug, categoryID).Scan(&topicID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM grammar_topics WHERE id = $1`, topicID) })

	author := &stubAuthor{levels: []ai.GeneratedGrammarLevel{
		level("A2", "A2 explanation, short sentences.", 3),
		level("B1", "B1 explanation, contrasted with the past simple.", 3),
		{Level: "C2", Applicable: false, Reason: "Nothing left to teach at C2."},
	}}

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: owner.ID, Role: authz.RoleAdmin, SessionID: uuid.New()})
		c.Next()
	})
	NewModule(pool, &recordingAudit{}).WithAuthor(author).RegisterRoutes(r.Group("/api/v1"))

	do := func(method, path string, body any) (*httptest.ResponseRecorder, map[string]any) {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		req := httptest.NewRequest(method, "/api/v1"+path, &buf)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var envelope map[string]any
		if w.Body.Len() > 0 {
			_ = json.Unmarshal(w.Body.Bytes(), &envelope)
		}
		return w, envelope
	}

	// mapTopic finds our topic in the map and returns its content block.
	mapTopic := func(t *testing.T) map[string]any {
		t.Helper()
		w, body := do(http.MethodGet, "/admin/grammar/map?search="+slug, nil)
		if w.Code != http.StatusOK {
			t.Fatalf("map status = %d body = %s", w.Code, w.Body.String())
		}
		categories, _ := body["data"].([]any)
		for _, raw := range categories {
			category, _ := raw.(map[string]any)
			topics, _ := category["topics"].([]any)
			for _, rawTopic := range topics {
				topic, _ := rawTopic.(map[string]any)
				if topic["slug"] == slug {
					return topic
				}
			}
		}
		t.Fatalf("topic %s is not in the map", slug)
		return nil
	}

	t.Run("a topic with no content is on the map as not created", func(t *testing.T) {
		topic := mapTopic(t)
		content, _ := topic["content"].(map[string]any)
		if content["status"] != ContentNotCreated {
			t.Errorf("status = %v, want not_created", content["status"])
		}
		levels, _ := topic["levels"].([]any)
		if len(levels) != 6 {
			t.Fatalf("levels = %d, want all six offered so the gaps are visible", len(levels))
		}
		for _, raw := range levels {
			entry, _ := raw.(map[string]any)
			if entry["status"] != ContentNotCreated {
				t.Errorf("%v = %v, want not_created", entry["level"], entry["status"])
			}
		}
	})

	t.Run("generating writes drafts, never published content", func(t *testing.T) {
		w, body := do(http.MethodPost, "/admin/grammar/topics/"+slug+"/generate",
			map[string]any{"language": "en", "levels": []string{"A2", "B1", "C2"}})
		if w.Code != http.StatusOK {
			t.Fatalf("generate status = %d body = %s", w.Code, w.Body.String())
		}
		if author.calls != 1 {
			t.Errorf("model calls = %d, want exactly one for three levels", author.calls)
		}
		if len(author.lastReq.Levels) != 3 {
			t.Errorf("the model was asked for %d levels, want 3", len(author.lastReq.Levels))
		}

		data, _ := body["data"].(map[string]any)
		levels, _ := data["levels"].([]any)
		byLevel := map[string]map[string]any{}
		for _, raw := range levels {
			entry, _ := raw.(map[string]any)
			byLevel[entry["level"].(string)] = entry
		}
		if byLevel["A2"]["status"] != "draft" || byLevel["B1"]["status"] != "draft" {
			t.Errorf("A2/B1 = %v/%v, want draft", byLevel["A2"]["status"], byLevel["B1"]["status"])
		}
		// A refusal is an answer, stored as one.
		if byLevel["C2"]["status"] != ContentNotApplicable {
			t.Errorf("C2 = %v, want not_applicable", byLevel["C2"]["status"])
		}
		if byLevel["B2"]["status"] != ContentNotCreated {
			t.Errorf("B2 = %v, want it untouched", byLevel["B2"]["status"])
		}

		// Levels must genuinely differ; copying one into the others is the failure mode.
		a2, _ := json.Marshal(byLevel["A2"]["body"])
		b1, _ := json.Marshal(byLevel["B1"]["body"])
		if bytes.Equal(a2, b1) {
			t.Error("A2 and B1 bodies are identical — the levels are not adaptive")
		}

		var published int
		_ = pool.QueryRow(ctx, `
			SELECT count(*) FROM grammar_content WHERE grammar_topic_id = $1 AND status = 'published'`,
			topicID).Scan(&published)
		if published != 0 {
			t.Errorf("published rows after generating = %d, want 0 — the model does not publish", published)
		}
	})

	t.Run("the map now shows a draft", func(t *testing.T) {
		content, _ := mapTopic(t)["content"].(map[string]any)
		if content["status"] != ContentDraft {
			t.Errorf("status = %v, want draft", content["status"])
		}
	})

	t.Run("regenerating over hand-edited work asks first", func(t *testing.T) {
		// An owner edits B1 by hand.
		if w, _ := do(http.MethodPut, "/admin/grammar/topics/"+slug+"/levels/B1", map[string]any{
			"language": "en", "title": "Present Perfect", "summary": "Edited by a person",
			"body": map[string]any{"intro": "Mine", "explanation": "Written by hand.",
				"examples": []map[string]any{{"text": "I have written this."}}},
		}); w.Code != http.StatusOK {
			t.Fatalf("save status = %d", w.Code)
		}

		w, body := do(http.MethodPost, "/admin/grammar/topics/"+slug+"/generate",
			map[string]any{"language": "en", "levels": []string{"B1"}})
		if w.Code != http.StatusConflict {
			t.Fatalf("status = %d, want 409 before replacing hand-written content", w.Code)
		}
		errObj, _ := body["error"].(map[string]any)
		details, _ := errObj["details"].(map[string]any)
		levels, _ := details["levels"].([]any)
		if len(levels) != 1 || levels[0] != "B1" {
			t.Errorf("details = %v, want the B1 level named", details)
		}
	})

	t.Run("publishing is refused while something is wrong", func(t *testing.T) {
		// Empty out A2, so there is a real reason not to publish.
		if _, err := pool.Exec(ctx, `
			UPDATE grammar_content SET body = '{}'::jsonb, title = ''
			WHERE grammar_topic_id = $1 AND level_code = 'A2' AND language = 'en'`, topicID); err != nil {
			t.Fatal(err)
		}
		w, body := do(http.MethodPost, "/admin/grammar/topics/"+slug+"/publish",
			map[string]any{"language": "en"})
		if w.Code != http.StatusConflict {
			t.Fatalf("status = %d, want 409", w.Code)
		}
		errObj, _ := body["error"].(map[string]any)
		details, _ := errObj["details"].(map[string]any)
		issues, _ := details["issues"].([]any)
		if len(issues) == 0 {
			t.Fatal("a refusal with no issues tells the owner nothing")
		}
		first, _ := issues[0].(map[string]any)
		if first["level"] != "A2" {
			t.Errorf("issue = %v, want it to name A2", first)
		}

		var published int
		_ = pool.QueryRow(ctx, `
			SELECT count(*) FROM grammar_content WHERE grammar_topic_id = $1 AND status = 'published'`,
			topicID).Scan(&published)
		if published != 0 {
			t.Error("a refused publish must publish nothing at all, not the levels that passed")
		}
	})

	t.Run("publishing one good level makes the topic partially published", func(t *testing.T) {
		w, _ := do(http.MethodPost, "/admin/grammar/topics/"+slug+"/publish",
			map[string]any{"language": "en", "levels": []string{"B1"}})
		if w.Code != http.StatusOK {
			t.Fatalf("publish status = %d body = %s", w.Code, w.Body.String())
		}
		content, _ := mapTopic(t)["content"].(map[string]any)
		if content["status"] != ContentPartiallyPublished {
			t.Errorf("status = %v, want partially_published (B1 live, A2 still a draft)", content["status"])
		}
		if content["published_levels"] != float64(1) {
			t.Errorf("published_levels = %v, want 1", content["published_levels"])
		}
		// Publishing content puts the topic itself in the library, or nobody can reach it.
		var topicStatus string
		_ = pool.QueryRow(ctx, `SELECT status FROM grammar_topics WHERE id = $1`, topicID).Scan(&topicStatus)
		if topicStatus != "published" {
			t.Errorf("topic status = %q, want published", topicStatus)
		}
	})

	t.Run("editing a published level leaves the learner on the old version", func(t *testing.T) {
		var liveBefore string
		if err := pool.QueryRow(ctx, `
			SELECT body ->> 'explanation' FROM grammar_content
			WHERE grammar_topic_id = $1 AND language = 'en' AND level_code = 'B1' AND status = 'published'`,
			topicID).Scan(&liveBefore); err != nil {
			t.Fatal(err)
		}

		if w, _ := do(http.MethodPut, "/admin/grammar/topics/"+slug+"/levels/B1", map[string]any{
			"language": "en", "title": "Present Perfect",
			"body": map[string]any{"intro": "v2", "explanation": "A rewrite that is not live yet.",
				"examples": []map[string]any{{"text": "I have rewritten this."}}},
		}); w.Code != http.StatusOK {
			t.Fatalf("save status = %d", w.Code)
		}

		var liveAfter string
		_ = pool.QueryRow(ctx, `
			SELECT body ->> 'explanation' FROM grammar_content
			WHERE grammar_topic_id = $1 AND language = 'en' AND level_code = 'B1' AND status = 'published'`,
			topicID).Scan(&liveAfter)
		if liveAfter != liveBefore {
			t.Errorf("the published text changed under the learner: %q became %q", liveBefore, liveAfter)
		}

		var live, draft int
		_ = pool.QueryRow(ctx, `
			SELECT count(*) FILTER (WHERE status = 'published'), count(*) FILTER (WHERE status = 'draft')
			FROM grammar_content WHERE grammar_topic_id = $1 AND language = 'en' AND level_code = 'B1'`,
			topicID).Scan(&live, &draft)
		if live != 1 || draft != 1 {
			t.Errorf("published = %d, draft = %d, want one of each", live, draft)
		}
	})

	t.Run("a provider failure is reported, not swallowed", func(t *testing.T) {
		author.fail = true
		t.Cleanup(func() { author.fail = false })
		w, body := do(http.MethodPost, "/admin/grammar/topics/"+slug+"/generate",
			map[string]any{"language": "en", "levels": []string{"B2"}, "overwrite": true})
		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("status = %d, want 503", w.Code)
		}
		errObj, _ := body["error"].(map[string]any)
		message, _ := errObj["message"].(string)
		if message == "" || message == "Something went wrong" {
			t.Errorf("message = %q, want something the owner can act on", message)
		}
	})
}
