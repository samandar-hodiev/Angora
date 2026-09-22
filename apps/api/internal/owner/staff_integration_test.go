package owner

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

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/auth"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/middleware"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
)

// The staff list against PostgreSQL. Run with:
//
//	TEST_DATABASE_URL=postgres://localhost:5432/engora_test?sslmode=disable go test -p 1 -run TestStaff ./internal/owner/

type staffFixture struct {
	pool   *pgxpool.Pool
	router *gin.Engine
	owner  users.User
	repo   users.Repository
}

const fixtureOwnerEmail = "fixture-owner@engora.test"

func newStaffFixture(t *testing.T, actorRole authz.Role) *staffFixture {
	t.Helper()
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

	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	repo := users.NewPostgresRepository(pool)

	email := fmt.Sprintf("fixture-actor-%s@engora.test", uuid.NewString()[:8])
	actor, err := repo.CreateAccount(ctx, users.NewAccount{Email: email, Timezone: "UTC", EmailVerified: true, Role: actorRole})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, actor.ID) })

	gin.SetMode(gin.TestMode)
	router := gin.New()
	// The error middleware is what turns a handler's apperr into a response. Without it a
	// refusal renders as a bare 200, which is how a test can pass while the API says no.
	router.Use(middleware.Errors(observability.NewErrorReporter("log", log)))
	v1 := router.Group("/api/v1", func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: actor.ID, Role: actorRole})
		c.Next()
	})
	NewModule(Deps{
		Pool: pool, Log: log, Users: repo, Hasher: auth.DefaultArgon2id(),
		Audit: audit.NewPostgresRecorder(pool, log), OwnerEmail: fixtureOwnerEmail,
	}).registerStaffRoutes(v1)

	return &staffFixture{pool: pool, router: router, owner: actor, repo: repo}
}

func (f *staffFixture) do(t *testing.T, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	payload := []byte("{}")
	if body != nil {
		var err error
		payload, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	f.router.ServeHTTP(res, req)
	return res
}

func (f *staffFixture) created(t *testing.T, res *httptest.ResponseRecorder) StaffMember {
	t.Helper()
	var envelope struct {
		Data StaffMember `json:"data"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = f.pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, envelope.Data.ID) })
	return envelope.Data
}

func (f *staffFixture) roleOf(t *testing.T, id uuid.UUID) authz.Role {
	t.Helper()
	var role authz.Role
	if err := f.pool.QueryRow(context.Background(), `SELECT role FROM users WHERE id = $1`, id).Scan(&role); err != nil {
		t.Fatal(err)
	}
	return role
}

func newStaffBody(role string) map[string]string {
	return map[string]string{
		"email":    fmt.Sprintf("fixture-staff-%s@engora.test", uuid.NewString()[:8]),
		"role":     role,
		"password": "an-initial-password-9922",
	}
}

func TestStaffListPostgres(t *testing.T) {
	t.Run("an administrator cannot reach the staff list at all", func(t *testing.T) {
		f := newStaffFixture(t, authz.RoleAdmin)

		if res := f.do(t, http.MethodGet, "/api/v1/admin/staff", nil); res.Code != http.StatusForbidden {
			t.Fatalf("an ADMIN read the staff list: got %d", res.Code)
		}
		if res := f.do(t, http.MethodPost, "/api/v1/admin/staff", newStaffBody("SUPPORT")); res.Code != http.StatusForbidden {
			t.Fatalf("an ADMIN added staff: got %d", res.Code)
		}
	})

	t.Run("the owner adds staff, and the account can sign in with the password they chose", func(t *testing.T) {
		f := newStaffFixture(t, authz.RoleOwner)
		body := newStaffBody("CONTENT_MANAGER")

		res := f.do(t, http.MethodPost, "/api/v1/admin/staff", body)
		if res.Code != http.StatusCreated {
			t.Fatalf("add staff: got %d, body %s", res.Code, res.Body.String())
		}
		member := f.created(t, res)
		if member.Role != authz.RoleContentManager {
			t.Fatalf("expected CONTENT_MANAGER, got %s", member.Role)
		}
		if !member.MustChangePassword {
			t.Fatal("a password somebody else chose should be flagged for replacement")
		}
		// The password has to be a real, verifiable hash rather than whatever was typed.
		var hash string
		if err := f.pool.QueryRow(context.Background(), `SELECT password_hash FROM users WHERE id = $1`, member.ID).Scan(&hash); err != nil {
			t.Fatal(err)
		}
		ok, err := auth.DefaultArgon2id().Verify(body["password"], hash)
		if err != nil || !ok {
			t.Fatalf("the stored password does not verify: ok=%v err=%v", ok, err)
		}
		if hash == body["password"] {
			t.Fatal("the password was stored in the clear")
		}
	})

	t.Run("no second owner can be created from inside the console", func(t *testing.T) {
		f := newStaffFixture(t, authz.RoleOwner)
		body := newStaffBody("OWNER")

		if res := f.do(t, http.MethodPost, "/api/v1/admin/staff", body); res.Code != http.StatusUnprocessableEntity && res.Code != http.StatusBadRequest {
			t.Fatalf("OWNER was accepted as a staff role: got %d, body %s", res.Code, res.Body.String())
		}
	})

	t.Run("the owner's own address cannot be added as staff", func(t *testing.T) {
		f := newStaffFixture(t, authz.RoleOwner)
		body := newStaffBody("ADMIN")
		body["email"] = fixtureOwnerEmail

		if res := f.do(t, http.MethodPost, "/api/v1/admin/staff", body); res.Code != http.StatusConflict {
			t.Fatalf("the owner address was added as staff: got %d, body %s", res.Code, res.Body.String())
		}
	})

	t.Run("revoking access demotes and signs them out, rather than deleting the person", func(t *testing.T) {
		f := newStaffFixture(t, authz.RoleOwner)
		member := f.created(t, f.do(t, http.MethodPost, "/api/v1/admin/staff", newStaffBody("SUPPORT")))
		ctx := context.Background()
		if _, err := f.pool.Exec(ctx, `
			INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
			VALUES ($1, $2, gen_random_uuid(), now() + interval '30 days')`,
			member.ID, uuid.NewString()); err != nil {
			t.Fatal(err)
		}

		if res := f.do(t, http.MethodDelete, "/api/v1/admin/staff/"+member.ID.String(), nil); res.Code != http.StatusNoContent {
			t.Fatalf("revoke: got %d, body %s", res.Code, res.Body.String())
		}
		if role := f.roleOf(t, member.ID); role != authz.RoleUser {
			t.Fatalf("expected the account to be demoted to USER, got %s", role)
		}
		var live int
		if err := f.pool.QueryRow(ctx,
			`SELECT count(*) FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, member.ID).Scan(&live); err != nil {
			t.Fatal(err)
		}
		if live != 0 {
			t.Fatalf("%d sessions survived the revocation", live)
		}
	})

	t.Run("the owner cannot change or remove their own access", func(t *testing.T) {
		f := newStaffFixture(t, authz.RoleOwner)

		if res := f.do(t, http.MethodDelete, "/api/v1/admin/staff/"+f.owner.ID.String(), nil); res.Code != http.StatusForbidden {
			t.Fatalf("the owner removed themselves: got %d", res.Code)
		}
		if res := f.do(t, http.MethodPatch, "/api/v1/admin/staff/"+f.owner.ID.String(), map[string]string{"role": "SUPPORT"}); res.Code != http.StatusForbidden {
			t.Fatalf("the owner demoted themselves: got %d", res.Code)
		}
		if role := f.roleOf(t, f.owner.ID); role != authz.RoleOwner {
			t.Fatalf("the owner is no longer OWNER: %s", role)
		}
	})

	t.Run("a password reset signs the previous holder out", func(t *testing.T) {
		f := newStaffFixture(t, authz.RoleOwner)
		member := f.created(t, f.do(t, http.MethodPost, "/api/v1/admin/staff", newStaffBody("ANALYST")))
		ctx := context.Background()
		if _, err := f.pool.Exec(ctx, `
			INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
			VALUES ($1, $2, gen_random_uuid(), now() + interval '30 days')`,
			member.ID, uuid.NewString()); err != nil {
			t.Fatal(err)
		}

		res := f.do(t, http.MethodPost, "/api/v1/admin/staff/"+member.ID.String()+"/password",
			map[string]string{"password": "a-replacement-password-77"})
		if res.Code != http.StatusNoContent {
			t.Fatalf("reset: got %d, body %s", res.Code, res.Body.String())
		}
		var live int
		if err := f.pool.QueryRow(ctx,
			`SELECT count(*) FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, member.ID).Scan(&live); err != nil {
			t.Fatal(err)
		}
		if live != 0 {
			t.Fatal("the old session survived a password reset")
		}
	})
}
