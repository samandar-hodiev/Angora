package auth

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/golang-jwt/jwt/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
)

// Google sign-in
//
// Every client (web via Google Identity Services, iOS/Android via the native Google Sign-In
// SDKs) obtains a Google ID token and sends it to POST /api/v1/auth/google. The API verifies
// the token itself — signature against Google's published keys, issuer, audience (one of our
// OAuth client IDs), expiry and email verification — so no client is trusted.

const googleJWKSURL = "https://www.googleapis.com/oauth2/v3/certs"

var ErrInvalidGoogleToken = errors.New("invalid Google ID token")

// GoogleIdentity is the verified content of a Google ID token.
type GoogleIdentity struct {
	Subject string
	Email   string
	Name    string
	Picture string
}

type GoogleVerifier interface {
	Verify(ctx context.Context, idToken string) (GoogleIdentity, error)
}

type googleClaims struct {
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
	jwt.RegisteredClaims
}

// GoogleIDTokenVerifier verifies ID tokens against Google's JWKS, caching keys for as long
// as Google's Cache-Control allows.
type GoogleIDTokenVerifier struct {
	clientIDs []string
	jwksURL   string
	client    *http.Client
	now       func() time.Time

	mu          sync.Mutex
	keys        map[string]*rsa.PublicKey
	validUntil  time.Time
	lastAttempt time.Time
}

func NewGoogleVerifier(clientIDs []string) *GoogleIDTokenVerifier {
	return &GoogleIDTokenVerifier{
		clientIDs: clientIDs,
		jwksURL:   googleJWKSURL,
		client:    &http.Client{Timeout: 10 * time.Second},
		now:       time.Now,
	}
}

func (v *GoogleIDTokenVerifier) Verify(ctx context.Context, idToken string) (GoogleIdentity, error) {
	var claims googleClaims
	_, err := jwt.ParseWithClaims(idToken, &claims,
		func(t *jwt.Token) (any, error) {
			kid, _ := t.Header["kid"].(string)
			if kid == "" {
				return nil, errors.New("missing kid")
			}
			return v.key(ctx, kid)
		},
		jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Alg()}),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithTimeFunc(v.now),
		jwt.WithLeeway(time.Minute),
	)
	if err != nil {
		return GoogleIdentity{}, fmt.Errorf("%w: %v", ErrInvalidGoogleToken, err)
	}
	if claims.Issuer != "accounts.google.com" && claims.Issuer != "https://accounts.google.com" {
		return GoogleIdentity{}, fmt.Errorf("%w: unexpected issuer %q", ErrInvalidGoogleToken, claims.Issuer)
	}
	if !slices.ContainsFunc(claims.Audience, func(aud string) bool { return slices.Contains(v.clientIDs, aud) }) {
		return GoogleIdentity{}, fmt.Errorf("%w: audience is not one of our client IDs", ErrInvalidGoogleToken)
	}
	if claims.Subject == "" || claims.Email == "" || !claims.EmailVerified {
		return GoogleIdentity{}, fmt.Errorf("%w: email missing or not verified", ErrInvalidGoogleToken)
	}
	return GoogleIdentity{Subject: claims.Subject, Email: claims.Email, Name: claims.Name, Picture: claims.Picture}, nil
}

func (v *GoogleIDTokenVerifier) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()

	now := v.now()
	if k, ok := v.keys[kid]; ok && now.Before(v.validUntil) {
		return k, nil
	}
	// Refresh when the cache expired or a new key appeared (Google rotates keys), but never
	// more than once every 30 seconds so forged kids cannot hammer Google's endpoint.
	if now.Sub(v.lastAttempt) >= 30*time.Second || now.After(v.validUntil) {
		v.lastAttempt = now
		if err := v.refresh(ctx); err != nil {
			return nil, err
		}
	}
	if k, ok := v.keys[kid]; ok {
		return k, nil
	}
	return nil, fmt.Errorf("unknown key id %q", kid)
}

var maxAgePattern = regexp.MustCompile(`max-age=(\d+)`)

func (v *GoogleIDTokenVerifier) refresh(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.jwksURL, nil)
	if err != nil {
		return err
	}
	resp, err := v.client.Do(req)
	if err != nil {
		return fmt.Errorf("fetch Google keys: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("fetch Google keys: status %d", resp.StatusCode)
	}

	var doc struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return fmt.Errorf("decode Google keys: %w", err)
	}

	keys := make(map[string]*rsa.PublicKey, len(doc.Keys))
	for _, k := range doc.Keys {
		if k.Kty != "RSA" {
			continue
		}
		n, errN := base64.RawURLEncoding.DecodeString(k.N)
		e, errE := base64.RawURLEncoding.DecodeString(k.E)
		if errN != nil || errE != nil {
			continue
		}
		keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
	}
	if len(keys) == 0 {
		return errors.New("Google keys response contained no RSA keys")
	}

	ttl := time.Hour
	if m := maxAgePattern.FindStringSubmatch(resp.Header.Get("Cache-Control")); m != nil {
		if seconds, err := strconv.Atoi(m[1]); err == nil && seconds > 0 {
			ttl = time.Duration(seconds) * time.Second
		}
	}
	v.keys = keys
	v.validUntil = v.now().Add(ttl)
	return nil
}

// ---- service -------------------------------------------------------------------------

type GoogleLoginInput struct {
	IDToken  string `json:"id_token" binding:"required,max=4096"`
	Timezone string `json:"timezone" binding:"omitempty,max=64"`
}

// LoginWithGoogle signs a learner in with a verified Google identity:
//
//  1. identity already linked            → sign in to that account
//  2. account with the same email exists → link Google to it (Google verified the email)
//  3. otherwise                          → create a new account (no password) and sign in
//
// Session.IsNewUser tells clients to start onboarding.
func (s *Service) LoginWithGoogle(ctx context.Context, in GoogleLoginInput, client ClientInfo) (Session, error) {
	if s.google == nil || s.identities == nil {
		return Session{}, apperr.New(apperr.CodeNotImplemented, "Google sign-in is not configured")
	}
	identity, err := s.google.Verify(ctx, in.IDToken)
	if err != nil {
		return Session{}, apperr.Wrap(err, apperr.CodeUnauthorized, "Google sign-in failed. Please try again.")
	}
	email := normalizeEmail(identity.Email)

	var user users.User
	created := false

	userID, err := s.identities.UserIDByIdentity(ctx, ProviderGoogle, identity.Subject)
	switch {
	case err == nil:
		user, err = s.users.GetByID(ctx, userID)
		if errors.Is(err, users.ErrNotFound) {
			return Session{}, apperr.Unauthorized("This account no longer exists")
		}
		if err != nil {
			return Session{}, fmt.Errorf("load user: %w", err)
		}

	case errors.Is(err, ErrIdentityNotFound):
		creds, lookupErr := s.users.GetCredentialsByEmail(ctx, email)
		switch {
		case lookupErr == nil:
			user = creds.User
			if user.Status == users.StatusActive {
				if err := s.users.MarkEmailVerified(ctx, user.ID); err != nil {
					return Session{}, fmt.Errorf("mark email verified: %w", err)
				}
			}
		case errors.Is(lookupErr, users.ErrNotFound):
			tz, _ := resolveTimezone(in.Timezone)
			user, err = s.users.CreateAccount(ctx, users.NewAccount{
				Email:         email,
				DisplayName:   googleDisplayName(identity),
				Timezone:      tz,
				EmailVerified: true,
				AuthProvider:  ProviderGoogle,
			})
			if errors.Is(err, users.ErrEmailTaken) {
				return Session{}, apperr.Conflict("An account with this email was just created. Please try again.")
			}
			if err != nil {
				return Session{}, fmt.Errorf("create account: %w", err)
			}
			created = true
			s.audit.Record(ctx, audit.Entry{ActorID: &user.ID, Action: audit.ActionRegistered,
				EntityType: "user", EntityID: user.ID.String(), IP: client.IP, UserAgent: client.UserAgent,
				Metadata: map[string]any{"platform": client.Platform, "provider": ProviderGoogle}})
			s.welcome(ctx, user)
		default:
			return Session{}, fmt.Errorf("load account: %w", lookupErr)
		}

	default:
		return Session{}, fmt.Errorf("load identity: %w", err)
	}

	if user.Status != users.StatusActive {
		return Session{}, apperr.Forbidden("This account is not active")
	}
	if err := s.identities.LinkIdentity(ctx, user.ID, ProviderGoogle, identity.Subject, email); err != nil {
		return Session{}, fmt.Errorf("link identity: %w", err)
	}
	if err := s.users.TouchLastLogin(ctx, user.ID); err != nil {
		return Session{}, fmt.Errorf("touch last login: %w", err)
	}
	s.audit.Record(ctx, audit.Entry{ActorID: &user.ID, Action: audit.ActionLoggedIn,
		EntityType: "user", EntityID: user.ID.String(), IP: client.IP, UserAgent: client.UserAgent,
		Metadata: map[string]any{"platform": client.Platform, "provider": ProviderGoogle}})

	session, err := s.startSession(ctx, user, newFamilyID(), client)
	if err != nil {
		return Session{}, err
	}
	session.IsNewUser = created
	return session, nil
}

func googleDisplayName(identity GoogleIdentity) string {
	name := strings.TrimSpace(identity.Name)
	if name == "" {
		name, _, _ = strings.Cut(identity.Email, "@")
	}
	if utf8.RuneCountInString(name) > 80 {
		name = string([]rune(name)[:80])
	}
	return name
}
