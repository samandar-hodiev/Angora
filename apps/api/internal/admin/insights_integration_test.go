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

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/middleware"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
)

// Every read endpoint the owner console depends on, executed against PostgreSQL.
//
// These queries are long and touch a dozen tables; a wrong column name compiles perfectly and
// fails only when a person opens the page. Running each one against the real schema is what
// catches that. Run with:
//
//	TEST_DATABASE_URL=postgres://localhost:5432/engora_test?sslmode=disable go test -p 1 -run TestOwnerReads ./internal/admin/

func TestOwnerReadEndpointsPostgres(t *testing.T) {
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

	repo := users.NewPostgresRepository(pool)
	owner, err := repo.CreateAccount(ctx, users.NewAccount{
		Email: fmt.Sprintf("reads-owner-%d@example.com", time.Now().UnixNano()), DisplayName: "Owner", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	learner, err := repo.CreateAccount(ctx, users.NewAccount{
		Email: fmt.Sprintf("reads-learner-%d@example.com", time.Now().UnixNano()), DisplayName: "Learner", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = ANY($1)`, []uuid.UUID{owner.ID, learner.ID})
	})

	// A learner with something to show: a level history and a weakness.
	for _, kind := range []string{"self_reported", "assessed", "estimated"} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO user_levels (user_id, kind, cefr, source_type, confidence)
			VALUES ($1, $2, 'B1', 'assessment', 0.8)`, learner.ID, kind); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO weaknesses (user_id, category, severity_score, evidence_count)
		VALUES ($1, 'grammar.articles', 68, 4)
		ON CONFLICT (user_id, category) DO NOTHING`, learner.ID); err != nil {
		t.Fatal(err)
	}

	recorder := &recordingAudit{}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: owner.ID, Role: authz.RoleAdmin, SessionID: uuid.New()})
		c.Next()
	})
	NewModule(pool, recorder).RegisterRoutes(r.Group("/api/v1"))

	get := func(path string) (*httptest.ResponseRecorder, map[string]any) {
		t.Helper()
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1"+path, nil))
		var envelope map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &envelope)
		return w, envelope
	}

	// Each of these executes real SQL against the real schema.
	for _, path := range []string{
		"/admin/learners",
		"/admin/learners?search=reads-learner&plan=free&sort=last_active",
		"/admin/analytics/overview?days=30",
		"/admin/analytics/growth?days=14",
		"/admin/ai/failures?days=7",
		"/admin/ai/quality?days=30",
		"/admin/plans",
		"/admin/entitlements",
		"/admin/audit-logs",
		"/admin/questions/stats",
		"/admin/assessment-stats",
		"/admin/assessment-configs",
		"/admin/roles",
	} {
		t.Run(path, func(t *testing.T) {
			w, _ := get(path)
			if w.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
			}
		})
	}

	t.Run("learner detail reports all three level statements", func(t *testing.T) {
		w, body := get("/admin/learners/" + learner.ID.String())
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
		}
		data, _ := body["data"].(map[string]any)
		levels, _ := data["levels"].([]any)
		if len(levels) != 3 {
			t.Fatalf("levels = %d, want 3 (self_reported, assessed, estimated kept apart)", len(levels))
		}
		if weaknesses, _ := data["weaknesses"].([]any); len(weaknesses) == 0 {
			t.Error("the learner's weakness was not reported")
		}
		// A learner with no subscription is on the default plan, not on "none".
		if plan, _ := data["plan_code"].(string); plan == "" {
			t.Error("plan_code is empty; a learner without a subscription is on the default plan")
		}
	})

	t.Run("growth covers every day in the range", func(t *testing.T) {
		_, body := get("/admin/analytics/growth?days=14")
		data, _ := body["data"].(map[string]any)
		points, _ := data["points"].([]any)
		if len(points) != 14 {
			t.Errorf("points = %d, want 14 — days with no registrations must still appear", len(points))
		}
	})

	t.Run("unknown learner is a 404", func(t *testing.T) {
		w, _ := get("/admin/learners/" + uuid.New().String())
		if w.Code != http.StatusNotFound {
			t.Errorf("status = %d, want 404", w.Code)
		}
	})
}

// TestOwnerWritesRespectRoles is the authorization claim the product depends on: an operator
// role must not be able to reach past what it was given.
func TestOwnerWritesRespectRoles(t *testing.T) {
	gin.SetMode(gin.TestMode)

	build := func(role authz.Role) *gin.Engine {
		r := gin.New()
		r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
			authz.SetPrincipal(c, authz.Principal{UserID: uuid.New(), Role: role, SessionID: uuid.New()})
			c.Next()
		})
		NewModule(nil, nil).RegisterRoutes(r.Group("/api/v1"))
		return r
	}

	cases := []struct {
		role   authz.Role
		method string
		path   string
		want   int
		why    string
	}{
		{authz.RoleContentManager, http.MethodPut, "/api/v1/admin/plans/" + uuid.New().String() + "/entitlements/grammar.ai_tutor", http.StatusForbidden,
			"a content manager must not be able to change what people pay for"},
		{authz.RoleSupport, http.MethodPut, "/api/v1/admin/plans/" + uuid.New().String() + "/entitlements/grammar.ai_tutor", http.StatusForbidden,
			"support must not be able to change billing"},
		{authz.RoleSupport, http.MethodPost, "/api/v1/admin/questions", http.StatusForbidden,
			"support must not be able to author assessment questions"},
		{authz.RoleAnalyst, http.MethodPost, "/api/v1/admin/learners/" + uuid.New().String() + "/status", http.StatusForbidden,
			"an analyst must not be able to suspend an account"},
		{authz.RoleUser, http.MethodGet, "/api/v1/admin/analytics/overview", http.StatusForbidden,
			"a learner must not be able to read platform analytics"},
	}

	for _, tc := range cases {
		t.Run(string(tc.role)+" "+tc.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, tc.path, nil)
			req.Header.Set("Content-Type", "application/json")
			build(tc.role).ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Errorf("status = %d, want %d — %s", w.Code, tc.want, tc.why)
			}
		})
	}
}

// TestOwnerContentAndSettingsPostgres covers the last three surfaces the console drives:
// content editing, grammar authoring, and the platform defaults learners inherit.
func TestOwnerContentAndSettingsPostgres(t *testing.T) {
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

	recorder := &recordingAudit{}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: owner.ID, Role: authz.RoleAdmin, SessionID: uuid.New()})
		c.Next()
	})
	NewModule(pool, recorder).RegisterRoutes(r.Group("/api/v1"))

	call := func(method, path string, body any) (*httptest.ResponseRecorder, map[string]any) {
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

	t.Run("content is created as a draft and published deliberately", func(t *testing.T) {
		title := fmt.Sprintf("Test passage %d", time.Now().UnixNano())
		w, created := call(http.MethodPost, "/admin/content", map[string]any{
			"title": title, "type": "reading_passage", "skill": "reading", "level": "B1",
			"body": map[string]any{"passage": "A short passage for the test."},
		})
		if w.Code != http.StatusCreated {
			t.Fatalf("create: status = %d body = %s", w.Code, w.Body.String())
		}
		data, _ := created["data"].(map[string]any)
		id, _ := data["id"].(string)
		t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM content_items WHERE id = $1`, id) })
		if status, _ := data["status"].(string); status != "draft" {
			t.Errorf("new content status = %q, want draft", status)
		}

		// A reading set with no questions cannot be published: learners would never be
		// offered it, so saying so is better than publishing into silence.
		w, _ = call(http.MethodPost, "/admin/content/"+id+"/status", map[string]any{"status": "published"})
		if w.Code != http.StatusConflict {
			t.Errorf("publishing a question-less reading set: status = %d, want 409", w.Code)
		}

		if w, _ := call(http.MethodPatch, "/admin/content/"+id, map[string]any{"difficulty": 7}); w.Code != http.StatusOK {
			t.Errorf("update: status = %d", w.Code)
		}
		var difficulty int
		_ = pool.QueryRow(ctx, `SELECT difficulty FROM content_items WHERE id = $1`, id).Scan(&difficulty)
		if difficulty != 7 {
			t.Errorf("difficulty = %d, want 7", difficulty)
		}
	})

	t.Run("grammar topics list and open", func(t *testing.T) {
		w, _ := call(http.MethodGet, "/admin/grammar/categories", nil)
		if w.Code != http.StatusOK {
			t.Fatalf("categories: status = %d body = %s", w.Code, w.Body.String())
		}
		w, listed := call(http.MethodGet, "/admin/grammar/topics?status=published", nil)
		if w.Code != http.StatusOK {
			t.Fatalf("topics: status = %d body = %s", w.Code, w.Body.String())
		}
		topics, _ := listed["data"].([]any)
		if len(topics) == 0 {
			t.Skip("no grammar curriculum seeded in the test database")
		}
		first, _ := topics[0].(map[string]any)
		slug, _ := first["slug"].(string)

		w, _ = call(http.MethodGet, "/admin/grammar/topics/"+slug, nil)
		if w.Code != http.StatusOK {
			t.Fatalf("topic detail: status = %d body = %s", w.Code, w.Body.String())
		}
	})

	t.Run("settings merge rather than replace", func(t *testing.T) {
		w, _ := call(http.MethodPatch, "/admin/settings", map[string]any{
			"learner": map[string]any{"daily_goal_minutes": 25},
		})
		if w.Code != http.StatusOK {
			t.Fatalf("update settings: status = %d body = %s", w.Code, w.Body.String())
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(),
				`UPDATE site_settings SET learner = learner || '{"daily_goal_minutes": 15}'::jsonb WHERE id`)
		})

		var learner map[string]any
		var raw []byte
		_ = pool.QueryRow(ctx, `SELECT learner FROM site_settings WHERE id`).Scan(&raw)
		_ = json.Unmarshal(raw, &learner)
		if learner["daily_goal_minutes"] != float64(25) {
			t.Errorf("daily_goal_minutes = %v, want 25", learner["daily_goal_minutes"])
		}
		// The other keys in the same group must survive the merge.
		if learner["theme"] == nil {
			t.Error("updating one setting dropped the others in its group")
		}
	})

	t.Run("a wallpaper can be withdrawn from the library", func(t *testing.T) {
		w, _ := call(http.MethodGet, "/admin/wallpapers", nil)
		if w.Code != http.StatusOK {
			t.Fatalf("wallpapers: status = %d body = %s", w.Code, w.Body.String())
		}
		if w, _ := call(http.MethodPatch, "/admin/wallpapers/mist", map[string]any{"enabled": false}); w.Code != http.StatusOK {
			t.Fatalf("disable: status = %d body = %s", w.Code, w.Body.String())
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `UPDATE wallpapers SET enabled = true WHERE id = 'mist'`)
		})
		var enabled bool
		_ = pool.QueryRow(ctx, `SELECT enabled FROM wallpapers WHERE id = 'mist'`).Scan(&enabled)
		if enabled {
			t.Error("the wallpaper is still enabled")
		}
		if w, _ := call(http.MethodPatch, "/admin/wallpapers/not-a-wallpaper", map[string]any{"enabled": false}); w.Code != http.StatusNotFound {
			t.Error("an unknown wallpaper must be a 404")
		}
	})

	t.Run("every change was audited", func(t *testing.T) {
		want := map[string]bool{
			ActionContentCreated: false, ActionContentUpdated: false,
			ActionSettingsUpdated: false, ActionWallpaperChanged: false,
		}
		for _, action := range recorder.actions() {
			if _, ok := want[action]; ok {
				want[action] = true
			}
		}
		for action, seen := range want {
			if !seen {
				t.Errorf("no audit entry for %s", action)
			}
		}
	})
}
