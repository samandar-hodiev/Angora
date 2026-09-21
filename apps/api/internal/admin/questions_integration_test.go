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

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/middleware"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
)

// The question bank against PostgreSQL: authoring a question, the guards that stop an
// unanswerable one going live, and the audit trail every write leaves. Run with:
//
//	TEST_DATABASE_URL=postgres://localhost:5432/engora_test?sslmode=disable go test -p 1 -run TestQuestionBankPostgres ./internal/admin/

type recordingAudit struct {
	mu      sync.Mutex
	entries []audit.Entry
}

func (r *recordingAudit) Record(_ context.Context, e audit.Entry) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.entries = append(r.entries, e)
}

func (r *recordingAudit) actions() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, 0, len(r.entries))
	for _, e := range r.entries {
		out = append(out, e.Action)
	}
	return out
}

func TestQuestionBankPostgres(t *testing.T) {
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
	// Registered as a cleanup, not deferred: deferred closes run before t.Cleanup, which
	// would leave every other cleanup in this test talking to a closed pool. Cleanups run
	// last-in-first-out, so registering this first closes the pool last.
	t.Cleanup(pool.Close)

	owner, err := users.NewPostgresRepository(pool).CreateAccount(ctx, users.NewAccount{
		Email: fmt.Sprintf("owner-%d@example.com", time.Now().UnixNano()), DisplayName: "Owner", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, owner.ID) })

	recorder := &recordingAudit{}
	module := NewModule(pool, recorder)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	// Handlers report failures through the error middleware, so the test mounts the same
	// chain the server does; without it a rejected request would look like a 200.
	r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: owner.ID, Role: authz.RoleAdmin, SessionID: uuid.New()})
		c.Next()
	})
	v1 := r.Group("/api/v1")
	module.RegisterRoutes(v1)

	slug := fmt.Sprintf("test-item-%d", time.Now().UnixNano())
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM assessment_items WHERE slug LIKE $1`, slug+"%")
	})

	call := func(method, path string, body any) (*httptest.ResponseRecorder, map[string]any) {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			if err := json.NewEncoder(&buf).Encode(body); err != nil {
				t.Fatal(err)
			}
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

	// An objective question whose key names no option must be refused before it is stored:
	// it would mark every learner who met it wrong.
	w, _ := call(http.MethodPost, "/admin/questions", map[string]any{
		"slug": slug + "-bad", "skill": "reading", "level": "B1", "item_type": "multiple_choice",
		"prompt":     "Which is the past form?",
		"options":    []map[string]string{{"id": "a", "text": "go"}, {"id": "b", "text": "went"}},
		"answer_key": map[string]string{"option_id": "z"},
	})
	if w.Code != http.StatusUnprocessableEntity && w.Code != http.StatusBadRequest {
		t.Fatalf("creating an unanswerable question: status = %d, want a validation failure", w.Code)
	}

	// A valid draft.
	w, created := call(http.MethodPost, "/admin/questions", map[string]any{
		"slug": slug, "skill": "reading", "level": "B1", "item_type": "multiple_choice", "difficulty": 6,
		"topic": "travel", "prompt": "Which is the past form of 'go'?",
		"options":     []map[string]string{{"id": "a", "text": "go"}, {"id": "b", "text": "went"}},
		"answer_key":  map[string]string{"option_id": "b"},
		"explanation": "'went' is the irregular past form.",
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("create: status = %d body = %s", w.Code, w.Body.String())
	}
	data, _ := created["data"].(map[string]any)
	id, _ := data["id"].(string)
	if id == "" {
		t.Fatalf("create returned no id: %s", w.Body.String())
	}
	if status, _ := data["status"].(string); status != "draft" {
		t.Errorf("new questions must start as drafts, got %q", status)
	}

	// The same slug twice is a conflict, not a second row.
	w, _ = call(http.MethodPost, "/admin/questions", map[string]any{
		"slug": slug, "skill": "reading", "level": "B1", "item_type": "writing_task", "prompt": "Write something.",
	})
	if w.Code != http.StatusConflict {
		t.Errorf("duplicate slug: status = %d, want 409", w.Code)
	}

	// Breaking the key by patching options alone must be refused: validation sees the merged
	// item, not just the patch.
	w, _ = call(http.MethodPatch, "/admin/questions/"+id, map[string]any{
		"options": []map[string]string{{"id": "a", "text": "go"}, {"id": "c", "text": "gone"}},
	})
	if w.Code < 400 {
		t.Errorf("patching options away from the answer key: status = %d, want a validation failure", w.Code)
	}

	// Publishing a valid item works and stamps published_at.
	w, published := call(http.MethodPost, "/admin/questions/"+id+"/status", map[string]any{"status": "published"})
	if w.Code != http.StatusOK {
		t.Fatalf("publish: status = %d body = %s", w.Code, w.Body.String())
	}
	pub, _ := published["data"].(map[string]any)
	if status, _ := pub["status"].(string); status != "published" {
		t.Errorf("status = %q, want published", status)
	}
	if pub["published_at"] == nil {
		t.Error("published_at must be set when an item goes live")
	}

	// A published item that is edited bumps its version, so recorded answers stay traceable
	// to the wording they were given.
	w, updated := call(http.MethodPatch, "/admin/questions/"+id, map[string]any{"prompt": "Which is the past simple of 'go'?"})
	if w.Code != http.StatusOK {
		t.Fatalf("update: status = %d body = %s", w.Code, w.Body.String())
	}
	upd, _ := updated["data"].(map[string]any)
	if version, _ := upd["version"].(float64); version != 2 {
		t.Errorf("version after editing a published item = %v, want 2", upd["version"])
	}

	// Filters run in SQL: the new item is found by its own skill and status.
	w, listed := call(http.MethodGet, "/admin/questions?skill=reading&status=published&search="+slug, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("list: status = %d body = %s", w.Code, w.Body.String())
	}
	items, _ := listed["data"].([]any)
	if len(items) != 1 {
		t.Fatalf("filtered list returned %d items, want 1", len(items))
	}

	// Stats count the same rows.
	w, stats := call(http.MethodGet, "/admin/questions/stats", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("stats: status = %d", w.Code)
	}
	statsData, _ := stats["data"].(map[string]any)
	if total, _ := statsData["total"].(float64); total < 1 {
		t.Errorf("stats total = %v, want at least 1", statsData["total"])
	}

	// Every write left an audit entry naming what happened.
	want := map[string]bool{ActionItemCreated: false, ActionItemUpdated: false, ActionItemStatusChanged: false}
	for _, action := range recorder.actions() {
		if _, ok := want[action]; ok {
			want[action] = true
		}
	}
	for action, seen := range want {
		if !seen {
			t.Errorf("no audit entry recorded for %s", action)
		}
	}
}

// TestQuestionBankRequiresPermission proves the guard is on the route, not only in the UI.
func TestQuestionBankRequiresPermission(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: uuid.New(), Role: authz.RoleUser, SessionID: uuid.New()})
		c.Next()
	})
	v1 := r.Group("/api/v1")
	NewModule(nil, audit.Nop{}).RegisterRoutes(v1)

	for _, path := range []string{"/api/v1/admin/questions", "/api/v1/admin/questions/stats", "/api/v1/admin/assessment-configs"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusForbidden {
			t.Errorf("GET %s as a learner: status = %d, want 403", path, w.Code)
		}
	}

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/questions", bytes.NewBufferString(`{}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("POST /admin/questions as a learner: status = %d, want 403", w.Code)
	}
}

// TestPlanEntitlementsPostgres drives the paywall the owner console edits: what a plan grants
// today, changing a limit, revoking access, and the audit entry each change leaves.
func TestPlanEntitlementsPostgres(t *testing.T) {
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
	// Registered as a cleanup, not deferred: deferred closes run before t.Cleanup, which
	// would leave every other cleanup in this test talking to a closed pool. Cleanups run
	// last-in-first-out, so registering this first closes the pool last.
	t.Cleanup(pool.Close)

	owner, err := users.NewPostgresRepository(pool).CreateAccount(ctx, users.NewAccount{
		Email: fmt.Sprintf("billing-%d@example.com", time.Now().UnixNano()), DisplayName: "Owner", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, owner.ID) })

	recorder := &recordingAudit{}
	r := gin.New()
	r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: owner.ID, Role: authz.RoleAdmin, SessionID: uuid.New()})
		c.Next()
	})
	NewModule(pool, recorder).RegisterRoutes(r.Group("/api/v1"))

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

	w, listed := do(http.MethodGet, "/admin/plans", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("list plans: status = %d body = %s", w.Code, w.Body.String())
	}
	plans, _ := listed["data"].([]any)
	if len(plans) == 0 {
		t.Fatal("no plans returned; the catalogue seed is missing")
	}

	// Find the free plan and remember what it grants, so the test can put it back.
	var freeID string
	for _, raw := range plans {
		plan, _ := raw.(map[string]any)
		if code, _ := plan["code"].(string); code == "free" {
			freeID, _ = plan["id"].(string)
		}
	}
	if freeID == "" {
		t.Fatal("no free plan in the catalogue")
	}

	const key = "grammar.ai_explanation"
	var before struct {
		value  *int
		period *string
		found  bool
	}
	_ = pool.QueryRow(ctx, `SELECT limit_value, limit_period FROM plan_entitlements WHERE plan_id = $1 AND entitlement_key = $2`,
		freeID, key).Scan(&before.value, &before.period)
	before.found = before.value != nil || before.period != nil
	t.Cleanup(func() {
		if before.found {
			_, _ = pool.Exec(context.Background(), `
				INSERT INTO plan_entitlements (plan_id, entitlement_key, limit_value, limit_period)
				VALUES ($1, $2, $3, $4)
				ON CONFLICT (plan_id, entitlement_key) DO UPDATE
					SET limit_value = EXCLUDED.limit_value, limit_period = EXCLUDED.limit_period`,
				freeID, key, before.value, before.period)
		}
	})

	// Raising a limit is the everyday paywall change.
	if w, _ := do(http.MethodPut, "/admin/plans/"+freeID+"/entitlements/"+key,
		map[string]any{"limit_value": 9, "limit_period": "month"}); w.Code != http.StatusOK {
		t.Fatalf("update limit: status = %d body = %s", w.Code, w.Body.String())
	}
	var limit int
	if err := pool.QueryRow(ctx, `SELECT limit_value FROM plan_entitlements WHERE plan_id = $1 AND entitlement_key = $2`,
		freeID, key).Scan(&limit); err != nil {
		t.Fatal(err)
	}
	if limit != 9 {
		t.Errorf("limit_value = %d, want 9", limit)
	}

	// A feature has no number: a value sent for one must be dropped rather than stored.
	if w, _ := do(http.MethodPut, "/admin/plans/"+freeID+"/entitlements/grammar.ai_tutor",
		map[string]any{"limit_value": 5, "limit_period": "month"}); w.Code != http.StatusOK {
		t.Fatalf("grant feature: status = %d body = %s", w.Code, w.Body.String())
	}
	var featureLimit *int
	if err := pool.QueryRow(ctx, `SELECT limit_value FROM plan_entitlements WHERE plan_id = $1 AND entitlement_key = 'grammar.ai_tutor'`,
		freeID).Scan(&featureLimit); err != nil {
		t.Fatal(err)
	}
	if featureLimit != nil {
		t.Errorf("a feature stored limit_value = %d; features carry no limit", *featureLimit)
	}

	if w, _ := do(http.MethodDelete, "/admin/plans/"+freeID+"/entitlements/grammar.ai_tutor", nil); w.Code != http.StatusNoContent {
		t.Fatalf("revoke: status = %d", w.Code)
	}
	var stillThere bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM plan_entitlements WHERE plan_id = $1 AND entitlement_key = 'grammar.ai_tutor')`,
		freeID).Scan(&stillThere); err != nil {
		t.Fatal(err)
	}
	if stillThere {
		t.Error("the entitlement survived a revoke")
	}

	if w, _ := do(http.MethodPut, "/admin/plans/"+freeID+"/entitlements/not.a.real.entitlement", map[string]any{}); w.Code != http.StatusNotFound {
		t.Errorf("unknown entitlement: status = %d, want 404", w.Code)
	}

	// Every paywall change is on the record.
	want := map[string]bool{ActionEntitlementUpdated: false, ActionEntitlementGranted: false, ActionEntitlementRevoked: false}
	for _, action := range recorder.actions() {
		if _, ok := want[action]; ok {
			want[action] = true
		}
	}
	for action, seen := range want {
		if !seen {
			t.Errorf("no audit entry recorded for %s", action)
		}
	}

	// And the audit endpoint can read them back.
	w, logs := do(http.MethodGet, "/admin/audit-logs?entity=plan_entitlement", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("audit log: status = %d body = %s", w.Code, w.Body.String())
	}
	if entries, _ := logs["data"].([]any); entries == nil {
		t.Error("audit log returned no data field")
	}
}
