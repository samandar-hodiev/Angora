package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
)

// Token strategy
//
//   - Access token: short-lived HS256 JWT sent as "Authorization: Bearer". Stateless, so
//     every API instance can verify it without a lookup.
//   - Refresh token: long-lived opaque random string, stored only as a SHA-256 hash and
//     rotated on every use. Reuse of a rotated token revokes the whole session family.
//
// Both are returned in the JSON body, which works identically for web, iOS and Android.
// How a client stores them is the client's concern (the web app keeps the refresh token
// in an httpOnly cookie via its own server; mobile apps use the secure keychain).

const accessTokenAudience = "engora-api"

var ErrInvalidToken = errors.New("invalid token")

type AccessClaims struct {
	Role      string `json:"role"`
	SessionID string `json:"sid"`
	jwt.RegisteredClaims
}

type TokenIssuer struct {
	secret []byte
	issuer string
	ttl    time.Duration
	now    func() time.Time
}

func NewTokenIssuer(secret, issuer string, ttl time.Duration) *TokenIssuer {
	return &TokenIssuer{secret: []byte(secret), issuer: issuer, ttl: ttl, now: time.Now}
}

func (t *TokenIssuer) Issue(userID uuid.UUID, role authz.Role, sessionID uuid.UUID) (string, time.Time, error) {
	now := t.now()
	expires := now.Add(t.ttl)
	claims := AccessClaims{
		Role:      string(role),
		SessionID: sessionID.String(),
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    t.issuer,
			Subject:   userID.String(),
			Audience:  jwt.ClaimStrings{accessTokenAudience},
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expires),
			ID:        uuid.NewString(),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(t.secret)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("sign access token: %w", err)
	}
	return signed, expires, nil
}

// Parse verifies signature, algorithm, issuer, audience and expiry and returns the caller.
func (t *TokenIssuer) Parse(token string) (authz.Principal, error) {
	var claims AccessClaims
	_, err := jwt.ParseWithClaims(token, &claims,
		func(*jwt.Token) (any, error) { return t.secret, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(t.issuer),
		jwt.WithAudience(accessTokenAudience),
		jwt.WithExpirationRequired(),
		jwt.WithTimeFunc(t.now),
		jwt.WithLeeway(30*time.Second),
	)
	if err != nil {
		return authz.Principal{}, ErrInvalidToken
	}

	userID, err := uuid.Parse(claims.Subject)
	if err != nil {
		return authz.Principal{}, ErrInvalidToken
	}
	sessionID, err := uuid.Parse(claims.SessionID)
	if err != nil {
		return authz.Principal{}, ErrInvalidToken
	}
	role := authz.Role(claims.Role)
	if !role.Valid() {
		return authz.Principal{}, ErrInvalidToken
	}
	return authz.Principal{UserID: userID, Role: role, SessionID: sessionID}, nil
}

// newRefreshToken returns the raw token for the client and its hash for storage.
func newRefreshToken() (raw, hash string, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", fmt.Errorf("generate refresh token: %w", err)
	}
	raw = base64.RawURLEncoding.EncodeToString(b)
	return raw, hashRefreshToken(raw), nil
}

func hashRefreshToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
