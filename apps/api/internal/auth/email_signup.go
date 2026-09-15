package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"math/big"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/mail"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
)

// Email sign-up with verification codes
//
//	POST /auth/email/start   {email}         → code emailed; returns expiry and resend time
//	POST /auth/email/resend  {email}         → new code after the cooldown, within limits
//	POST /auth/email/verify  {email, code}   → account created (email verified) + session
//
// No password is required to create an account. A password can be added later
// (POST /auth/password/set) and the same codes can later power passwordless sign-in.
// Codes are 6 digits, stored only as a hash bound to the email, expire after 10 minutes and
// allow 5 wrong attempts; a new code can be requested every 45 seconds, 5 times per hour.

const (
	PurposeSignup        = "signup"
	emailCodeLength      = 6
	emailCodeTTL         = 10 * time.Minute
	emailResendCooldown  = 45 * time.Second
	emailMaxSendsPerHour = 5
	emailMaxAttempts     = 5
)

var ErrEmailCodeNotFound = errors.New("email code not found")

type EmailCode struct {
	ID                uuid.UUID
	Email             string
	Purpose           string
	CodeHash          string
	Attempts          int
	SendCount         int
	ExpiresAt         time.Time
	ResendAvailableAt time.Time
	CreatedAt         time.Time
	IP                string
}

type EmailCodeStore interface {
	// GetOpen returns the unconsumed code for an email and purpose.
	GetOpen(ctx context.Context, email, purpose string) (EmailCode, error)
	// Save stores a newly issued code, replacing any open code for the same email.
	Save(ctx context.Context, c EmailCode) error
	IncrementAttempts(ctx context.Context, id uuid.UUID) (int, error)
	// Consume marks the code used; false if it was already consumed (single use).
	Consume(ctx context.Context, id uuid.UUID) (bool, error)
}

type EmailStartInput struct {
	Email string `json:"email" binding:"required,email,max=254"`
}

type EmailVerifyInput struct {
	Email    string `json:"email" binding:"required,email,max=254"`
	Code     string `json:"code" binding:"required,len=6,numeric"`
	Timezone string `json:"timezone" binding:"omitempty,max=64"`
}

type SetPasswordInput struct {
	Password string `json:"password" binding:"required,min=8,max=128"`
}

// EmailChallenge tells the client what was sent and when it may ask again.
type EmailChallenge struct {
	Email             string    `json:"email"`
	CodeLength        int       `json:"code_length"`
	ExpiresAt         time.Time `json:"expires_at"`
	ResendAvailableAt time.Time `json:"resend_available_at"`
	// DevCode is only set in development when no mail provider is configured.
	DevCode string `json:"dev_code,omitempty"`
}

func trackerOrNop(t analytics.Tracker) analytics.Tracker {
	if t == nil {
		return analytics.Nop{}
	}
	return t
}

func challengeOf(c EmailCode) EmailChallenge {
	return EmailChallenge{Email: c.Email, CodeLength: emailCodeLength, ExpiresAt: c.ExpiresAt, ResendAvailableAt: c.ResendAvailableAt}
}

func hashEmailCode(purpose, email, code string) string {
	sum := sha256.Sum256([]byte(purpose + ":" + email + ":" + code))
	return hex.EncodeToString(sum[:])
}

func newEmailCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

var errEmailRegistered = apperr.Conflict("This email is already registered.").WithDetails(map[string]any{"reason": "email_registered"})

// ensureEmailAvailable refuses to start a sign-up for an email that already has an account.
// Sign-up intentionally says so (the learner needs to log in instead); password reset, by
// contrast, never reveals whether an account exists.
func (s *Service) ensureEmailAvailable(ctx context.Context, email string) error {
	_, err := s.users.GetCredentialsByEmail(ctx, email)
	switch {
	case err == nil:
		return errEmailRegistered
	case errors.Is(err, users.ErrNotFound):
		return nil
	default:
		return fmt.Errorf("check email: %w", err)
	}
}

func (s *Service) StartEmailSignup(ctx context.Context, in EmailStartInput, client ClientInfo) (EmailChallenge, error) {
	if s.emailCodes == nil {
		return EmailChallenge{}, apperr.NotImplemented("Email sign-up")
	}
	email := normalizeEmail(in.Email)
	if err := s.ensureEmailAvailable(ctx, email); err != nil {
		return EmailChallenge{}, err
	}
	open, err := s.emailCodes.GetOpen(ctx, email, PurposeSignup)
	now := s.now()
	switch {
	case err == nil && now.Before(open.ResendAvailableAt) && now.Before(open.ExpiresAt):
		// A code was just sent (e.g. the learner went back and continued again): don't send another.
		return challengeOf(open), nil
	case err == nil:
		return s.issueEmailCode(ctx, email, &open, client)
	case errors.Is(err, ErrEmailCodeNotFound):
		return s.issueEmailCode(ctx, email, nil, client)
	default:
		return EmailChallenge{}, err
	}
}

func (s *Service) ResendEmailSignup(ctx context.Context, in EmailStartInput, client ClientInfo) (EmailChallenge, error) {
	if s.emailCodes == nil {
		return EmailChallenge{}, apperr.NotImplemented("Email sign-up")
	}
	email := normalizeEmail(in.Email)
	if err := s.ensureEmailAvailable(ctx, email); err != nil {
		return EmailChallenge{}, err
	}
	open, err := s.emailCodes.GetOpen(ctx, email, PurposeSignup)
	if errors.Is(err, ErrEmailCodeNotFound) {
		return s.issueEmailCode(ctx, email, nil, client)
	}
	if err != nil {
		return EmailChallenge{}, err
	}
	now := s.now()
	if now.Before(open.ResendAvailableAt) {
		wait := int(math.Ceil(open.ResendAvailableAt.Sub(now).Seconds()))
		return EmailChallenge{}, apperr.New(apperr.CodeRateLimited, "Please wait before requesting another code.").
			WithDetails(map[string]any{"reason": "resend_cooldown", "retry_after_seconds": wait})
	}
	if open.SendCount >= emailMaxSendsPerHour && now.Sub(open.CreatedAt) < time.Hour {
		wait := int(math.Ceil(open.CreatedAt.Add(time.Hour).Sub(now).Seconds()))
		return EmailChallenge{}, apperr.New(apperr.CodeRateLimited, "You've requested too many codes. Please try again later.").
			WithDetails(map[string]any{"reason": "resend_limit", "retry_after_seconds": wait})
	}
	return s.issueEmailCode(ctx, email, &open, client)
}

func (s *Service) issueEmailCode(ctx context.Context, email string, previous *EmailCode, client ClientInfo) (EmailChallenge, error) {
	code, err := newEmailCode()
	if err != nil {
		return EmailChallenge{}, err
	}
	now := s.now()
	c := EmailCode{
		Email: email, Purpose: PurposeSignup, CodeHash: hashEmailCode(PurposeSignup, email, code),
		SendCount: 1, CreatedAt: now, ExpiresAt: now.Add(emailCodeTTL), ResendAvailableAt: now.Add(emailResendCooldown), IP: client.IP,
	}
	if previous != nil && now.Sub(previous.CreatedAt) < time.Hour {
		c.SendCount, c.CreatedAt = previous.SendCount+1, previous.CreatedAt
	}
	if err := s.emailCodes.Save(ctx, c); err != nil {
		return EmailChallenge{}, fmt.Errorf("store email code: %w", err)
	}
	if err := s.mailer.Send(ctx, mail.Message{
		To:      email,
		Subject: fmt.Sprintf("%s is your Engora verification code", code),
		Text: fmt.Sprintf("Your Engora verification code is %s.\n\nIt expires in %d minutes. "+
			"If you didn't try to create an Engora account, you can ignore this email.", code, int(emailCodeTTL.Minutes())),
	}); err != nil {
		return EmailChallenge{}, apperr.New(apperr.CodeUnavailable, "We couldn't send the email. Please try again.")
	}
	s.tracker.Track(ctx, analytics.Event{Name: analytics.EventEmailVerificationSent, Source: "server", Platform: client.Platform,
		Properties: map[string]any{"send_count": c.SendCount}})
	challenge := challengeOf(c)
	if s.devCodes {
		challenge.DevCode = code
	}
	return challenge, nil
}

func codeError(reason, message string, extra map[string]any) *apperr.Error {
	details := map[string]any{"reason": reason, "fields": map[string]any{"code": message}}
	for k, v := range extra {
		details[k] = v
	}
	return apperr.Validation(details)
}

// VerifyEmailSignup checks the code on the server and creates the account.
func (s *Service) VerifyEmailSignup(ctx context.Context, in EmailVerifyInput, client ClientInfo) (Session, error) {
	if s.emailCodes == nil {
		return Session{}, apperr.NotImplemented("Email sign-up")
	}
	email := normalizeEmail(in.Email)
	open, err := s.emailCodes.GetOpen(ctx, email, PurposeSignup)
	if errors.Is(err, ErrEmailCodeNotFound) {
		return Session{}, codeError("code_invalid", "This code is invalid. Request a new code.", nil)
	}
	if err != nil {
		return Session{}, err
	}
	if s.now().After(open.ExpiresAt) {
		return Session{}, codeError("code_expired", "This code has expired. Request a new code.", nil)
	}
	if open.Attempts >= emailMaxAttempts {
		return Session{}, apperr.New(apperr.CodeRateLimited, "Too many incorrect attempts. Request a new code.").
			WithDetails(map[string]any{"reason": "attempts_exceeded"})
	}
	if !hmac.Equal([]byte(hashEmailCode(PurposeSignup, email, strings.TrimSpace(in.Code))), []byte(open.CodeHash)) {
		attempts, err := s.emailCodes.IncrementAttempts(ctx, open.ID)
		if err != nil {
			return Session{}, err
		}
		remaining := max(emailMaxAttempts-attempts, 0)
		return Session{}, codeError("code_invalid", "This code is incorrect.", map[string]any{"attempts_remaining": remaining})
	}
	consumed, err := s.emailCodes.Consume(ctx, open.ID)
	if err != nil {
		return Session{}, err
	}
	if !consumed {
		return Session{}, codeError("code_invalid", "This code has already been used.", nil)
	}

	tz, _ := resolveTimezone(in.Timezone)
	user, err := s.users.CreateAccount(ctx, users.NewAccount{Email: email, Timezone: tz, EmailVerified: true, AuthProvider: "email"})
	if errors.Is(err, users.ErrEmailTaken) {
		return Session{}, errEmailRegistered
	}
	if err != nil {
		return Session{}, fmt.Errorf("create account: %w", err)
	}
	s.audit.Record(ctx, audit.Entry{ActorID: &user.ID, Action: audit.ActionRegistered,
		EntityType: "user", EntityID: user.ID.String(), IP: client.IP, UserAgent: client.UserAgent,
		Metadata: map[string]any{"platform": client.Platform, "provider": "email_code"}})
	s.tracker.Track(ctx, analytics.Event{Name: analytics.EventEmailVerificationCompleted, UserID: &user.ID, Source: "server", Platform: client.Platform})
	s.tracker.Track(ctx, analytics.Event{Name: analytics.EventSignupCompleted, UserID: &user.ID, Source: "server", Platform: client.Platform,
		Properties: map[string]any{"method": "email"}})

	session, err := s.startSession(ctx, user, newFamilyID(), client)
	if err != nil {
		return Session{}, err
	}
	session.IsNewUser = true
	return session, nil
}

// SetPassword adds a password to an account created without one (email code or Google).
// Changing an existing password goes through the reset flow.
func (s *Service) SetPassword(ctx context.Context, userID uuid.UUID, in SetPasswordInput, client ClientInfo) error {
	if err := validatePasswordStrength(in.Password); err != nil {
		return err
	}
	has, err := s.users.HasPassword(ctx, userID)
	if errors.Is(err, users.ErrNotFound) {
		return apperr.Unauthorized("This account no longer exists")
	}
	if err != nil {
		return err
	}
	if has {
		return apperr.Conflict("A password is already set for this account").WithDetails(map[string]any{"reason": "password_exists"})
	}
	hash, err := s.hasher.Hash(in.Password)
	if err != nil {
		return err
	}
	if err := s.users.UpdatePassword(ctx, userID, hash); err != nil {
		return fmt.Errorf("set password: %w", err)
	}
	s.audit.Record(ctx, audit.Entry{ActorID: &userID, Action: audit.ActionPasswordReset, EntityType: "user",
		EntityID: userID.String(), IP: client.IP, UserAgent: client.UserAgent, Metadata: map[string]any{"kind": "set"}})
	return nil
}

type PasswordStatus struct {
	HasPassword  bool   `json:"has_password"`
	AuthProvider string `json:"auth_provider"`
}

// PasswordStatus tells clients whether to ask for a password during account setup: accounts
// created with an email code have none and need one to sign in with email again.
func (s *Service) PasswordStatus(ctx context.Context, userID uuid.UUID) (PasswordStatus, error) {
	provider, has, err := s.users.AuthStatus(ctx, userID)
	if errors.Is(err, users.ErrNotFound) {
		return PasswordStatus{}, apperr.Unauthorized("This account no longer exists")
	}
	return PasswordStatus{HasPassword: has, AuthProvider: provider}, err
}

// validatePasswordStrength requires at least 8 characters with a letter and a number.
func validatePasswordStrength(password string) error {
	var letter, digit bool
	for _, r := range password {
		letter = letter || unicode.IsLetter(r)
		digit = digit || unicode.IsDigit(r)
	}
	if len([]rune(password)) < 8 || !letter || !digit {
		return apperr.Validation(map[string]any{"reason": "weak_password",
			"fields": map[string]any{"password": "must be at least 8 characters and include a letter and a number"}})
	}
	return nil
}

// ---- storage ------------------------------------------------------------------------------

type PostgresEmailCodeStore struct {
	pool *pgxpool.Pool
}

func NewPostgresEmailCodeStore(pool *pgxpool.Pool) *PostgresEmailCodeStore {
	return &PostgresEmailCodeStore{pool: pool}
}

func (s *PostgresEmailCodeStore) GetOpen(ctx context.Context, email, purpose string) (EmailCode, error) {
	var c EmailCode
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, purpose, code_hash, attempts, send_count, expires_at, resend_available_at, created_at, ip
		FROM email_verification_codes
		WHERE lower(email) = lower($1) AND purpose = $2 AND consumed_at IS NULL`, email, purpose,
	).Scan(&c.ID, &c.Email, &c.Purpose, &c.CodeHash, &c.Attempts, &c.SendCount, &c.ExpiresAt, &c.ResendAvailableAt, &c.CreatedAt, &c.IP)
	if database.IsNotFound(err) {
		return c, ErrEmailCodeNotFound
	}
	return c, err
}

func (s *PostgresEmailCodeStore) Save(ctx context.Context, c EmailCode) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO email_verification_codes (email, purpose, code_hash, attempts, send_count, expires_at, resend_available_at, created_at, ip)
		VALUES ($1, $2, $3, 0, $4, $5, $6, $7, $8)
		ON CONFLICT (lower(email), purpose) WHERE consumed_at IS NULL DO UPDATE SET
		    code_hash = EXCLUDED.code_hash, attempts = 0, send_count = EXCLUDED.send_count, expires_at = EXCLUDED.expires_at,
		    resend_available_at = EXCLUDED.resend_available_at, created_at = EXCLUDED.created_at, ip = EXCLUDED.ip`,
		c.Email, c.Purpose, c.CodeHash, c.SendCount, c.ExpiresAt, c.ResendAvailableAt, c.CreatedAt, c.IP)
	return err
}

func (s *PostgresEmailCodeStore) IncrementAttempts(ctx context.Context, id uuid.UUID) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`, id).Scan(&n)
	return n, err
}

func (s *PostgresEmailCodeStore) Consume(ctx context.Context, id uuid.UUID) (bool, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE email_verification_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`, id)
	return tag.RowsAffected() == 1, err
}
