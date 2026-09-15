package auth

import (
	"context"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/mail"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
)

type fakeEmailCodes struct {
	mu    sync.Mutex
	codes map[string]*EmailCode // email → open code
}

func (f *fakeEmailCodes) GetOpen(_ context.Context, email, _ string) (EmailCode, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.codes[email]
	if !ok {
		return EmailCode{}, ErrEmailCodeNotFound
	}
	return *c, nil
}

func (f *fakeEmailCodes) Save(_ context.Context, c EmailCode) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	c.ID = uuid.New()
	f.codes[c.Email] = &c
	return nil
}

func (f *fakeEmailCodes) IncrementAttempts(_ context.Context, id uuid.UUID) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range f.codes {
		if c.ID == id {
			c.Attempts++
			return c.Attempts, nil
		}
	}
	return 0, ErrEmailCodeNotFound
}

func (f *fakeEmailCodes) Consume(_ context.Context, id uuid.UUID) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for email, c := range f.codes {
		if c.ID == id {
			delete(f.codes, email)
			return true, nil
		}
	}
	return false, nil
}

type codeMailer struct {
	mu   sync.Mutex
	sent []mail.Message
}

func (m *codeMailer) Send(_ context.Context, msg mail.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, msg)
	return nil
}

var sixDigits = regexp.MustCompile(`\b\d{6}\b`)

func (m *codeMailer) lastCode(t *testing.T) string {
	t.Helper()
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.sent) == 0 {
		t.Fatal("no email sent")
	}
	code := sixDigits.FindString(m.sent[len(m.sent)-1].Text)
	if code == "" {
		t.Fatal("no code in email")
	}
	return code
}

type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

func newEmailSignupService(t *testing.T) (*Service, *codeMailer, *clock, *fakeUsers, *analytics.Memory) {
	t.Helper()
	mailer, us, tracker := &codeMailer{}, newFakeUsers(), &analytics.Memory{}
	svc, err := NewService(Deps{
		Users: us, Tokens: newFakeTokens(), Resets: &fakeResets{byHash: map[string]*PasswordReset{}, used: map[string]bool{}},
		Hasher: fastHasher, Issuer: NewTokenIssuer(testSecret, "engora", 15*time.Minute), Audit: audit.Nop{},
		Mailer: mailer, EmailCodes: &fakeEmailCodes{codes: map[string]*EmailCode{}}, Tracker: tracker,
	}, Options{RefreshTTL: 24 * time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	c := &clock{t: time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)}
	svc.now = c.now
	return svc, mailer, c, us, tracker
}

func reason(err error) string {
	e := apperr.From(err)
	if e == nil || e.Details == nil {
		return ""
	}
	r, _ := e.Details["reason"].(string)
	return r
}

func TestEmailSignupCreatesVerifiedPasswordlessAccount(t *testing.T) {
	svc, mailer, _, us, tracker := newEmailSignupService(t)
	ctx := context.Background()

	ch, err := svc.StartEmailSignup(ctx, EmailStartInput{Email: " New.Learner@Example.com "}, client)
	if err != nil {
		t.Fatal(err)
	}
	if ch.Email != "new.learner@example.com" || ch.CodeLength != 6 || !ch.ResendAvailableAt.Before(ch.ExpiresAt) {
		t.Errorf("challenge = %+v", ch)
	}
	code := mailer.lastCode(t)

	session, err := svc.VerifyEmailSignup(ctx, EmailVerifyInput{Email: "new.learner@example.com", Code: code, Timezone: "Asia/Tashkent"}, client)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !session.IsNewUser || session.AccessToken == "" || session.User.EmailVerifiedAt == nil {
		t.Errorf("session = %+v", session)
	}
	if has, _ := us.HasPassword(ctx, session.User.ID); has {
		t.Error("account must be created without a password")
	}
	if _, err := svc.VerifyEmailSignup(ctx, EmailVerifyInput{Email: "new.learner@example.com", Code: code}, client); reason(err) != "code_invalid" {
		t.Errorf("a code is single-use, got %v", err)
	}
	if _, err := svc.StartEmailSignup(ctx, EmailStartInput{Email: "new.learner@example.com"}, client); reason(err) != "email_registered" {
		t.Errorf("existing email must be reported, got %v", err)
	}
	names := tracker.Names()
	if len(names) < 3 || names[0] != analytics.EventEmailVerificationSent {
		t.Errorf("events = %v", names)
	}
}

func TestEmailSignupRejectsWrongExpiredAndBruteForcedCodes(t *testing.T) {
	svc, mailer, c, _, _ := newEmailSignupService(t)
	ctx := context.Background()
	email := "learner@example.com"
	if _, err := svc.StartEmailSignup(ctx, EmailStartInput{Email: email}, client); err != nil {
		t.Fatal(err)
	}
	right := mailer.lastCode(t)
	wrong := "000000"
	if right == wrong {
		wrong = "111111"
	}

	_, err := svc.VerifyEmailSignup(ctx, EmailVerifyInput{Email: email, Code: wrong}, client)
	if reason(err) != "code_invalid" || apperr.From(err).Details["attempts_remaining"] != 4 {
		t.Errorf("wrong code: %v", err)
	}
	for i := 0; i < 4; i++ {
		_, _ = svc.VerifyEmailSignup(ctx, EmailVerifyInput{Email: email, Code: wrong}, client)
	}
	if _, err := svc.VerifyEmailSignup(ctx, EmailVerifyInput{Email: email, Code: right}, client); reason(err) != "attempts_exceeded" {
		t.Errorf("after 5 wrong attempts even the right code is refused, got %v", err)
	}

	c.t = c.t.Add(time.Minute)
	if _, err := svc.ResendEmailSignup(ctx, EmailStartInput{Email: email}, client); err != nil {
		t.Fatalf("resend: %v", err)
	}
	fresh := mailer.lastCode(t)
	c.t = c.t.Add(11 * time.Minute)
	if _, err := svc.VerifyEmailSignup(ctx, EmailVerifyInput{Email: email, Code: fresh}, client); reason(err) != "code_expired" {
		t.Errorf("expired code: %v", err)
	}
}

func TestEmailResendCooldownAndHourlyLimit(t *testing.T) {
	svc, mailer, c, _, _ := newEmailSignupService(t)
	ctx := context.Background()
	in := EmailStartInput{Email: "learner@example.com"}
	if _, err := svc.StartEmailSignup(ctx, in, client); err != nil {
		t.Fatal(err)
	}
	// Continuing again during the cooldown does not send a second email.
	if _, err := svc.StartEmailSignup(ctx, in, client); err != nil || len(mailer.sent) != 1 {
		t.Fatalf("start again: %v, sent %d", err, len(mailer.sent))
	}
	_, err := svc.ResendEmailSignup(ctx, in, client)
	if reason(err) != "resend_cooldown" || apperr.From(err).Details["retry_after_seconds"] != 45 {
		t.Errorf("cooldown: %v", err)
	}
	for i := 0; i < 4; i++ {
		c.t = c.t.Add(46 * time.Second)
		if _, err := svc.ResendEmailSignup(ctx, in, client); err != nil {
			t.Fatalf("resend %d: %v", i, err)
		}
	}
	c.t = c.t.Add(46 * time.Second)
	if _, err := svc.ResendEmailSignup(ctx, in, client); reason(err) != "resend_limit" {
		t.Errorf("sixth code within an hour should be refused, got %v", err)
	}
	c.t = c.t.Add(time.Hour)
	if _, err := svc.ResendEmailSignup(ctx, in, client); err != nil {
		t.Errorf("the limit resets after an hour: %v", err)
	}
}

func TestSetPassword(t *testing.T) {
	svc, mailer, _, _, _ := newEmailSignupService(t)
	ctx := context.Background()
	_, _ = svc.StartEmailSignup(ctx, EmailStartInput{Email: "learner@example.com"}, client)
	session, err := svc.VerifyEmailSignup(ctx, EmailVerifyInput{Email: "learner@example.com", Code: mailer.lastCode(t)}, client)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.SetPassword(ctx, session.User.ID, SetPasswordInput{Password: "onlyletters"}, client); reason(err) != "weak_password" {
		t.Errorf("weak password: %v", err)
	}
	if err := svc.SetPassword(ctx, session.User.ID, SetPasswordInput{Password: "correct-horse-9"}, client); err != nil {
		t.Fatalf("set password: %v", err)
	}
	if _, err := svc.Login(ctx, LoginInput{Email: "learner@example.com", Password: "correct-horse-9"}, client); err != nil {
		t.Errorf("login with the new password: %v", err)
	}
	if err := svc.SetPassword(ctx, session.User.ID, SetPasswordInput{Password: "another-pass-1"}, client); reason(err) != "password_exists" {
		t.Errorf("second set: %v", err)
	}
}
