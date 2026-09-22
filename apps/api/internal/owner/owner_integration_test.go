package owner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/middleware"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/internal/storage"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
)

// The Owner Console's own settings against PostgreSQL. The point being proved is the
// separation: nothing here touches site_settings, which is the Learner App's. Run with:
//
//	TEST_DATABASE_URL=postgres://localhost:5432/engora_test?sslmode=disable go test -p 1 -run TestOwner ./internal/owner/

// png returns bytes that pass image sniffing.
func png() []byte {
	return append([]byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}, make([]byte, 1024)...)
}

func TestOwnerPreferencesPostgres(t *testing.T) {
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

	operator, err := users.NewPostgresRepository(pool).CreateAccount(ctx, users.NewAccount{
		Email: fmt.Sprintf("operator-%d@example.com", time.Now().UnixNano()), DisplayName: "Operator", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, operator.ID) })

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	module := NewModule(Deps{Pool: pool, Storage: store, Log: slog.New(slog.DiscardHandler)})

	session := uuid.New()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: operator.ID, Role: authz.RoleAdmin, SessionID: session})
		c.Next()
	})
	module.RegisterRoutes(r.Group("/api/v1"))

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

	t.Run("an operator who has never opened the page gets Uzbek and dark", func(t *testing.T) {
		w, body := do(http.MethodGet, "/admin/owner/preferences", nil)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
		}
		data, _ := body["data"].(map[string]any)
		if data["locale"] != "uz" {
			t.Errorf("locale = %v, want uz", data["locale"])
		}
		if data["theme"] != "dark" {
			t.Errorf("theme = %v, want dark — the console is dark and stays dark by default", data["theme"])
		}
		if data["sidebar_mode"] != "remember" {
			t.Errorf("sidebar_mode = %v, want remember", data["sidebar_mode"])
		}
	})

	t.Run("changing the console language leaves the Learner App alone", func(t *testing.T) {
		var before string
		if err := pool.QueryRow(ctx, `SELECT learner->>'interface_language' FROM site_settings WHERE id`).Scan(&before); err != nil {
			t.Fatal(err)
		}

		w, body := do(http.MethodPatch, "/admin/owner/preferences", map[string]any{"locale": "ru", "theme": "light"})
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
		}
		data, _ := body["data"].(map[string]any)
		if data["locale"] != "ru" || data["theme"] != "light" {
			t.Fatalf("preferences did not save: %v", data)
		}

		var after string
		if err := pool.QueryRow(ctx, `SELECT learner->>'interface_language' FROM site_settings WHERE id`).Scan(&after); err != nil {
			t.Fatal(err)
		}
		if after != before {
			t.Errorf("the Learner App language changed from %q to %q — the two settings must not touch", before, after)
		}
	})

	t.Run("an unusable time zone is refused", func(t *testing.T) {
		w, _ := do(http.MethodPatch, "/admin/owner/preferences", map[string]any{"timezone": "Mars/Olympus"})
		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("status = %d, want 422 for a time zone the server cannot load", w.Code)
		}
	})

	t.Run("an unknown language is refused rather than stored", func(t *testing.T) {
		w, _ := do(http.MethodPatch, "/admin/owner/preferences", map[string]any{"locale": "de"})
		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("status = %d, want 422", w.Code)
		}
	})

	upload := func(t *testing.T, data []byte, contentType string) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		header := textproto.MIMEHeader{}
		header.Set("Content-Disposition", `form-data; name="file"; filename="bg.png"`)
		header.Set("Content-Type", contentType)
		part, err := mw.CreatePart(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(data); err != nil {
			t.Fatal(err)
		}
		_ = mw.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/owner/wallpaper", &buf)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	t.Run("a console background is stored outside the database", func(t *testing.T) {
		if w := upload(t, png(), "image/png"); w.Code != http.StatusOK {
			t.Fatalf("upload status = %d body = %s", w.Code, w.Body.String())
		}
		var key, url *string
		var enabled bool
		if err := pool.QueryRow(ctx, `
			SELECT wallpaper_storage_key, wallpaper_url, wallpaper_enabled
			FROM owner_preferences WHERE user_id = $1`, operator.ID).Scan(&key, &url, &enabled); err != nil {
			t.Fatal(err)
		}
		if key == nil || url == nil {
			t.Fatal("the upload did not record a storage key")
		}
		if !enabled {
			t.Error("uploading a background should switch it on — nobody uploads one to leave it off")
		}
		// The row holds a reference, never the image itself.
		if len(*key) > 200 {
			t.Errorf("storage key looks like image data, not a key: %d bytes", len(*key))
		}
	})

	t.Run("a file that is not an image is refused whatever it claims to be", func(t *testing.T) {
		w := upload(t, []byte("MZ\x90\x00 this is an executable"), "image/png")
		if w.Code < 400 {
			t.Errorf("status = %d, want a refusal: the declared type and the real bytes disagree", w.Code)
		}
	})

	t.Run("removing the background clears the reference", func(t *testing.T) {
		w, _ := do(http.MethodDelete, "/admin/owner/wallpaper", nil)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
		}
		var key *string
		var enabled bool
		_ = pool.QueryRow(ctx, `SELECT wallpaper_storage_key, wallpaper_enabled FROM owner_preferences WHERE user_id = $1`,
			operator.ID).Scan(&key, &enabled)
		if key != nil || enabled {
			t.Errorf("key = %v, enabled = %v, want both cleared", key, enabled)
		}
	})

	t.Run("sessions are read from the real token store and the current one cannot be revoked", func(t *testing.T) {
		var current, other uuid.UUID
		if err := pool.QueryRow(ctx, `
			INSERT INTO refresh_tokens (user_id, family_id, token_hash, platform, expires_at)
			VALUES ($1, $2, $3, 'web', now() + interval '30 days') RETURNING id`,
			operator.ID, session, "hash-"+session.String()).Scan(&current); err != nil {
			t.Fatal(err)
		}
		if err := pool.QueryRow(ctx, `
			INSERT INTO refresh_tokens (user_id, family_id, token_hash, platform, expires_at)
			VALUES ($1, gen_random_uuid(), $2, 'ios', now() + interval '30 days') RETURNING id`,
			operator.ID, "hash-other-"+uuid.NewString()).Scan(&other); err != nil {
			t.Fatal(err)
		}

		w, body := do(http.MethodGet, "/admin/owner/sessions", nil)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d", w.Code)
		}
		list, _ := body["data"].([]any)
		if len(list) != 2 {
			t.Fatalf("sessions = %d, want 2", len(list))
		}
		first, _ := list[0].(map[string]any)
		if current, _ := first["current"].(bool); !current {
			t.Error("the session making the request should be listed first and marked current")
		}

		if w, _ := do(http.MethodDelete, "/admin/owner/sessions/"+current.String(), nil); w.Code != http.StatusNotFound {
			t.Errorf("status = %d, want 404 — revoking the session you are using would lock you out", w.Code)
		}

		w, body = do(http.MethodDelete, "/admin/owner/sessions/"+other.String(), nil)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
		}
		list, _ = body["data"].([]any)
		if len(list) != 1 {
			t.Errorf("sessions after revoking the other device = %d, want 1", len(list))
		}
	})
}
