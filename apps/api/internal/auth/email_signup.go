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
	PurposeSignup = "signup"
	// Deleting your own account is confirmed the same way an account is created: with a code
	// to the mailbox. A live session proves somebody is at the keyboard, not that it is them.
	PurposeAccountDelete = "account_delete"

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

// StartEmailChallenge sends a code to an address for any purpose, and is deliberately quiet
// about repeats: asking twice within the cooldown returns the challenge already in flight
// rather than a second code, because a learner who went back a page has not done anything
// wrong. Callers own the question of whether the address is allowed to receive this code at
// all — sign-up refuses a registered address, deletion requires the opposite.
func (s *Service) StartEmailChallenge(ctx context.Context, email, purpose string, client ClientInfo) (EmailChallenge, error) {
	if s.emailCodes == nil {
		return EmailChallenge{}, apperr.NotImplemented("Email codes")
	}
	email = normalizeEmail(email)
	open, err := s.emailCodes.GetOpen(ctx, email, purpose)
	now := s.now()
	switch {
	case err == nil && now.Before(open.ResendAvailableAt) && now.Before(open.ExpiresAt):
		return challengeOf(open), nil
	case err == nil:
		return s.issueEmailCode(ctx, email, purpose, &open, client)
	case errors.Is(err, ErrEmailCodeNotFound):
		return s.issueEmailCode(ctx, email, purpose, nil, client)
	default:
		return EmailChallenge{}, err
	}
}

// ResendEmailChallenge is the explicit "send it again", and does enforce the cooldown and
// the hourly ceiling: this one was asked for on purpose.
func (s *Service) ResendEmailChallenge(ctx context.Context, email, purpose string, client ClientInfo) (EmailChallenge, error) {
	if s.emailCodes == nil {
		return EmailChallenge{}, apperr.NotImplemented("Email codes")
	}
	email = normalizeEmail(email)
	open, err := s.emailCodes.GetOpen(ctx, email, purpose)
	if errors.Is(err, ErrEmailCodeNotFound) {
		return s.issueEmailCode(ctx, email, purpose, nil, client)
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
	return s.issueEmailCode(ctx, email, purpose, &open, client)
}

// ConsumeEmailCode checks a code and marks it used. Single use: a code that has already been
// spent fails the same way a wrong one does, so a replayed request never succeeds twice.
func (s *Service) ConsumeEmailCode(ctx context.Context, email, purpose, code string) error {
	if s.emailCodes == nil {
		return apperr.NotImplemented("Email codes")
	}
	email = normalizeEmail(email)
	open, err := s.emailCodes.GetOpen(ctx, email, purpose)
	if errors.Is(err, ErrEmailCodeNotFound) {
		return codeError("code_invalid", "This code is invalid. Request a new code.", nil)
	}
	if err != nil {
		return err
	}
	if s.now().After(open.ExpiresAt) {
		return codeError("code_expired", "This code has expired. Request a new code.", nil)
	}
	if open.Attempts >= emailMaxAttempts {
		return apperr.New(apperr.CodeRateLimited, "Too many incorrect attempts. Request a new code.").
			WithDetails(map[string]any{"reason": "attempts_exceeded"})
	}
	if !hmac.Equal([]byte(hashEmailCode(purpose, email, strings.TrimSpace(code))), []byte(open.CodeHash)) {
		attempts, err := s.emailCodes.IncrementAttempts(ctx, open.ID)
		if err != nil {
			return err
		}
		remaining := max(emailMaxAttempts-attempts, 0)
		return codeError("code_invalid", "This code is incorrect.", map[string]any{"attempts_remaining": remaining})
	}
	consumed, err := s.emailCodes.Consume(ctx, open.ID)
	if err != nil {
		return err
	}
	if !consumed {
		return codeError("code_invalid", "This code has already been used.", nil)
	}
	return nil
}

func (s *Service) StartEmailSignup(ctx context.Context, in EmailStartInput, client ClientInfo) (EmailChallenge, error) {
	email := normalizeEmail(in.Email)
	if err := s.ensureEmailAvailable(ctx, email); err != nil {
		return EmailChallenge{}, err
	}
	return s.StartEmailChallenge(ctx, email, PurposeSignup, client)
}

func (s *Service) ResendEmailSignup(ctx context.Context, in EmailStartInput, client ClientInfo) (EmailChallenge, error) {
	email := normalizeEmail(in.Email)
	if err := s.ensureEmailAvailable(ctx, email); err != nil {
		return EmailChallenge{}, err
	}
	return s.ResendEmailChallenge(ctx, email, PurposeSignup, client)
}

// emailCodeMessage is what lands in the inbox. The code leads the subject line because most
// people read it from the notification without opening the mail at all.
func emailCodeMessage(purpose, email, code string) mail.Message {
	minutes := int(emailCodeTTL.Minutes())
	if purpose == PurposeAccountDelete {
		return mail.Message{
			To:      email,
			Subject: fmt.Sprintf("%s is your Engora account deletion code", code),
			Text: fmt.Sprintf("Your Engora account deletion code is %s.\n\nIt expires in %d minutes. "+
				"Entering it permanently deletes your account, your learning history and any subscription you have.\n\n"+
				"If you did not ask to delete your Engora account, ignore this email and change your password — "+
				"somebody else may be able to use your session.", code, minutes),
		}
	}
	return mail.Message{
		To:      email,
		Subject: fmt.Sprintf("%s is your Engora verification code", code),
		Text: fmt.Sprintf("Your Engora verification code is %s.\n\nIt expires in %d minutes. "+
			"If you didn't try to create an Engora account, you can ignore this email.", code, minutes),
	}
}

func (s *Service) issueEmailCode(ctx context.Context, email, purpose string, previous *EmailCode, client ClientInfo) (EmailChallenge, error) {
	code, err := newEmailCode()
	if err != nil {
		return EmailChallenge{}, err
	}
	now := s.now()
	c := EmailCode{
		Email: email, Purpose: purpose, CodeHash: hashEmailCode(purpose, email, code),
		SendCount: 1, CreatedAt: now, ExpiresAt: now.Add(emailCodeTTL), ResendAvailableAt: now.Add(emailResendCooldown), IP: client.IP,
	}
	if previous != nil && now.Sub(previous.CreatedAt) < time.Hour {
		c.SendCount, c.CreatedAt = previous.SendCount+1, previous.CreatedAt
	}
	if err := s.emailCodes.Save(ctx, c); err != nil {
		return EmailChallenge{}, fmt.Errorf("store email code: %w", err)
	}
	if err := s.mailer.Send(ctx, emailCodeMessage(purpose, email, code)); err != nil {
		// The cause (bad credentials, network) is for operators; users get a generic message.
		return EmailChallenge{}, apperr.Wrap(err, apperr.CodeUnavailable, "We couldn't send the email. Please try again.")
	}
	if purpose == PurposeSignup {
		s.tracker.Track(ctx, analytics.Event{Name: analytics.EventEmailVerificationSent, Source: "server", Platform: client.Platform,
			Properties: map[string]any{"send_count": c.SendCount}})
	}
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
	email := normalizeEmail(in.Email)
	if err := s.ConsumeEmailCode(ctx, email, PurposeSignup, in.Code); err != nil {
		return Session{}, err
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
	s.welcome(ctx, user)

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
