// Package auth implements registration, login, token refresh, logout and password reset,
// and the middleware that authenticates API requests.
package auth

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/mail"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
)

// UserStore is the subset of the users module that authentication needs.
type UserStore interface {
	CreateAccount(ctx context.Context, in users.NewAccount) (users.User, error)
	GetByID(ctx context.Context, id uuid.UUID) (users.User, error)
	GetCredentialsByEmail(ctx context.Context, email string) (users.Credentials, error)
	TouchLastLogin(ctx context.Context, id uuid.UUID) error
	UpdatePassword(ctx context.Context, id uuid.UUID, passwordHash string) error
	MarkEmailVerified(ctx context.Context, id uuid.UUID) error
	HasPassword(ctx context.Context, id uuid.UUID) (bool, error)
	AuthStatus(ctx context.Context, id uuid.UUID) (provider string, hasPassword bool, err error)
}

// ClientInfo describes the calling device for session metadata only. It never changes
// business behaviour: web, iOS and Android are served identically.
type ClientInfo struct {
	Platform  string
	UserAgent string
	IP        string
}

type RegisterInput struct {
	Email       string `json:"email" binding:"required,email,max=254"`
	Password    string `json:"password" binding:"required,min=8,max=128"`
	DisplayName string `json:"display_name" binding:"required,min=1,max=80"`
	Timezone    string `json:"timezone" binding:"omitempty,max=64"`
}

type LoginInput struct {
	Email    string `json:"email" binding:"required,email,max=254"`
	Password string `json:"password" binding:"required,max=128"`
}

type ForgotPasswordInput struct {
	Email string `json:"email" binding:"required,email,max=254"`
}

type ResetPasswordInput struct {
	Token    string `json:"token" binding:"required,max=256"`
	Password string `json:"password" binding:"required,min=8,max=128"`
}

type Session struct {
	AccessToken           string     `json:"access_token"`
	AccessTokenExpiresAt  time.Time  `json:"access_token_expires_at"`
	RefreshToken          string     `json:"refresh_token"`
	RefreshTokenExpiresAt time.Time  `json:"refresh_token_expires_at"`
	TokenType             string     `json:"token_type"`
	User                  users.User `json:"user"`
	// IsNewUser is true when this sign-in created the account (clients start onboarding).
	IsNewUser bool `json:"is_new_user"`
}

// Deps are the collaborators of the auth service.
type Deps struct {
	Users  UserStore
	Tokens TokenRepository
	Resets ResetStore
	Hasher PasswordHasher
	Issuer *TokenIssuer
	Audit  audit.Recorder
	Mailer mail.Mailer
	// Identities and Google are optional; without them Google sign-in reports NOT_IMPLEMENTED.
	Identities IdentityStore
	Google     GoogleVerifier
	// EmailCodes enables passwordless email sign-up with verification codes.
	EmailCodes EmailCodeStore
	// Tracker receives product analytics events; nil disables them.
	Tracker analytics.Tracker
}

type Options struct {
	RefreshTTL time.Duration
	ResetTTL   time.Duration
	// WebURL is the origin used to build links in emails.
	WebURL string
}

type Service struct {
	users      UserStore
	tokens     TokenRepository
	resets     ResetStore
	hasher     PasswordHasher
	issuer     *TokenIssuer
	audit      audit.Recorder
	mailer     mail.Mailer
	identities IdentityStore
	google     GoogleVerifier
	emailCodes EmailCodeStore
	tracker    analytics.Tracker
	refreshTTL time.Duration
	resetTTL   time.Duration
	webURL     string
	now        func() time.Time
	// dummyHash is verified when an email is unknown so that "no such user" and
	// "wrong password" take the same time and cannot be told apart.
	dummyHash string
}

func NewService(d Deps, o Options) (*Service, error) {
	dummy, err := d.Hasher.Hash("engora-timing-equalizer")
	if err != nil {
		return nil, err
	}
	if o.ResetTTL <= 0 {
		o.ResetTTL = time.Hour
	}
	return &Service{
		users: d.Users, tokens: d.Tokens, resets: d.Resets, hasher: d.Hasher, issuer: d.Issuer,
		audit: d.Audit, mailer: d.Mailer, identities: d.Identities, google: d.Google, emailCodes: d.EmailCodes,
		tracker:    trackerOrNop(d.Tracker),
		refreshTTL: o.RefreshTTL, resetTTL: o.ResetTTL,
		webURL: strings.TrimRight(o.WebURL, "/"), now: time.Now, dummyHash: dummy,
	}, nil
}

var errInvalidCredentials = apperr.Unauthorized("Invalid email or password")
var errInvalidSession = apperr.Unauthorized("Session is invalid or has expired")

func (s *Service) Register(ctx context.Context, in RegisterInput, client ClientInfo) (Session, error) {
	tz, ok := resolveTimezone(in.Timezone)
	if !ok {
		return Session{}, apperr.Validation(map[string]any{
			"fields": map[string]any{"timezone": "must be a valid IANA timezone"},
		})
	}

	hash, err := s.hasher.Hash(in.Password)
	if err != nil {
		return Session{}, err
	}
	user, err := s.users.CreateAccount(ctx, users.NewAccount{
		Email:        normalizeEmail(in.Email),
		PasswordHash: hash,
		DisplayName:  strings.TrimSpace(in.DisplayName),
		Timezone:     tz,
	})
	if errors.Is(err, users.ErrEmailTaken) {
		return Session{}, apperr.Conflict("An account with this email already exists")
	}
	if err != nil {
		return Session{}, fmt.Errorf("create account: %w", err)
	}

	s.audit.Record(ctx, audit.Entry{ActorID: &user.ID, Action: audit.ActionRegistered,
		EntityType: "user", EntityID: user.ID.String(), IP: client.IP, UserAgent: client.UserAgent,
		Metadata: map[string]any{"platform": client.Platform}})

	session, err := s.startSession(ctx, user, newFamilyID(), client)
	session.IsNewUser = err == nil
	return session, err
}

// resolveTimezone returns a valid IANA timezone (UTC when empty) and whether the input was valid.
func resolveTimezone(tz string) (string, bool) {
	tz = strings.TrimSpace(tz)
	if tz == "" {
		return "UTC", true
	}
	if _, err := time.LoadLocation(tz); err != nil {
		return "UTC", false
	}
	return tz, true
}

func newFamilyID() uuid.UUID { return uuid.New() }

func (s *Service) Login(ctx context.Context, in LoginInput, client ClientInfo) (Session, error) {
	creds, err := s.users.GetCredentialsByEmail(ctx, normalizeEmail(in.Email))
	if errors.Is(err, users.ErrNotFound) {
		_, _ = s.hasher.Verify(in.Password, s.dummyHash)
		return Session{}, errInvalidCredentials
	}
	if err != nil {
		return Session{}, fmt.Errorf("load credentials: %w", err)
	}

	ok := false
	if creds.PasswordHash != "" {
		ok, err = s.hasher.Verify(in.Password, creds.PasswordHash)
		if err != nil {
			return Session{}, fmt.Errorf("verify password: %w", err)
		}
	}
	if !ok {
		s.audit.Record(ctx, audit.Entry{ActorID: &creds.ID, Action: audit.ActionLoginFailed,
			EntityType: "user", EntityID: creds.ID.String(), IP: client.IP, UserAgent: client.UserAgent})
		return Session{}, errInvalidCredentials
	}
	if creds.Status != users.StatusActive {
		return Session{}, apperr.Forbidden("This account is not active")
	}

	if err := s.users.TouchLastLogin(ctx, creds.ID); err != nil {
		return Session{}, fmt.Errorf("touch last login: %w", err)
	}
	s.audit.Record(ctx, audit.Entry{ActorID: &creds.ID, Action: audit.ActionLoggedIn,
		EntityType: "user", EntityID: creds.ID.String(), IP: client.IP, UserAgent: client.UserAgent,
		Metadata: map[string]any{"platform": client.Platform}})

	return s.startSession(ctx, creds.User, uuid.New(), client)
}

// Refresh exchanges a refresh token for a new access token and a rotated refresh token.
func (s *Service) Refresh(ctx context.Context, rawToken string, client ClientInfo) (Session, error) {
	current, err := s.tokens.GetByHash(ctx, hashToken(rawToken))
	if errors.Is(err, ErrTokenNotFound) {
		return Session{}, errInvalidSession
	}
	if err != nil {
		return Session{}, fmt.Errorf("load refresh token: %w", err)
	}

	if current.RevokedAt != nil {
		// A rotated token was presented again: it may have been stolen. End the session.
		if err := s.tokens.RevokeFamily(ctx, current.FamilyID); err != nil {
			return Session{}, fmt.Errorf("revoke token family: %w", err)
		}
		s.audit.Record(ctx, audit.Entry{ActorID: &current.UserID, Action: audit.ActionTokenReuse,
			EntityType: "session", EntityID: current.FamilyID.String(), IP: client.IP, UserAgent: client.UserAgent})
		return Session{}, errInvalidSession
	}
	if !s.now().Before(current.ExpiresAt) {
		return Session{}, errInvalidSession
	}

	user, err := s.users.GetByID(ctx, current.UserID)
	if errors.Is(err, users.ErrNotFound) || (err == nil && user.Status != users.StatusActive) {
		_ = s.tokens.RevokeFamily(ctx, current.FamilyID)
		return Session{}, errInvalidSession
	}
	if err != nil {
		return Session{}, fmt.Errorf("load user: %w", err)
	}

	next, raw, err := s.newRefreshRecord(user.ID, current.FamilyID, client)
	if err != nil {
		return Session{}, err
	}
	rotated, err := s.tokens.Rotate(ctx, current.ID, next)
	if err != nil {
		return Session{}, fmt.Errorf("rotate refresh token: %w", err)
	}
	if !rotated {
		_ = s.tokens.RevokeFamily(ctx, current.FamilyID)
		return Session{}, errInvalidSession
	}
	return s.buildSession(user, current.FamilyID, raw, next.ExpiresAt)
}

// Logout revokes the session the refresh token belongs to. It is idempotent.
func (s *Service) Logout(ctx context.Context, rawToken string, client ClientInfo) error {
	current, err := s.tokens.GetByHash(ctx, hashToken(rawToken))
	if errors.Is(err, ErrTokenNotFound) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("load refresh token: %w", err)
	}
	if err := s.tokens.RevokeFamily(ctx, current.FamilyID); err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	s.audit.Record(ctx, audit.Entry{ActorID: &current.UserID, Action: audit.ActionLoggedOut,
		EntityType: "session", EntityID: current.FamilyID.String(), IP: client.IP, UserAgent: client.UserAgent})
	return nil
}

// ForgotPassword emails a single-use reset link. It succeeds whether or not the email
// belongs to an account, so the endpoint cannot be used to discover registered emails.
func (s *Service) ForgotPassword(ctx context.Context, in ForgotPasswordInput, client ClientInfo) error {
	creds, err := s.users.GetCredentialsByEmail(ctx, normalizeEmail(in.Email))
	if errors.Is(err, users.ErrNotFound) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("load account: %w", err)
	}
	if creds.Status != users.StatusActive {
		return nil
	}

	raw, hash, err := newOpaqueToken()
	if err != nil {
		return err
	}
	if err := s.resets.Create(ctx, PasswordReset{
		UserID: creds.ID, TokenHash: hash, ExpiresAt: s.now().Add(s.resetTTL), IP: client.IP,
	}); err != nil {
		return fmt.Errorf("store reset token: %w", err)
	}

	link := s.webURL + "/reset-password?token=" + url.QueryEscape(raw)
	delivery := "sent"
	if err := s.mailer.Send(ctx, mail.Message{
		To:      creds.Email,
		Subject: "Reset your Engora password",
		Text: fmt.Sprintf("We received a request to reset your Engora password.\n\n"+
			"Reset it here: %s\n\nThis link expires in %d minutes and can be used once. "+
			"If you didn't ask for this, you can ignore this email.", link, int(s.resetTTL.Minutes())),
	}); err != nil {
		// Not returned: an error only for existing accounts would reveal which emails exist.
		delivery = "failed"
	}
	s.audit.Record(ctx, audit.Entry{ActorID: &creds.ID, Action: audit.ActionResetRequested,
		EntityType: "user", EntityID: creds.ID.String(), IP: client.IP, UserAgent: client.UserAgent,
		Metadata: map[string]any{"delivery": delivery}})
	return nil
}

// ResetPassword sets a new password using a reset token and signs the user out everywhere.
func (s *Service) ResetPassword(ctx context.Context, in ResetPasswordInput, client ClientInfo) error {
	userID, err := s.resets.Consume(ctx, hashToken(in.Token), s.now())
	if errors.Is(err, ErrResetTokenInvalid) {
		return apperr.Validation(map[string]any{
			"fields": map[string]any{"token": "is invalid or has expired"},
		})
	}
	if err != nil {
		return fmt.Errorf("consume reset token: %w", err)
	}

	hash, err := s.hasher.Hash(in.Password)
	if err != nil {
		return err
	}
	if err := s.users.UpdatePassword(ctx, userID, hash); err != nil {
		return fmt.Errorf("update password: %w", err)
	}
	if err := s.tokens.RevokeAllForUser(ctx, userID); err != nil {
		return fmt.Errorf("revoke sessions: %w", err)
	}
	s.audit.Record(ctx, audit.Entry{ActorID: &userID, Action: audit.ActionPasswordReset,
		EntityType: "user", EntityID: userID.String(), IP: client.IP, UserAgent: client.UserAgent})
	return nil
}

func (s *Service) startSession(ctx context.Context, user users.User, familyID uuid.UUID, client ClientInfo) (Session, error) {
	record, raw, err := s.newRefreshRecord(user.ID, familyID, client)
	if err != nil {
		return Session{}, err
	}
	if err := s.tokens.Create(ctx, record); err != nil {
		return Session{}, fmt.Errorf("store refresh token: %w", err)
	}
	return s.buildSession(user, familyID, raw, record.ExpiresAt)
}

func (s *Service) newRefreshRecord(userID, familyID uuid.UUID, client ClientInfo) (RefreshToken, string, error) {
	raw, hash, err := newOpaqueToken()
	if err != nil {
		return RefreshToken{}, "", err
	}
	return RefreshToken{
		ID:        uuid.New(),
		UserID:    userID,
		FamilyID:  familyID,
		TokenHash: hash,
		Platform:  client.Platform,
		UserAgent: truncate(client.UserAgent, 512),
		IP:        client.IP,
		ExpiresAt: s.now().Add(s.refreshTTL),
	}, raw, nil
}

func (s *Service) buildSession(user users.User, familyID uuid.UUID, rawRefresh string, refreshExpires time.Time) (Session, error) {
	access, accessExpires, err := s.issuer.Issue(user.ID, user.Role, familyID)
	if err != nil {
		return Session{}, err
	}
	return Session{
		AccessToken:           access,
		AccessTokenExpiresAt:  accessExpires,
		RefreshToken:          rawRefresh,
		RefreshTokenExpiresAt: refreshExpires,
		TokenType:             "Bearer",
		User:                  user,
	}, nil
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
