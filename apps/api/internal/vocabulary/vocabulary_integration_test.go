package vocabulary

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
	"sync/atomic"
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

// fakeWriter counts its calls, so the tests can tell a cached answer from a new one.
type fakeWriter struct {
	enriched, compared, laddered atomic.Int32
}

func (f *fakeWriter) EnrichWord(_ context.Context, req ai.EnrichRequest) (ai.WordUsage, *ai.EvaluationMeta, error) {
	f.enriched.Add(1)
	return ai.WordUsage{UsageNote: "Used about " + req.Term, Register: "neutral",
		Collocations: []string{"a full-time " + req.Term}, Synonyms: []string{"zzsyn"}}, &ai.EvaluationMeta{}, nil
}

func (f *fakeWriter) CompareWords(_ context.Context, req ai.CompareRequest) (*ai.WordComparison, *ai.EvaluationMeta, error) {
	f.compared.Add(1)
	words := []ai.ComparedWord{}
	for _, t := range req.Terms {
		words = append(words, ai.ComparedWord{Term: t, Meaning: "meaning of " + t})
	}
	return &ai.WordComparison{Verdict: "They differ.", Interchangeable: "sometimes", Words: words}, &ai.EvaluationMeta{}, nil
}

func (f *fakeWriter) WriteLadder(_ context.Context, term string, _ *uuid.UUID) (*ai.Ladder, *ai.EvaluationMeta, error) {
	f.laddered.Add(1)
	return ai.CleanLadder(term, "katta", "", []ai.LadderRung{{Level: "A1", Term: term}, {Level: "B2", Term: "enormous"}}), &ai.EvaluationMeta{}, nil
}

func (f *fakeWriter) TranslateDefinitions(_ context.Context, items []ai.DefinitionItem) (map[string]map[string]string, error) {
	out := map[string]map[string]string{}
	for _, it := range items {
		out[it.ID] = map[string]string{"uz": "ma'no", "ru": "значение"}
	}
	return out, nil
}

type countingPlans struct{ used, released atomic.Int32 }

func (p *countingPlans) ConsumeUsage(context.Context, uuid.UUID, string, int) error {
	p.used.Add(1)
	return nil
}

func (p *countingPlans) ReleaseUsage(context.Context, uuid.UUID, string, int) error {
	p.released.Add(1)
	return nil
}

func TestLearnerVocabularyPostgres(t *testing.T) {
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

	// Letters only: a comparison accepts nothing but English letters.
	stamp := strings.Map(func(r rune) rune { return 'a' + r - '0' }, fmt.Sprintf("%d", time.Now().UnixNano()))
	learner, err := users.NewPostgresRepository(pool).CreateAccount(ctx, users.NewAccount{
		Email: "vocab-learner-" + stamp + "@example.com", DisplayName: "Learner", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	topic := "zztopic" + stamp
	ids := map[string]uuid.UUID{}
	for _, w := range []struct{ term, level, pos string }{{"job", "A1", "noun"}, {"occupation", "B2", "noun"}, {"employ", "B1", "verb"}} {
		term := "zz" + stamp + w.term
		var id uuid.UUID
		if err := pool.QueryRow(ctx, `
			INSERT INTO vocabulary (term, part_of_speech, definition, level_id, tags, translations, level_content, status, published_at)
			VALUES ($1, $2, 'meaning', (SELECT id FROM levels WHERE code = $3), $4, '{"uz": "kasb"}',
			        jsonb_build_object($3::text, jsonb_build_object('definition', 'meaning', 'examples', '[]'::jsonb)), 'published', now())
			RETURNING id`, term, w.pos, w.level, []string{topic}).Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids[w.term] = id
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM vocabulary WHERE term LIKE $1`, "zz"+stamp+"%")
		_, _ = pool.Exec(context.Background(), `DELETE FROM vocabulary_comparisons WHERE terms_key LIKE $1`, "%zz"+stamp+"%")
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, learner.ID)
	})

	writer, plans := &fakeWriter{}, &countingPlans{}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: learner.ID, Role: authz.RoleUser, SessionID: uuid.New()})
		c.Next()
	})
	NewModule(Deps{Pool: pool, AI: writer, Plans: plans}).RegisterRoutes(r.Group("/api/v1"))

	call := func(method, path string, body any, out any) int {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		req := httptest.NewRequest(method, "/api/v1/vocabulary"+path, &buf)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if out != nil {
			var env struct {
				Data json.RawMessage `json:"data"`
			}
			_ = json.Unmarshal(w.Body.Bytes(), &env)
			_ = json.Unmarshal(env.Data, out)
		}
		return w.Code
	}

	t.Run("the library filters by topic, part of speech and level, and counts each", func(t *testing.T) {
		var page libraryPage
		if code := call(http.MethodGet, "/library?topic="+topic, nil, &page); code != http.StatusOK || len(page.Items) != 3 {
			t.Fatalf("topic: %d, %d words", code, len(page.Items))
		}
		if page.Items[0].Level == nil || *page.Items[0].Level != "A1" {
			t.Fatalf("sorted by level, the A1 word comes first: %+v", page.Items[0])
		}
		call(http.MethodGet, "/library?topic="+topic+"&pos=verb", nil, &page)
		if len(page.Items) != 1 || !strings.HasSuffix(page.Items[0].Term, "employ") {
			t.Fatalf("part of speech: %+v", page.Items)
		}
		call(http.MethodGet, "/library?topic="+topic+"&level=B2", nil, &page)
		if len(page.Items) != 1 || !strings.HasSuffix(page.Items[0].Term, "occupation") {
			t.Fatalf("level: %+v", page.Items)
		}
		found := false
		for _, f := range page.Facets.Topics {
			found = found || f.Value == topic && f.Count == 3
		}
		if !found {
			t.Fatalf("topic facet missing: %+v", page.Facets.Topics)
		}
		// Definitions without Uzbek and Russian are translated in the background.
		var translated int
		for range 40 {
			_ = pool.QueryRow(ctx, `SELECT count(*) FROM vocabulary WHERE term LIKE $1 AND translations ? 'def_uz'`, "zz"+stamp+"%").Scan(&translated)
			if translated == 3 {
				break
			}
			time.Sleep(50 * time.Millisecond)
		}
		if translated != 3 {
			t.Fatalf("definitions translated: %d of 3", translated)
		}
	})

	t.Run("a word is given usage notes once, the first time it is opened", func(t *testing.T) {
		var w WordDetail
		if code := call(http.MethodGet, "/words/"+ids["job"].String(), nil, &w); code != http.StatusOK {
			t.Fatalf("word: %d", code)
		}
		if w.Usage.UsageNote == "" || len(w.Usage.Collocations) != 1 || len(w.SameTopic) != 2 {
			t.Fatalf("detail: %+v", w)
		}
		call(http.MethodGet, "/words/"+ids["job"].String(), nil, &w)
		if n := writer.enriched.Load(); n != 1 {
			t.Fatalf("usage written %d times, want once", n)
		}
	})

	t.Run("a comparison is paid for once and read back for free", func(t *testing.T) {
		terms := []string{"zz" + stamp + "job", "zz" + stamp + "occupation"}
		var res ComparisonResponse
		if code := call(http.MethodPost, "/compare", map[string]any{"terms": terms}, &res); code != http.StatusOK || res.Cached {
			t.Fatalf("first: %d cached=%v", code, res.Cached)
		}
		if len(res.Library) != 2 {
			t.Fatalf("both words are in the library: %v", res.Library)
		}
		call(http.MethodPost, "/compare", map[string]any{"terms": []string{terms[1], strings.ToUpper(terms[0])}}, &res)
		if !res.Cached || writer.compared.Load() != 1 || plans.used.Load() != 1 {
			t.Fatalf("second: cached=%v compared=%d charged=%d", res.Cached, writer.compared.Load(), plans.used.Load())
		}
		if code := call(http.MethodPost, "/compare", map[string]any{"terms": []string{"job", "job"}}, nil); code != http.StatusUnprocessableEntity && code != http.StatusBadRequest {
			t.Fatalf("the same word twice: %d", code)
		}
	})

	t.Run("a ladder is written once and filters by kind work", func(t *testing.T) {
		var res LadderResponse
		if code := call(http.MethodPost, "/ladder", map[string]any{"term": "zz" + stamp + "job"}, &res); code != http.StatusOK || res.Cached {
			t.Fatalf("ladder: %d cached=%v", code, res.Cached)
		}
		if len(res.Ladder.Rungs) != 6 || res.Ladder.Rungs[3].Term != "enormous" || len(res.Library) != 1 {
			t.Fatalf("ladder: %+v library %v", res.Ladder.Rungs, res.Library)
		}
		call(http.MethodPost, "/ladder", map[string]any{"term": "zz" + stamp + "job"}, &res)
		if !res.Cached || writer.laddered.Load() != 1 {
			t.Fatalf("second ladder: cached=%v written=%d", res.Cached, writer.laddered.Load())
		}
		_, _ = pool.Exec(ctx, `UPDATE vocabulary SET kind = 'phrase', register = 'informal' WHERE id = $1`, ids["employ"])
		var page libraryPage
		call(http.MethodGet, "/library?topic="+topic+"&kind=phrase&register=informal", nil, &page)
		if len(page.Items) != 1 || page.Items[0].Kind != "phrase" || page.Items[0].Definition != "meaning" {
			t.Fatalf("kind filter: %+v", page.Items)
		}
	})

	t.Run("a review schedules the word and is recorded", func(t *testing.T) {
		id := ids["occupation"].String()
		if code := call(http.MethodPost, "/review/"+id, map[string]any{"rating": "good"}, nil); code != http.StatusNotFound {
			t.Fatalf("a word not in the deck cannot be reviewed: %d", code)
		}
		call(http.MethodPost, "/deck/"+id, nil, nil)
		var res reviewResult
		if code := call(http.MethodPost, "/review/"+id, map[string]any{"rating": "good"}, &res); code != http.StatusOK {
			t.Fatalf("review: %d", code)
		}
		if res.IntervalDays != 1 || res.Status != "learning" || !res.DueAt.After(time.Now().Add(20*time.Hour)) {
			t.Fatalf("after one good review: %+v", res)
		}
		call(http.MethodPost, "/review/"+id, map[string]any{"rating": "again"}, &res)
		if res.IntervalDays != 0 || res.DueAt.After(time.Now().Add(15*time.Minute)) {
			t.Fatalf("after again: %+v", res)
		}
		var n int
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM vocabulary_reviews WHERE user_id = $1`, learner.ID).Scan(&n)
		if n != 2 {
			t.Fatalf("reviews recorded: %d", n)
		}
		call(http.MethodPost, "/deck/"+id+"/known", nil, nil)
		var w WordDetail
		call(http.MethodGet, "/words/"+id, nil, &w)
		if w.Deck == nil || w.Deck.Status != "mastered" || w.Deck.Reviews != 2 {
			t.Fatalf("I know it: %+v", w.Deck)
		}
	})
}
