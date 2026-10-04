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

// wordAuthor writes the batch it is asked for, each word explained for every requested
// level — and slips in one word that is already in the library, to be skipped.
type wordAuthor struct {
	stubAuthor
	stamp string
	mu    sync.Mutex
	n     int
}

func (a *wordAuthor) WriteVocabulary(_ context.Context, req ai.VocabularyRequest) ([]ai.GeneratedWord, *ai.EvaluationMeta, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := []ai.GeneratedWord{{Term: "zz" + a.stamp + "manual", PartOfSpeech: "noun",
		LevelContent: map[string]ai.LevelText{"A1": {Definition: "already there"}}}}
	for i := 0; i < req.Count; i++ {
		a.n++
		content := map[string]ai.LevelText{}
		for _, l := range req.Levels {
			content[l.BaseCode()] = ai.LevelText{Definition: "meaning at " + l.BaseCode(), Examples: []string{"An example."}}
		}
		out = append(out, ai.GeneratedWord{
			Term: fmt.Sprintf("zz%sword%d", a.stamp, a.n), PartOfSpeech: "noun", Level: "B1",
			Translations: map[string]string{"uz": "so'z"}, LevelContent: content,
		})
	}
	return ai.UsableWords(out, map[string]bool{}), &ai.EvaluationMeta{}, nil
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

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: owner.ID, Role: authz.RoleAdmin, SessionID: uuid.New()})
		c.Next()
	})
	NewModule(pool, &recordingAudit{}).WithAuthor(&wordAuthor{stamp: stamp}).RegisterRoutes(r.Group("/api/v1"))

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

	t.Run("generate writes the count asked for, each word explained per level, never a word twice", func(t *testing.T) {
		w := call(http.MethodPost, "/vocabulary/generate", map[string]any{"count": 12, "levels": []string{"A1", "B2", "C2"}})
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
		var levels int
		_ = pool.QueryRow(ctx, `
			SELECT count(*) FROM vocabulary
			WHERE term LIKE $1 AND source = 'ai' AND level_content ?& array['A1','B2','C2']`, "zz"+stamp+"word%").Scan(&levels)
		if levels != 12 {
			t.Errorf("words explained for A1, B2 and C2 = %d, want all 12", levels)
		}
		if w := call(http.MethodPost, "/vocabulary/generate", map[string]any{"count": 5, "levels": []string{"A1"}}); w.Code != http.StatusUnprocessableEntity && w.Code != http.StatusBadRequest {
			t.Errorf("count 5 status = %d, want refused (10 is the least)", w.Code)
		}
	})

	t.Run("publishing a level publishes only that level's drafts", func(t *testing.T) {
		w := call(http.MethodPost, "/vocabulary/publish", map[string]any{"level": "B1"})
		if w.Code != http.StatusOK {
			t.Fatalf("publish status = %d body = %s", w.Code, w.Body.String())
		}
		var live, draft int
		_ = pool.QueryRow(ctx, `
			SELECT count(*) FILTER (WHERE status = 'published'), count(*) FILTER (WHERE status = 'draft')
			FROM vocabulary WHERE term LIKE $1`, "zz"+stamp+"%").Scan(&live, &draft)
		if live != 12 || draft != 1 {
			t.Errorf("live/draft = %d/%d, want the 12 B1 words live and the A2 word still a draft", live, draft)
		}
	})
}
