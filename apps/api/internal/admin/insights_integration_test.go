package admin

import (
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
