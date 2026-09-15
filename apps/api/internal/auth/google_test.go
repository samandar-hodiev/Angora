package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
)

// ---- verifier ----------------------------------------------------------------------------

const testGoogleClientID = "web-client.apps.googleusercontent.com"

type jwksFixture struct {
	key     *rsa.PrivateKey
	server  *httptest.Server
	fetches int
	mu      sync.Mutex
}

func newJWKSFixture(t *testing.T) *jwksFixture {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f := &jwksFixture{key: key}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		f.mu.Lock()
		f.fetches++
		f.mu.Unlock()
		w.Header().Set("Cache-Control", "public, max-age=3600")
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kid": "key-1", "kty": "RSA", "alg": "RS256", "use": "sig",
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	t.Cleanup(f.server.Close)
	return f
}

func (f *jwksFixture) verifier() *GoogleIDTokenVerifier {
	v := NewGoogleVerifier([]string{"ios-client.apps.googleusercontent.com", testGoogleClientID})
	v.jwksURL = f.server.URL
	return v
}

func (f *jwksFixture) token(t *testing.T, mutate func(*googleClaims, *jwt.Token)) string {
	t.Helper()
	now := time.Now()
	claims := googleClaims{
		Email: "Learner@Gmail.com", EmailVerified: true, Name: "Aziza Karimova",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "https://accounts.google.com", Subject: "1098765432101234567890",
			Audience:  jwt.ClaimStrings{testGoogleClientID},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, &claims)
	tok.Header["kid"] = "key-1"
	if mutate != nil {
		mutate(&claims, tok)
	}
	signed, err := tok.SignedString(f.key)
	if err != nil {
		t.Fatal(err)
	}
	return signed
}

func TestGoogleVerifierAcceptsValidToken(t *testing.T) {
	f := newJWKSFixture(t)
	v := f.verifier()

	id, err := v.Verify(context.Background(), f.token(t, nil))
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if id.Subject != "1098765432101234567890" || id.Email != "Learner@Gmail.com" || id.Name != "Aziza Karimova" {
		t.Errorf("identity = %+v", id)
	}

	// Keys are cached: a second verification does not refetch.
	if _, err := v.Verify(context.Background(), f.token(t, nil)); err != nil {
		t.Fatal(err)
	}
	if f.fetches != 1 {
		t.Errorf("JWKS fetched %d times, want 1", f.fetches)
	}
}

func TestGoogleVerifierRejections(t *testing.T) {
	f := newJWKSFixture(t)
	other, _ := rsa.GenerateKey(rand.Reader, 2048)

	cases := map[string]func(*googleClaims, *jwt.Token){
		"wrong audience":     func(c *googleClaims, _ *jwt.Token) { c.Audience = jwt.ClaimStrings{"someone-else"} },
		"wrong issuer":       func(c *googleClaims, _ *jwt.Token) { c.Issuer = "https://evil.example" },
		"expired":            func(c *googleClaims, _ *jwt.Token) { c.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)) },
		"email not verified": func(c *googleClaims, _ *jwt.Token) { c.EmailVerified = false },
		"unknown key id":     func(_ *googleClaims, tok *jwt.Token) { tok.Header["kid"] = "rotated-away" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := f.verifier().Verify(context.Background(), f.token(t, mutate)); !errors.Is(err, ErrInvalidGoogleToken) {
				t.Errorf("err = %v, want ErrInvalidGoogleToken", err)
			}
		})
	}

	t.Run("signed by another key", func(t *testing.T) {
		claims := googleClaims{EmailVerified: true, Email: "x@gmail.com", RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "accounts.google.com", Subject: "1", Audience: jwt.ClaimStrings{testGoogleClientID},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		}}
		tok := jwt.NewWithClaims(jwt.SigningMethodRS256, &claims)
		tok.Header["kid"] = "key-1"
		forged, _ := tok.SignedString(other)
		if _, err := f.verifier().Verify(context.Background(), forged); !errors.Is(err, ErrInvalidGoogleToken) {
			t.Errorf("err = %v, want ErrInvalidGoogleToken", err)
		}
	})

	t.Run("HS256 with public key as secret", func(t *testing.T) {
		tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": "1", "aud": testGoogleClientID})
		tok.Header["kid"] = "key-1"
		forged, _ := tok.SignedString([]byte("anything"))
		if _, err := f.verifier().Verify(context.Background(), forged); !errors.Is(err, ErrInvalidGoogleToken) {
			t.Errorf("err = %v, want ErrInvalidGoogleToken", err)
		}
	})
}

// ---- service -----------------------------------------------------------------------------

type stubGoogle struct {
	identity GoogleIdentity
	err      error
}

func (s stubGoogle) Verify(context.Context, string) (GoogleIdentity, error) { return s.identity, s.err }

type fakeIdentities struct {
	mu    sync.Mutex
	links map[string]uuid.UUID // provider:subject -> user
}

func (f *fakeIdentities) UserIDByIdentity(_ context.Context, provider, subject string) (uuid.UUID, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	id, ok := f.links[provider+":"+subject]
	if !ok {
		return uuid.Nil, ErrIdentityNotFound
	}
	return id, nil
}

func (f *fakeIdentities) LinkIdentity(_ context.Context, userID uuid.UUID, provider, subject, _ string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.links[provider+":"+subject] = userID
	return nil
}

func newGoogleTestService(t *testing.T, google GoogleVerifier) (*Service, *fakeUsers, *fakeIdentities) {
	t.Helper()
	us, identities := newFakeUsers(), &fakeIdentities{links: map[string]uuid.UUID{}}
	svc, err := NewService(Deps{
		Users: us, Tokens: newFakeTokens(), Resets: &fakeResets{byHash: map[string]*PasswordReset{}, used: map[string]bool{}},
		Hasher: fastHasher, Issuer: NewTokenIssuer(testSecret, "engora", 15*time.Minute), Audit: audit.Nop{},
		Mailer: &captureMailer{}, Identities: identities, Google: google,
	}, Options{RefreshTTL: 24 * time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	return svc, us, identities
}

var googleUser = GoogleIdentity{Subject: "google-sub-1", Email: "New.Learner@gmail.com", Name: "New Learner"}

func TestGoogleLoginCreatesAccountThenSignsIn(t *testing.T) {
	svc, us, _ := newGoogleTestService(t, stubGoogle{identity: googleUser})
	ctx := context.Background()

	first, err := svc.LoginWithGoogle(ctx, GoogleLoginInput{IDToken: "token", Timezone: "Asia/Tashkent"}, client)
	if err != nil {
		t.Fatalf("first login: %v", err)
	}
	if !first.IsNewUser || first.AccessToken == "" || first.RefreshToken == "" {
		t.Fatalf("expected a new user session, got %+v", first)
	}
	creds, _ := us.GetCredentialsByEmail(ctx, "new.learner@gmail.com")
	if creds.PasswordHash != "" || creds.EmailVerifiedAt == nil {
		t.Errorf("Google accounts have no password and a verified email: %+v", creds)
	}

	second, err := svc.LoginWithGoogle(ctx, GoogleLoginInput{IDToken: "token"}, client)
	if err != nil {
		t.Fatalf("second login: %v", err)
	}
	if second.IsNewUser || second.User.ID != first.User.ID {
		t.Errorf("returning user must reuse the account: first %s, second %+v", first.User.ID, second.User)
	}
}

func TestGoogleLoginLinksExistingEmailAccount(t *testing.T) {
	svc, _, identities := newGoogleTestService(t, stubGoogle{identity: GoogleIdentity{Subject: "sub-2", Email: "LEARNER@example.com"}})
	registered := register(t, svc) // learner@example.com with a password

	session, err := svc.LoginWithGoogle(context.Background(), GoogleLoginInput{IDToken: "token"}, client)
	if err != nil {
		t.Fatal(err)
	}
	if session.IsNewUser || session.User.ID != registered.User.ID {
		t.Errorf("Google must link to the existing account, got %+v", session.User)
	}
	if identities.links["google:sub-2"] != registered.User.ID {
		t.Error("identity was not linked")
	}
	if _, err := svc.Login(context.Background(), LoginInput{Email: "learner@example.com", Password: "correct-horse"}, client); err != nil {
		t.Errorf("password sign-in must keep working after linking: %v", err)
	}
}

func TestGoogleLoginFailures(t *testing.T) {
	t.Run("not configured", func(t *testing.T) {
		svc, _, _ := newGoogleTestService(t, nil)
		_, err := svc.LoginWithGoogle(context.Background(), GoogleLoginInput{IDToken: "x"}, client)
		if !apperr.Is(err, apperr.CodeNotImplemented) {
			t.Errorf("err = %v, want NOT_IMPLEMENTED", err)
		}
	})
	t.Run("invalid token", func(t *testing.T) {
		svc, _, _ := newGoogleTestService(t, stubGoogle{err: ErrInvalidGoogleToken})
		_, err := svc.LoginWithGoogle(context.Background(), GoogleLoginInput{IDToken: "x"}, client)
		if !apperr.Is(err, apperr.CodeUnauthorized) {
			t.Errorf("err = %v, want UNAUTHORIZED", err)
		}
	})
	t.Run("suspended account", func(t *testing.T) {
		svc, us, _ := newGoogleTestService(t, stubGoogle{identity: GoogleIdentity{Subject: "s", Email: "learner@example.com"}})
		s := register(t, svc)
		us.setStatus(s.User.ID, users.StatusSuspended)
		_, err := svc.LoginWithGoogle(context.Background(), GoogleLoginInput{IDToken: "x"}, client)
		if !apperr.Is(err, apperr.CodeForbidden) {
			t.Errorf("err = %v, want FORBIDDEN", err)
		}
	})
}

func TestGoogleDisplayName(t *testing.T) {
	if got := googleDisplayName(GoogleIdentity{Email: "aziza.k@gmail.com"}); got != "aziza.k" {
		t.Errorf("fallback name = %q", got)
	}
	if got := googleDisplayName(GoogleIdentity{Name: "  Aziza  "}); got != "Aziza" {
		t.Errorf("trimmed name = %q", got)
	}
}
