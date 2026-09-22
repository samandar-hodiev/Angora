package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/mail"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/middleware"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

// ---- fakes ------------------------------------------------------------------

type fakeUsers struct {
	mu     sync.Mutex
	byID   map[uuid.UUID]users.Credentials
	byMail map[string]uuid.UUID
}

func newFakeUsers() *fakeUsers {
	return &fakeUsers{byID: map[uuid.UUID]users.Credentials{}, byMail: map[string]uuid.UUID{}}
}

func (f *fakeUsers) SetRole(_ context.Context, id uuid.UUID, role authz.Role) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.byID[id]
	if !ok {
		return users.ErrNotFound
	}
	c.Role = role
	f.byID[id] = c
	return nil
}

func (f *fakeUsers) CreateAccount(_ context.Context, in users.NewAccount) (users.User, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.byMail[in.Email]; ok {
		return users.User{}, users.ErrEmailTaken
	}
	role := in.Role
	if role == "" {
		role = authz.RoleUser
	}
	u := users.User{ID: uuid.New(), Email: in.Email, Role: role, Status: users.StatusActive}
	if in.EmailVerified {
		now := time.Now()
		u.EmailVerifiedAt = &now
	}
	f.byID[u.ID] = users.Credentials{User: u, PasswordHash: in.PasswordHash}
	f.byMail[in.Email] = u.ID
	return u, nil
}

func (f *fakeUsers) GetByID(_ context.Context, id uuid.UUID) (users.User, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.byID[id]
	if !ok {
		return users.User{}, users.ErrNotFound
	}
	return c.User, nil
}

func (f *fakeUsers) GetCredentialsByEmail(_ context.Context, email string) (users.Credentials, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	id, ok := f.byMail[email]
	if !ok {
		return users.Credentials{}, users.ErrNotFound
	}
	return f.byID[id], nil
}

func (f *fakeUsers) TouchLastLogin(context.Context, uuid.UUID) error { return nil }

func (f *fakeUsers) AuthStatus(ctx context.Context, id uuid.UUID) (string, bool, error) {
	has, err := f.HasPassword(ctx, id)
	return "email", has, err
}

func (f *fakeUsers) HasPassword(_ context.Context, id uuid.UUID) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.byID[id]
	if !ok {
		return false, users.ErrNotFound
	}
	return c.PasswordHash != "", nil
}

func (f *fakeUsers) MarkEmailVerified(_ context.Context, id uuid.UUID) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	c := f.byID[id]
	if c.EmailVerifiedAt == nil {
		now := time.Now()
		c.EmailVerifiedAt = &now
		f.byID[id] = c
	}
	return nil
}

func (f *fakeUsers) UpdatePassword(_ context.Context, id uuid.UUID, hash string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.byID[id]
	if !ok {
		return users.ErrNotFound
	}
	c.PasswordHash = hash
	f.byID[id] = c
	return nil
}

func (f *fakeUsers) setStatus(id uuid.UUID, s users.Status) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c := f.byID[id]
	c.Status = s
	f.byID[id] = c
}

type fakeTokens struct {
	mu     sync.Mutex
	byHash map[string]*RefreshToken
}

func newFakeTokens() *fakeTokens { return &fakeTokens{byHash: map[string]*RefreshToken{}} }

func (f *fakeTokens) Create(_ context.Context, t RefreshToken) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.byHash[t.TokenHash] = &t
	return nil
}

func (f *fakeTokens) GetByHash(_ context.Context, hash string) (RefreshToken, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	t, ok := f.byHash[hash]
	if !ok {
		return RefreshToken{}, ErrTokenNotFound
	}
	return *t, nil
}

func (f *fakeTokens) Rotate(_ context.Context, currentID uuid.UUID, next RefreshToken) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, t := range f.byHash {
		if t.ID == currentID {
			if t.RevokedAt != nil {
				return false, nil
			}
			now := time.Now()
			t.RevokedAt = &now
			f.byHash[next.TokenHash] = &next
			return true, nil
		}
	}
	return false, nil
}

func (f *fakeTokens) RevokeFamily(_ context.Context, familyID uuid.UUID) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	now := time.Now()
	for _, t := range f.byHash {
		if t.FamilyID == familyID && t.RevokedAt == nil {
			t.RevokedAt = &now
		}
	}
	return nil
}

func (f *fakeTokens) RevokeAllForUser(_ context.Context, userID uuid.UUID) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	now := time.Now()
	for _, t := range f.byHash {
		if t.UserID == userID && t.RevokedAt == nil {
			t.RevokedAt = &now
		}
	}
	return nil
}

type fakeResets struct {
	mu     sync.Mutex
	byHash map[string]*PasswordReset
	used   map[string]bool
}

func (f *fakeResets) Create(_ context.Context, r PasswordReset) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.byHash[r.TokenHash] = &r
	return nil
}

func (f *fakeResets) Consume(_ context.Context, hash string, now time.Time) (uuid.UUID, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	r, ok := f.byHash[hash]
	if !ok || f.used[hash] || !now.Before(r.ExpiresAt) {
		return uuid.Nil, ErrResetTokenInvalid
	}
	f.used[hash] = true
	return r.UserID, nil
}

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

// fastHasher keeps Argon2id but with tiny parameters so tests stay fast.
var fastHasher = Argon2idHasher{Memory: 1024, Iterations: 1, Parallelism: 1, SaltLength: 16, KeyLength: 32}

const testSecret = "test-secret-that-is-long-enough-for-hs256"

func newTestService(t *testing.T) (*Service, *fakeUsers, *fakeTokens) {
	svc, us, ts, _ := newTestServiceWithMailer(t)
	return svc, us, ts
}

func newTestServiceWithMailer(t *testing.T) (*Service, *fakeUsers, *fakeTokens, *captureMailer) {
	t.Helper()
	us, ts, mailer := newFakeUsers(), newFakeTokens(), &captureMailer{}
	svc, err := NewService(Deps{
		Users:  us,
		Tokens: ts,
		Resets: &fakeResets{byHash: map[string]*PasswordReset{}, used: map[string]bool{}},
		Hasher: fastHasher,
		Issuer: NewTokenIssuer(testSecret, "engora", 15*time.Minute),
		Audit:  audit.Nop{},
		Mailer: mailer,
	}, Options{RefreshTTL: 24 * time.Hour, ResetTTL: time.Hour, WebURL: "https://app.engora.test/"})
	if err != nil {
		t.Fatal(err)
	}
	return svc, us, ts, mailer
}

var client = ClientInfo{Platform: "web", UserAgent: "test", IP: "127.0.0.1"}

func register(t *testing.T, svc *Service) Session {
	t.Helper()
	s, err := svc.Register(context.Background(), RegisterInput{
		Email: " Learner@Example.com ", Password: "correct-horse", DisplayName: "Learner",
	}, client)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	return s
}

// ---- password ---------------------------------------------------------------

func TestPasswordHashAndVerify(t *testing.T) {
	hash, err := fastHasher.Hash("s3cret-password")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$") {
		t.Fatalf("unexpected hash format: %s", hash)
	}
	if ok, _ := fastHasher.Verify("s3cret-password", hash); !ok {
		t.Error("correct password rejected")
	}
	if ok, _ := fastHasher.Verify("wrong-password", hash); ok {
		t.Error("wrong password accepted")
	}
	other, _ := fastHasher.Hash("s3cret-password")
	if other == hash {
		t.Error("hashes of the same password must differ (random salt)")
	}
	if _, err := fastHasher.Verify("x", "$bcrypt$nope"); err != ErrInvalidHash {
		t.Errorf("malformed hash: err = %v, want ErrInvalidHash", err)
	}
}

// ---- tokens -----------------------------------------------------------------

func TestAccessTokenRoundTrip(t *testing.T) {
	issuer := NewTokenIssuer(testSecret, "engora", time.Minute)
	userID, sid := uuid.New(), uuid.New()

	token, _, err := issuer.Issue(userID, authz.RoleAdmin, sid)
	if err != nil {
		t.Fatal(err)
	}
	p, err := issuer.Parse(token)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if p.UserID != userID || p.Role != authz.RoleAdmin || p.SessionID != sid {
		t.Errorf("principal = %+v", p)
	}
}

func TestAccessTokenRejections(t *testing.T) {
	issuer := NewTokenIssuer(testSecret, "engora", time.Minute)
	token, _, _ := issuer.Issue(uuid.New(), authz.RoleUser, uuid.New())

	t.Run("wrong secret", func(t *testing.T) {
		other := NewTokenIssuer("another-secret-that-is-long-enough!!", "engora", time.Minute)
		if _, err := other.Parse(token); err == nil {
			t.Error("accepted token signed with a different secret")
		}
	})
	t.Run("expired", func(t *testing.T) {
		later := NewTokenIssuer(testSecret, "engora", time.Minute)
		later.now = func() time.Time { return time.Now().Add(10 * time.Minute) }
		if _, err := later.Parse(token); err == nil {
			t.Error("accepted expired token")
		}
	})
	t.Run("wrong issuer", func(t *testing.T) {
		other := NewTokenIssuer(testSecret, "someone-else", time.Minute)
		if _, err := other.Parse(token); err == nil {
			t.Error("accepted token from another issuer")
		}
	})
	t.Run("alg none", func(t *testing.T) {
		claims := AccessClaims{Role: "ADMIN", SessionID: uuid.NewString(), RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "engora", Subject: uuid.NewString(), Audience: jwt.ClaimStrings{accessTokenAudience},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		}}
		unsigned, _ := jwt.NewWithClaims(jwt.SigningMethodNone, claims).SignedString(jwt.UnsafeAllowNoneSignatureType)
		if _, err := issuer.Parse(unsigned); err == nil {
			t.Error("accepted unsigned token")
		}
	})
}

// ---- service ----------------------------------------------------------------

func TestRegisterAndLogin(t *testing.T) {
	svc, _, _ := newTestService(t)
	s := register(t, svc)
	if s.User.Email != "learner@example.com" {
		t.Errorf("email not normalized: %q", s.User.Email)
	}
	if s.AccessToken == "" || s.RefreshToken == "" || s.TokenType != "Bearer" {
		t.Errorf("incomplete session: %+v", s)
	}

	if _, err := svc.Login(context.Background(), LoginInput{Email: "LEARNER@example.com", Password: "correct-horse"}, client); err != nil {
		t.Errorf("login with correct password: %v", err)
	}
}

func TestRegisterDuplicateEmail(t *testing.T) {
	svc, _, _ := newTestService(t)
	register(t, svc)
	_, err := svc.Register(context.Background(), RegisterInput{
		Email: "learner@example.com", Password: "another-pass", DisplayName: "Other",
	}, client)
	if !apperr.Is(err, apperr.CodeConflict) {
		t.Errorf("err = %v, want CONFLICT", err)
	}
}

func TestLoginFailuresAreIndistinguishable(t *testing.T) {
	svc, _, _ := newTestService(t)
	register(t, svc)

	_, wrongPassword := svc.Login(context.Background(), LoginInput{Email: "learner@example.com", Password: "nope-nope"}, client)
	_, unknownEmail := svc.Login(context.Background(), LoginInput{Email: "ghost@example.com", Password: "nope-nope"}, client)

	for name, err := range map[string]error{"wrong password": wrongPassword, "unknown email": unknownEmail} {
		appErr := apperr.From(err)
		if appErr.Code != apperr.CodeUnauthorized || appErr.Message != "Invalid email or password" {
			t.Errorf("%s: got %v", name, err)
		}
	}
}

func TestLoginRejectsSuspendedAccount(t *testing.T) {
	svc, us, _ := newTestService(t)
	s := register(t, svc)
	us.setStatus(s.User.ID, users.StatusSuspended)

	_, err := svc.Login(context.Background(), LoginInput{Email: "learner@example.com", Password: "correct-horse"}, client)
	if !apperr.Is(err, apperr.CodeForbidden) {
		t.Errorf("err = %v, want FORBIDDEN", err)
	}
}

func TestRefreshRotatesAndDetectsReuse(t *testing.T) {
	svc, _, _ := newTestService(t)
	first := register(t, svc)
	ctx := context.Background()

	second, err := svc.Refresh(ctx, first.RefreshToken, client)
	if err != nil {
		t.Fatalf("first refresh: %v", err)
	}
	if second.RefreshToken == first.RefreshToken {
		t.Fatal("refresh token was not rotated")
	}

	// Replaying the rotated token must fail and revoke the whole family...
	if _, err := svc.Refresh(ctx, first.RefreshToken, client); !apperr.Is(err, apperr.CodeUnauthorized) {
		t.Fatalf("reuse: err = %v, want UNAUTHORIZED", err)
	}
	// ...including the legitimate latest token.
	if _, err := svc.Refresh(ctx, second.RefreshToken, client); !apperr.Is(err, apperr.CodeUnauthorized) {
		t.Fatalf("after reuse detection the family must be revoked, err = %v", err)
	}
}

func TestRefreshRejectsExpiredToken(t *testing.T) {
	svc, _, _ := newTestService(t)
	s := register(t, svc)
	svc.now = func() time.Time { return time.Now().Add(48 * time.Hour) }

	if _, err := svc.Refresh(context.Background(), s.RefreshToken, client); !apperr.Is(err, apperr.CodeUnauthorized) {
		t.Errorf("err = %v, want UNAUTHORIZED", err)
	}
}

func TestLogoutRevokesSession(t *testing.T) {
	svc, _, _ := newTestService(t)
	s := register(t, svc)
	ctx := context.Background()

	if err := svc.Logout(ctx, s.RefreshToken, client); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Refresh(ctx, s.RefreshToken, client); !apperr.Is(err, apperr.CodeUnauthorized) {
		t.Errorf("refresh after logout: err = %v, want UNAUTHORIZED", err)
	}
	if err := svc.Logout(ctx, "unknown-token", client); err != nil {
		t.Errorf("logout must be idempotent, got %v", err)
	}
}

// ---- password reset -----------------------------------------------------------

var resetLink = regexp.MustCompile(`https://app\.engora\.test/reset-password\?token=(\S+)`)

func TestForgotPasswordDoesNotRevealAccounts(t *testing.T) {
	svc, _, _, mailer := newTestServiceWithMailer(t)
	if err := svc.ForgotPassword(context.Background(), ForgotPasswordInput{Email: "ghost@example.com"}, client); err != nil {
		t.Fatalf("unknown email must succeed silently, got %v", err)
	}
	if len(mailer.sent) != 0 {
		t.Errorf("no email may be sent for unknown accounts, sent %d", len(mailer.sent))
	}
}

func TestPasswordResetFlow(t *testing.T) {
	svc, _, _, mailer := newTestServiceWithMailer(t)
	session := register(t, svc)
	ctx := context.Background()

	if err := svc.ForgotPassword(ctx, ForgotPasswordInput{Email: "LEARNER@example.com"}, client); err != nil {
		t.Fatal(err)
	}
	if len(mailer.sent) != 1 || mailer.sent[0].To != "learner@example.com" {
		t.Fatalf("expected one reset email to the account, got %+v", mailer.sent)
	}
	m := resetLink.FindStringSubmatch(mailer.sent[0].Text)
	if m == nil {
		t.Fatalf("reset link not found in %q", mailer.sent[0].Text)
	}
	token, _ := url.QueryUnescape(m[1])

	if err := svc.ResetPassword(ctx, ResetPasswordInput{Token: token, Password: "brand-new-password"}, client); err != nil {
		t.Fatalf("reset: %v", err)
	}

	if _, err := svc.Login(ctx, LoginInput{Email: "learner@example.com", Password: "correct-horse"}, client); !apperr.Is(err, apperr.CodeUnauthorized) {
		t.Errorf("old password must stop working, err = %v", err)
	}
	if _, err := svc.Login(ctx, LoginInput{Email: "learner@example.com", Password: "brand-new-password"}, client); err != nil {
		t.Errorf("new password must work: %v", err)
	}
	if _, err := svc.Refresh(ctx, session.RefreshToken, client); !apperr.Is(err, apperr.CodeUnauthorized) {
		t.Errorf("existing sessions must be revoked after a reset, err = %v", err)
	}
	if err := svc.ResetPassword(ctx, ResetPasswordInput{Token: token, Password: "another-password"}, client); !apperr.Is(err, apperr.CodeValidation) {
		t.Errorf("reset tokens must be single-use, err = %v", err)
	}
}

// ---- HTTP -------------------------------------------------------------------

func newTestRouter(t *testing.T) (*gin.Engine, *Service) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	svc, _, _ := newTestService(t)
	issuer := svc.issuer

	r := gin.New()
	r.Use(middleware.Errors(observability.LogReporter{Log: logger.Discard()}))
	v1 := r.Group("/api/v1", Authenticate(issuer))
	NewHandler(svc).RegisterRoutes(v1, func(c *gin.Context) { c.Next() })
	v1.GET("/private", authz.RequireAuthenticated(), func(c *gin.Context) { c.Status(http.StatusOK) })
	return r, svc
}

func doJSON(r http.Handler, method, path string, body any, headers map[string]string) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

type envelope struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data"`
	Error   *struct {
		Code    string         `json:"code"`
		Details map[string]any `json:"details"`
	} `json:"error"`
}

func decode(t *testing.T, w *httptest.ResponseRecorder) envelope {
	t.Helper()
	var e envelope
	if err := json.Unmarshal(w.Body.Bytes(), &e); err != nil {
		t.Fatalf("invalid JSON %q: %v", w.Body.String(), err)
	}
	return e
}

func TestRegisterEndpointValidation(t *testing.T) {
	r, _ := newTestRouter(t)
	w := doJSON(r, http.MethodPost, "/api/v1/auth/register",
		map[string]string{"email": "not-an-email", "password": "short"}, nil)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, want 422: %s", w.Code, w.Body.String())
	}
	e := decode(t, w)
	if e.Success || e.Error == nil || e.Error.Code != "VALIDATION_ERROR" {
		t.Fatalf("unexpected envelope: %s", w.Body.String())
	}
	fields, _ := e.Error.Details["fields"].(map[string]any)
	for _, f := range []string{"email", "password", "display_name"} {
		if _, ok := fields[f]; !ok {
			t.Errorf("missing field error for %q in %v", f, fields)
		}
	}
}

func TestAuthFlowOverHTTP(t *testing.T) {
	r, _ := newTestRouter(t)

	w := doJSON(r, http.MethodPost, "/api/v1/auth/register", map[string]string{
		"email": "http@example.com", "password": "long-enough-password", "display_name": "HTTP",
	}, map[string]string{"X-Client-Platform": "ios"})
	if w.Code != http.StatusCreated {
		t.Fatalf("register: %d %s", w.Code, w.Body.String())
	}
	var session Session
	if err := json.Unmarshal(decode(t, w).Data, &session); err != nil {
		t.Fatal(err)
	}

	if w := doJSON(r, http.MethodGet, "/api/v1/private", nil, nil); w.Code != http.StatusUnauthorized {
		t.Errorf("anonymous private: %d, want 401", w.Code)
	}
	if w := doJSON(r, http.MethodGet, "/api/v1/private", nil, map[string]string{"Authorization": "Bearer garbage"}); w.Code != http.StatusUnauthorized {
		t.Errorf("bad token: %d, want 401", w.Code)
	}
	if w := doJSON(r, http.MethodGet, "/api/v1/private", nil, map[string]string{"Authorization": "Bearer " + session.AccessToken}); w.Code != http.StatusOK {
		t.Errorf("valid token: %d, want 200", w.Code)
	}

	w = doJSON(r, http.MethodPost, "/api/v1/auth/login", map[string]string{"email": "http@example.com", "password": "wrong-password"}, nil)
	if w.Code != http.StatusUnauthorized || decode(t, w).Error.Code != "UNAUTHORIZED" {
		t.Errorf("wrong password: %d %s", w.Code, w.Body.String())
	}
}
