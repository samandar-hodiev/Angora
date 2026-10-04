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

// wordAuthor writes a fixed batch per level, with one word that is already in the library.
type wordAuthor struct {
	stubAuthor
	stamp string
}

func (a *wordAuthor) WriteVocabulary(_ context.Context, req ai.VocabularyRequest) ([]ai.GeneratedWord, *ai.EvaluationMeta, error) {
	code := req.Level.BaseCode()
	return []ai.GeneratedWord{
		{Term: "zz" + a.stamp + code + "one", PartOfSpeech: "noun", Definition: "a thing", Examples: []string{"One."},
			Translations: map[string]string{"uz": "narsa", "ru": "вещь"}},
		{Term: "zz" + a.stamp + code + "two", PartOfSpeech: "verb", Definition: "to do", Translations: map[string]string{}},
		{Term: "zz" + a.stamp + "manual", PartOfSpeech: "noun", Definition: "already there", Translations: map[string]string{}},
	}, &ai.EvaluationMeta{}, nil
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
			"term": "zz" + stamp + "manual", "part_of_speech": "noun", "definition": "something added by hand",
			"level": "A2", "examples": []string{"Here it is.", " "}, "translations": map[string]string{"uz": "qo'lda"},
		}
		w := call(http.MethodPost, "/vocabulary", input)
		if w.Code != http.StatusOK {
			t.Fatalf("create status = %d body = %s", w.Code, w.Body.String())
		}
		var got struct{ Data Word }
		_ = json.Unmarshal(w.Body.Bytes(), &got)
		if got.Data.Status != "draft" || got.Data.Source != "curated" || got.Data.Translations["uz"] != "qo'lda" || len(got.Data.Examples) != 1 {
			t.Errorf("created %+v", got.Data)
		}
		if w := call(http.MethodPost, "/vocabulary", input); w.Code != http.StatusConflict {
			t.Errorf("duplicate status = %d, want 409", w.Code)
		}
	})

	t.Run("generate writes each level's batch as drafts and skips words already there", func(t *testing.T) {
		w := call(http.MethodPost, "/vocabulary/generate", map[string]any{"levels": []string{"A1", "B2"}, "count": 10})
		if w.Code != http.StatusOK {
			t.Fatalf("generate status = %d body = %s", w.Code, w.Body.String())
		}
		var n int
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM vocabulary WHERE term LIKE $1 AND source = 'ai' AND status = 'draft'`,
			"zz"+stamp+"%").Scan(&n)
		if n != 4 {
			t.Errorf("generated drafts = %d, want 4 (two per level, the existing word skipped)", n)
		}
	})

	t.Run("publishing a level publishes only that level's drafts", func(t *testing.T) {
		w := call(http.MethodPost, "/vocabulary/publish", map[string]any{"level": "A1"})
		if w.Code != http.StatusOK {
			t.Fatalf("publish status = %d body = %s", w.Code, w.Body.String())
		}
		var live int
		_ = pool.QueryRow(ctx, `
			SELECT count(*) FROM vocabulary v JOIN levels l ON l.id = v.level_id
			WHERE v.term LIKE $1 AND v.status = 'published' AND l.code = 'A1'`, "zz"+stamp+"%").Scan(&live)
		if live != 2 {
			t.Errorf("A1 live = %d, want 2", live)
		}
		w = call(http.MethodGet, "/vocabulary?status=draft&q=zz"+stamp, nil)
		var page struct {
			Data vocabularyPage
		}
		_ = json.Unmarshal(w.Body.Bytes(), &page)
		if len(page.Data.Items) != 3 {
			t.Errorf("drafts listed = %d, want 3 (B2 pair and the manual word)", len(page.Data.Items))
		}
	})
}
