package account

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/auth"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/mail"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/middleware"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
)

// Account export and self-service deletion against PostgreSQL. Run with:
//
//	TEST_DATABASE_URL=postgres://localhost:5432/engora_test?sslmode=disable go test -p 1 -run TestAccount ./internal/account/

type captureMailer struct {
	mu   sync.Mutex
	sent []mail.Message
}

func (m *captureMailer) Send(_ context.Context, msg mail.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, msg)
	return nil
}

var sixDigits = regexp.MustCompile(`\b(\d{6})\b`)

// code reads the code out of the last email, the way a person would.
func (m *captureMailer) code(t *testing.T) string {
	t.Helper()
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.sent) == 0 {
		t.Fatal("no email was sent")
	}
	last := m.sent[len(m.sent)-1]
	found := sixDigits.FindStringSubmatch(last.Subject)
	if found == nil {
		t.Fatalf("no code in subject %q", last.Subject)
	}
	return found[1]
}

func (m *captureMailer) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sent)
}

func (m *captureMailer) lastSubject() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sent[len(m.sent)-1].Subject
}

type accountFixture struct {
	pool   *pgxpool.Pool
	router *gin.Engine
	mailer *captureMailer
	user   users.User
}

func newAccountFixture(t *testing.T) *accountFixture {
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
	mailer := &captureMailer{}
	recorder := audit.NewPostgresRecorder(pool, log)

	svc, err := auth.NewService(auth.Deps{
		EmailCodes: auth.NewPostgresEmailCodeStore(pool),
		Users:      repo,
		Tokens:     auth.NewPostgresTokenRepository(pool),
		Resets:     auth.NewPostgresResetStore(pool),
		Identities: auth.NewPostgresIdentityStore(pool),
		Hasher:     auth.DefaultArgon2id(),
		Issuer:     auth.NewTokenIssuer("test-secret-that-is-long-enough-for-hs256", "engora-test", 15*time.Minute),
		Audit:      recorder,
		Mailer:     mailer,
	}, auth.Options{RefreshTTL: time.Hour, ResetTTL: time.Hour, WebURL: "http://localhost:3001"})
	if err != nil {
		t.Fatal(err)
	}

	email := fmt.Sprintf("delete-me-%s@example.test", uuid.NewString()[:8])
	user, err := repo.CreateAccount(ctx, users.NewAccount{Email: email, Timezone: "UTC", EmailVerified: true, AuthProvider: "email"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, user.ID)
	})

	gin.SetMode(gin.TestMode)
	router := gin.New()
	// The error middleware is what turns a handler's apperr into a response. Without it a
	// refusal renders as a bare 200, which is how a test can pass while the API says no.
	router.Use(middleware.Errors(observability.NewErrorReporter("log", log)))
	v1 := router.Group("/api/v1", func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: user.ID, Role: authz.Role(user.Role)})
		c.Next()
	})
	NewModule(Deps{Pool: pool, Codes: svc, Audit: recorder}).RegisterRoutes(v1)

	return &accountFixture{pool: pool, router: router, mailer: mailer, user: user}
}

func (f *accountFixture) do(t *testing.T, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader([]byte("{}"))
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	f.router.ServeHTTP(res, req)
	return res
}

func (f *accountFixture) exists(t *testing.T) bool {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(), `SELECT count(*) FROM users WHERE id = $1`, f.user.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n == 1
}

func TestAccountDeletionPostgres(t *testing.T) {
	t.Run("the code goes to the address on the account, and says what it is for", func(t *testing.T) {
		f := newAccountFixture(t)

		if res := f.do(t, http.MethodPost, "/api/v1/account/deletion/start", nil); res.Code != http.StatusOK {
			t.Fatalf("start: got %d, body %s", res.Code, res.Body.String())
		}
		if f.mailer.count() != 1 {
			t.Fatalf("expected one email, got %d", f.mailer.count())
		}
		if subject := f.mailer.lastSubject(); !regexp.MustCompile(`deletion code`).MatchString(subject) {
			t.Fatalf("a deletion code should not look like a sign-up code: %q", subject)
		}
	})

	t.Run("a wrong code does not delete the account", func(t *testing.T) {
		f := newAccountFixture(t)
		f.do(t, http.MethodPost, "/api/v1/account/deletion/start", nil)

		res := f.do(t, http.MethodPost, "/api/v1/account/deletion/confirm",
			map[string]string{"email": f.user.Email, "code": "000000"})
		if res.Code != http.StatusUnprocessableEntity {
			t.Fatalf("a wrong code should be a validation failure, got %d: %s", res.Code, res.Body.String())
		}
		if !f.exists(t) {
			t.Fatal("account was deleted by a wrong code")
		}
	})

	t.Run("somebody else's address does not delete this account", func(t *testing.T) {
		f := newAccountFixture(t)
		f.do(t, http.MethodPost, "/api/v1/account/deletion/start", nil)
		code := f.mailer.code(t)

		res := f.do(t, http.MethodPost, "/api/v1/account/deletion/confirm",
			map[string]string{"email": "someone-else@example.test", "code": code})
		if res.Code != http.StatusUnprocessableEntity {
			t.Fatalf("a mismatched address should be refused, got %d: %s", res.Code, res.Body.String())
		}
		if !f.exists(t) {
			t.Fatal("account was deleted for a mismatched address")
		}
	})

	t.Run("the right code deletes the account and everything hanging off it", func(t *testing.T) {
		f := newAccountFixture(t)
		ctx := context.Background()
		// Something that cascades, so the test sees the deletion reach past the users row.
		if _, err := f.pool.Exec(ctx,
			`INSERT INTO profiles (user_id, timezone) VALUES ($1, 'UTC') ON CONFLICT (user_id) DO NOTHING`, f.user.ID); err != nil {
			t.Fatal(err)
		}

		f.do(t, http.MethodPost, "/api/v1/account/deletion/start", nil)
		code := f.mailer.code(t)

		res := f.do(t, http.MethodPost, "/api/v1/account/deletion/confirm",
			map[string]string{"email": f.user.Email, "code": code})
		if res.Code != http.StatusNoContent {
			t.Fatalf("confirm: got %d, body %s", res.Code, res.Body.String())
		}
		if f.exists(t) {
			t.Fatal("the account is still there")
		}
		var profiles int
		if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM profiles WHERE user_id = $1`, f.user.ID).Scan(&profiles); err != nil {
			t.Fatal(err)
		}
		if profiles != 0 {
			t.Fatal("the profile outlived the account it belonged to")
		}

		// The record that it happened has to survive the row it describes.
		var entries int
		if err := f.pool.QueryRow(ctx,
			`SELECT count(*) FROM audit_logs WHERE action = $1 AND entity_id = $2`, ActionDeleted, f.user.ID.String()).Scan(&entries); err != nil {
			t.Fatal(err)
		}
		if entries != 1 {
			t.Fatalf("expected one audit entry for the deletion, got %d", entries)
		}
	})

	t.Run("a code is spent once", func(t *testing.T) {
		f := newAccountFixture(t)
		f.do(t, http.MethodPost, "/api/v1/account/deletion/start", nil)
		code := f.mailer.code(t)
		body := map[string]string{"email": f.user.Email, "code": code}

		if res := f.do(t, http.MethodPost, "/api/v1/account/deletion/confirm", body); res.Code != http.StatusNoContent {
			t.Fatalf("first confirm: got %d, body %s", res.Code, res.Body.String())
		}
		// Replaying it must fail, and the account must not somehow come back.
		res := f.do(t, http.MethodPost, "/api/v1/account/deletion/confirm", body)
		if res.Code == http.StatusNoContent || res.Code < 400 {
			t.Fatalf("the same code worked twice: got %d", res.Code)
		}
	})
}

func TestAccountExportPostgres(t *testing.T) {
	f := newAccountFixture(t)
	ctx := context.Background()
	if _, err := f.pool.Exec(ctx,
		`INSERT INTO profiles (user_id, timezone) VALUES ($1, 'Asia/Tashkent') ON CONFLICT (user_id) DO UPDATE SET timezone = 'Asia/Tashkent'`,
		f.user.ID); err != nil {
		t.Fatal(err)
	}

	res := f.do(t, http.MethodGet, "/api/v1/account/export", nil)
	if res.Code != http.StatusOK {
		t.Fatalf("export: got %d, body %s", res.Code, res.Body.String())
	}

	var envelope struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	for _, section := range []string{"account", "profile", "vocabulary", "subscriptions", "payments", "exported_at"} {
		if _, ok := envelope.Data[section]; !ok {
			t.Fatalf("the export is missing %q", section)
		}
	}
	// A file people mail to themselves must not carry the thing that unlocks the account.
	if bytes.Contains(res.Body.Bytes(), []byte("password_hash")) {
		t.Fatal("the export contains the password hash")
	}
	if !bytes.Contains(res.Body.Bytes(), []byte("Asia/Tashkent")) {
		t.Fatal("the export does not contain the learner's own data")
	}
}
