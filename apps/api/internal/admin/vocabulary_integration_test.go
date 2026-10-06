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
	"strings"
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

// wordAuthor writes the batch it is asked for, each word explained for every requested
// level — and slips in one word that is already in the library, to be skipped.
type wordAuthor struct {
	stubAuthor
	stamp  string
	mu     sync.Mutex
	n      int
	topics []string
}

func (a *wordAuthor) WriteVocabulary(_ context.Context, req ai.VocabularyRequest) ([]ai.GeneratedWord, *ai.EvaluationMeta, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.topics = append(a.topics, req.Topics...)
	out := []ai.GeneratedWord{{Term: "zz" + a.stamp + "manual", PartOfSpeech: "noun",
		LevelContent: map[string]ai.LevelText{"A1": {Definition: "already there"}}}}
	for i := 0; i < req.Count; i++ {
		a.n++
		out = append(out, ai.GeneratedWord{
			Term: fmt.Sprintf("zz%sword%d", a.stamp, a.n), PartOfSpeech: "noun", Level: "B1",
			Translations: map[string]string{"uz": "so'z"},
			LevelContent: map[string]ai.LevelText{"B1": {Definition: "meaning", Examples: []string{"An example."}}},
			Senses:       []ai.Sense{{Definition: "another meaning", Level: "C1", Example: "Another."}},
		})
	}
	return ai.UsableWords(out, map[string]bool{}), &ai.EvaluationMeta{}, nil
}

func (a *wordAuthor) WriteIrregularVerbs(_ context.Context, count int, _ []string, _, _ string) ([]ai.IrregularVerbDraft, error) {
	return []ai.IrregularVerbDraft{
		{Base: "zz" + a.stamp + "sing", Past: "zz" + a.stamp + "sang", Participle: "zz" + a.stamp + "sung", Level: "B1", Uz: "kuylamoq"},
		{Base: "zz" + a.stamp + "fly", Past: "zz" + a.stamp + "flew", Participle: "zz" + a.stamp + "flown", Level: "C1"},
	}, nil
}

// CheckLevels agrees with every word but those whose number is a multiple of three, which it
// puts at A2: those must come out unverified, at A2.
func (a *wordAuthor) CheckLevels(_ context.Context, items []ai.LevelCheckItem) (map[string]string, error) {
	out := map[string]string{}
	for _, it := range items {
		var n int
		_, _ = fmt.Sscanf(it.Term[len("zz"+a.stamp+"word"):], "%d", &n)
		out[strings.ToLower(it.Term)] = map[bool]string{true: "A2", false: "B1"}[n%3 == 0]
	}
	return out, nil
}

func TestVocabularyAuthoringPostgres(t *testing.T) {
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

	stamp := fmt.Sprintf("%d", time.Now().UnixNano())
	owner, err := users.NewPostgresRepository(pool).CreateAccount(ctx, users.NewAccount{
		Email: "vocab-" + stamp + "@example.com", DisplayName: "Author", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM vocabulary WHERE term LIKE $1`, "zz"+stamp+"%")
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, owner.ID)
	})

	author := &wordAuthor{stamp: stamp}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: owner.ID, Role: authz.RoleAdmin, SessionID: uuid.New()})
		c.Next()
	})
	NewModule(pool, &recordingAudit{}).WithAuthor(author).RegisterRoutes(r.Group("/api/v1"))

	call := func(method, path string, body any) *httptest.ResponseRecorder {
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		req := httptest.NewRequest(method, "/api/v1/admin"+path, &buf)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	t.Run("a word added by hand is a curated draft, and the same word twice is refused", func(t *testing.T) {
		input := map[string]any{
			"term": "zz" + stamp + "manual", "part_of_speech": "noun", "level": "A2",
			"level_content": map[string]any{
				"A1": map[string]any{"definition": "something added by hand", "examples": []string{"Here it is.", " "}},
				"C1": map[string]any{"definition": "a term entered manually by an editor", "examples": []string{}},
			},
			"translations": map[string]string{"uz": "qo'lda"},
		}
		w := call(http.MethodPost, "/vocabulary", input)
		if w.Code != http.StatusOK {
			t.Fatalf("create status = %d body = %s", w.Code, w.Body.String())
		}
		var got struct{ Data Word }
		_ = json.Unmarshal(w.Body.Bytes(), &got)
		if got.Data.Status != "draft" || got.Data.Source != "curated" || got.Data.Translations["uz"] != "qo'lda" ||
			len(got.Data.LevelContent) != 2 || len(got.Data.LevelContent["A1"].Examples) != 1 {
			t.Errorf("created %+v", got.Data)
		}
		if w := call(http.MethodPost, "/vocabulary", input); w.Code != http.StatusConflict {
			t.Errorf("duplicate status = %d, want 409", w.Code)
		}
	})

	t.Run("generate writes the count asked for, from the topics, each level checked, never a word twice", func(t *testing.T) {
		w := call(http.MethodPost, "/vocabulary/generate", map[string]any{"count": 12, "kind": "word", "topics": []string{"Animals", "plants"}})
		if w.Code != http.StatusOK {
			t.Fatalf("generate status = %d body = %s", w.Code, w.Body.String())
		}
		var res struct {
			Data struct {
				Added   int `json:"added"`
				Skipped int `json:"skipped_duplicates"`
			}
		}
		_ = json.Unmarshal(w.Body.Bytes(), &res)
		if res.Data.Added != 12 || res.Data.Skipped == 0 {
			t.Errorf("added %d skipped %d, want 12 added and the existing word skipped", res.Data.Added, res.Data.Skipped)
		}
		var checked, unverified, atA2, withSenses int
		_ = pool.QueryRow(ctx, `
			SELECT count(*) FILTER (WHERE v.level_source = 'ai_checked'),
			       count(*) FILTER (WHERE v.level_source = 'ai'),
			       count(*) FILTER (WHERE l.code = 'A2' AND v.level_content ? 'A2' AND NOT v.level_content ? 'B1'),
			       count(*) FILTER (WHERE jsonb_array_length(v.senses) = 1 AND v.kind = 'word')
			FROM vocabulary v JOIN levels l ON l.id = v.level_id
			WHERE v.term LIKE $1 AND v.source = 'ai'`, "zz"+stamp+"word%").Scan(&checked, &unverified, &atA2, &withSenses)
		if checked+unverified != 12 || unverified == 0 || atA2 != unverified || withSenses != 12 {
			t.Errorf("checked %d unverified %d at A2 %d with senses %d", checked, unverified, atA2, withSenses)
		}
		author.mu.Lock()
		topics := strings.Join(author.topics, ",")
		author.mu.Unlock()
		if !strings.Contains(topics, "animals") || !strings.Contains(topics, "plants") {
			t.Errorf("batches were asked for topics %q, want both animals and plants", topics)
		}
		if w := call(http.MethodPost, "/vocabulary/generate", map[string]any{"count": 5}); w.Code != http.StatusUnprocessableEntity && w.Code != http.StatusBadRequest {
			t.Errorf("count 5 status = %d, want refused (10 is the least)", w.Code)
		}
	})

	t.Run("confirming a level makes it curated and moves its explanation", func(t *testing.T) {
		var id uuid.UUID
		_ = pool.QueryRow(ctx, `SELECT id FROM vocabulary WHERE term LIKE $1 AND level_source = 'ai' LIMIT 1`, "zz"+stamp+"word%").Scan(&id)
		if w := call(http.MethodPost, "/vocabulary/"+id.String()+"/level", map[string]any{"level": "B1"}); w.Code != http.StatusOK {
			t.Fatalf("level status = %d body = %s", w.Code, w.Body.String())
		}
		var source string
		var hasB1 bool
		_ = pool.QueryRow(ctx, `SELECT level_source, level_content ? 'B1' FROM vocabulary WHERE id = $1`, id).Scan(&source, &hasB1)
		if source != "curated" || !hasB1 {
			t.Errorf("source %q, B1 explanation %v", source, hasB1)
		}
	})

	t.Run("irregular verbs: a regular verb is refused, drafts are added and published", func(t *testing.T) {
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `DELETE FROM irregular_verbs WHERE base LIKE $1`, "zz"+stamp+"%")
		})
		if w := call(http.MethodPost, "/irregular-verbs", map[string]any{
			"base": "work", "past": "worked", "past_participle": "worked", "level": "A1",
		}); w.Code != http.StatusUnprocessableEntity && w.Code != http.StatusBadRequest {
			t.Fatalf("a regular verb: status %d, want refused", w.Code)
		}
		w := call(http.MethodPost, "/irregular-verbs", map[string]any{
			"base": "zz" + stamp + "go", "past": "zz" + stamp + "went", "past_participle": "zz" + stamp + "gone", "level": "A1",
		})
		var created struct{ Data AdminVerb }
		_ = json.Unmarshal(w.Body.Bytes(), &created)
		if w.Code != http.StatusOK || created.Data.Status != "draft" || created.Data.Pattern != "ABC" {
			t.Fatalf("create: %d %+v", w.Code, created.Data)
		}
		if w := call(http.MethodPost, "/irregular-verbs/generate", map[string]any{"count": 5, "max_level": "B2"}); w.Code != http.StatusOK {
			t.Fatalf("generate: %d %s", w.Code, w.Body.String())
		}
		var drafts, c1 int
		_ = pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status = 'draft'), count(*) FILTER (WHERE level_code = 'C1')
			FROM irregular_verbs WHERE base LIKE $1`, "zz"+stamp+"%").Scan(&drafts, &c1)
		if drafts != 2 || c1 != 0 {
			t.Fatalf("drafts %d (want the hand-added verb and the B1 one), C1 above the range %d", drafts, c1)
		}
		call(http.MethodPost, "/irregular-verbs/publish", map[string]any{"ids": []string{created.Data.ID.String()}})
		var status string
		_ = pool.QueryRow(ctx, `SELECT status FROM irregular_verbs WHERE id = $1`, created.Data.ID).Scan(&status)
		if status != "published" {
			t.Fatalf("published: %s", status)
		}
	})

	t.Run("publishing a level publishes only that level's drafts", func(t *testing.T) {
		w := call(http.MethodPost, "/vocabulary/publish", map[string]any{"level": "B1"})
		if w.Code != http.StatusOK {
			t.Fatalf("publish status = %d body = %s", w.Code, w.Body.String())
		}
		var wrong int
		_ = pool.QueryRow(ctx, `
			SELECT count(*) FROM vocabulary v JOIN levels l ON l.id = v.level_id
			WHERE v.term LIKE $1 AND (v.status = 'published') <> (l.code = 'B1')`, "zz"+stamp+"%").Scan(&wrong)
		if wrong != 0 {
			t.Errorf("%d words where live is not the same as being at B1", wrong)
		}
	})
}
