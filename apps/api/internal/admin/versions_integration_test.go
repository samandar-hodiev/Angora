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
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/middleware"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
)

// Content revisions and multilingual grammar explanations, against PostgreSQL. Run with:
//
//	TEST_DATABASE_URL=postgres://localhost:5432/engora_test?sslmode=disable go test -p 1 -run TestContentRevisions ./internal/admin/

func newOwnerHarness(t *testing.T) (*gin.Engine, *pgxpool.Pool, func(string, string, any) (*httptest.ResponseRecorder, map[string]any)) {
	t.Helper()
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

	owner, err := users.NewPostgresRepository(pool).CreateAccount(ctx, users.NewAccount{
		Email: fmt.Sprintf("editor-%d@example.com", time.Now().UnixNano()), DisplayName: "Editor", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, owner.ID) })

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: owner.ID, Role: authz.RoleAdmin, SessionID: uuid.New()})
		c.Next()
	})
	NewModule(pool, &recordingAudit{}).RegisterRoutes(r.Group("/api/v1"))

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
	return r, pool, do
}

func TestContentRevisionsPostgres(t *testing.T) {
	_, pool, do := newOwnerHarness(t)
	ctx := context.Background()

	w, body := do(http.MethodPost, "/admin/content", map[string]any{
		"title": "A morning at the market", "type": "reading_passage", "skill": "reading",
		"body": map[string]any{"passage": "The market opens at six."},
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("create status = %d body = %s", w.Code, w.Body.String())
	}
	data, _ := body["data"].(map[string]any)
	id := data["id"].(string)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM content_items WHERE id = $1`, id) })

	if v, _ := data["version"].(float64); v != 1 {
		t.Errorf("a new item starts at version %v, want 1", data["version"])
	}

	t.Run("history begins with the item itself", func(t *testing.T) {
		_, list := do(http.MethodGet, "/admin/content/"+id+"/versions", nil)
		versions, _ := list["data"].([]any)
		if len(versions) != 1 {
			t.Fatalf("versions = %d, want 1", len(versions))
		}
		first, _ := versions[0].(map[string]any)
		if current, _ := first["is_current"].(bool); !current {
			t.Error("the only version must be marked current")
		}
	})

	t.Run("an edit that changes the text creates a revision", func(t *testing.T) {
		w, body := do(http.MethodPatch, "/admin/content/"+id, map[string]any{
			"body": map[string]any{"passage": "The market opens at five and closes at noon."},
			"note": "Added the closing time; learners kept asking.",
		})
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
		}
		data, _ := body["data"].(map[string]any)
		if v, _ := data["version"].(float64); v != 2 {
			t.Fatalf("version = %v, want 2", data["version"])
		}
		_, list := do(http.MethodGet, "/admin/content/"+id+"/versions", nil)
		versions, _ := list["data"].([]any)
		if len(versions) != 2 {
			t.Fatalf("versions = %d, want 2", len(versions))
		}
		newest, _ := versions[0].(map[string]any)
		if note, _ := newest["note"].(string); note == "" {
			t.Error("the note the editor wrote must be stored with the revision")
		}
	})

	t.Run("a save that changes nothing creates no revision", func(t *testing.T) {
		before := countVersions(t, pool, id)
		// The same body, differently formatted: this is the same text, not an edit.
		if w, _ := do(http.MethodPatch, "/admin/content/"+id, map[string]any{
			"body": map[string]any{"passage": "The market opens at five and closes at noon."},
		}); w.Code != http.StatusOK {
			t.Fatalf("status = %d", w.Code)
		}
		if after := countVersions(t, pool, id); after != before {
			t.Errorf("versions = %d, want it unchanged at %d — an identical save is not an edit", after, before)
		}
	})

	t.Run("reclassifying is not a revision", func(t *testing.T) {
		before := countVersions(t, pool, id)
		if w, _ := do(http.MethodPatch, "/admin/content/"+id, map[string]any{"level": "B2"}); w.Code != http.StatusOK {
			t.Fatalf("status = %d", w.Code)
		}
		if after := countVersions(t, pool, id); after != before {
			t.Errorf("versions = %d, want %d — changing the level does not change what learners read", after, before)
		}
	})

	t.Run("restoring an old revision moves history forward, not back", func(t *testing.T) {
		w, body := do(http.MethodPost, "/admin/content/"+id+"/versions/1/restore", nil)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
		}
		data, _ := body["data"].(map[string]any)
		if v, _ := data["version"].(float64); v != 3 {
			t.Errorf("version after restore = %v, want 3", data["version"])
		}
		var passage string
		if err := pool.QueryRow(ctx, `SELECT body->>'passage' FROM content_items WHERE id = $1`, id).Scan(&passage); err != nil {
			t.Fatal(err)
		}
		if passage != "The market opens at six." {
			t.Errorf("passage = %q, want the version 1 text back", passage)
		}
	})

	t.Run("restoring the current revision is refused", func(t *testing.T) {
		w, _ := do(http.MethodPost, "/admin/content/"+id+"/versions/3/restore", nil)
		if w.Code != http.StatusConflict {
			t.Errorf("status = %d, want 409", w.Code)
		}
	})

	t.Run("an unknown revision is a 404, not a silent no-op", func(t *testing.T) {
		w, _ := do(http.MethodGet, "/admin/content/"+id+"/versions/99", nil)
		if w.Code != http.StatusNotFound {
			t.Errorf("status = %d, want 404", w.Code)
		}
	})
}

func countVersions(t *testing.T, pool *pgxpool.Pool, id string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM content_item_versions WHERE content_item_id = $1`, id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestGrammarLanguagesPostgres(t *testing.T) {
	_, pool, do := newOwnerHarness(t)
	ctx := context.Background()

	slug := fmt.Sprintf("test-present-perfect-%d", time.Now().UnixNano())
	var category string
	if err := pool.QueryRow(ctx, `SELECT slug FROM grammar_categories LIMIT 1`).Scan(&category); err != nil {
		t.Skip("no grammar categories seeded")
	}
	w, _ := do(http.MethodPost, "/admin/grammar/topics", map[string]any{
		"slug": slug, "name": "Present perfect (test)", "category": category, "level": "B1",
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("create status = %d body = %s", w.Code, w.Body.String())
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM grammar_topics WHERE slug = $1`, slug) })

	t.Run("each language is versioned on its own", func(t *testing.T) {
		if w, _ := do(http.MethodPatch, "/admin/grammar/topics/"+slug, map[string]any{
			"body": map[string]any{"intro": "We use the present perfect for experience."},
		}); w.Code != http.StatusOK {
			t.Fatalf("english save failed: %d", w.Code)
		}
		w, body := do(http.MethodPatch, "/admin/grammar/topics/"+slug, map[string]any{
			"language": "uz",
			"body":     map[string]any{"intro": "Present perfect tajriba haqida gapirganda ishlatiladi."},
		})
		if w.Code != http.StatusOK {
			t.Fatalf("uzbek save failed: %d body = %s", w.Code, w.Body.String())
		}
		data, _ := body["data"].(map[string]any)
		if lang, _ := data["language"].(string); lang != "uz" {
			t.Errorf("language = %q, want uz", lang)
		}
		// Writing Uzbek must not produce version 2 of the English text.
		if v, _ := data["version"].(float64); v != 1 {
			t.Errorf("uzbek version = %v, want 1 — languages are versioned separately", data["version"])
		}
	})

	t.Run("publishing ships every language that is ready", func(t *testing.T) {
		w, body := do(http.MethodPost, "/admin/grammar/topics/"+slug+"/status", map[string]any{"status": "published"})
		if w.Code != http.StatusOK {
			t.Fatalf("publish status = %d body = %s", w.Code, w.Body.String())
		}
		data, _ := body["data"].(map[string]any)
		langs, _ := data["languages"].([]any)
		if len(langs) != 2 {
			t.Fatalf("published languages = %v, want both en and uz", data["languages"])
		}
		var published int
		_ = pool.QueryRow(ctx, `
			SELECT count(*) FROM grammar_content gc JOIN grammar_topics t ON t.id = gc.grammar_topic_id
			WHERE t.slug = $1 AND gc.status = 'published'`, slug).Scan(&published)
		if published != 2 {
			t.Errorf("published rows = %d, want one per language", published)
		}
	})

	t.Run("the editor opens one language at a time", func(t *testing.T) {
		_, body := do(http.MethodGet, "/admin/grammar/topics/"+slug+"?lang=uz", nil)
		data, _ := body["data"].(map[string]any)
		bodyMap, _ := data["body"].(map[string]any)
		if intro, _ := bodyMap["intro"].(string); intro != "Present perfect tajriba haqida gapirganda ishlatiladi." {
			t.Errorf("body = %v, want the Uzbek explanation", data["body"])
		}
		_, enBody := do(http.MethodGet, "/admin/grammar/topics/"+slug+"?lang=fr", nil)
		enData, _ := enBody["data"].(map[string]any)
		if lang, _ := enData["language"].(string); lang != "en" {
			t.Errorf("an unsupported language must fall back to en, got %q", lang)
		}
	})
}
