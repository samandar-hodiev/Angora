package notifications

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/mail"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
)

// Notification delivery against PostgreSQL. Run with:
//
//	TEST_DATABASE_URL=postgres://localhost:5432/engora_test?sslmode=disable go test -p 1 -run TestNotifications ./internal/notifications/

type recordingMailer struct {
	mu   sync.Mutex
	sent []mail.Message
}

func (m *recordingMailer) Send(_ context.Context, msg mail.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, msg)
	return nil
}

func (m *recordingMailer) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sent)
}

func (m *recordingMailer) last() mail.Message {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.sent) == 0 {
		return mail.Message{}
	}
	return m.sent[len(m.sent)-1]
}

func TestNotificationsDeliveryPostgres(t *testing.T) {
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

	repo := users.NewPostgresRepository(pool)
	newLearner := func(language string) uuid.UUID {
		t.Helper()
		u, err := repo.CreateAccount(ctx, users.NewAccount{
			Email:       fmt.Sprintf("notify-%s-%d@example.com", language, time.Now().UnixNano()),
			DisplayName: "Notified", Timezone: "UTC", EmailVerified: true,
		})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, u.ID) })
		if language != "" {
			if _, err := pool.Exec(ctx, `UPDATE profiles SET native_language = $2 WHERE user_id = $1`, u.ID, language); err != nil {
				t.Fatal(err)
			}
		}
		return u.ID
	}

	mailer := &recordingMailer{}
	svc := NewService(pool, mailer, slog.New(slog.DiscardHandler))

	inApp := func(userID uuid.UUID, code string) (string, string, bool) {
		t.Helper()
		var title, body string
		err := pool.QueryRow(ctx, `
			SELECT title, body FROM notifications
			WHERE user_id = $1 AND template_code = $2 AND channel = 'in_app'
			ORDER BY created_at DESC LIMIT 1`, userID, code).Scan(&title, &body)
		if err != nil {
			return "", "", false
		}
		return title, body, true
	}

	t.Run("a template is rendered in the learner's own language", func(t *testing.T) {
		learner := newLearner("uz")
		if err := svc.Notify(ctx, learner, CodeWelcome, map[string]any{"name": "Samandar"}); err != nil {
			t.Fatal(err)
		}
		title, _, ok := inApp(learner, CodeWelcome)
		if !ok {
			t.Fatal("no in-app notification was written")
		}
		if title != "Engora'ga xush kelibsiz, Samandar" {
			t.Errorf("title = %q, want the Uzbek template with the name filled in", title)
		}
	})

	t.Run("an unsupported language falls back to English rather than nothing", func(t *testing.T) {
		learner := newLearner("kk")
		if err := svc.Notify(ctx, learner, CodeWelcome, map[string]any{"name": "Aigerim"}); err != nil {
			t.Fatal(err)
		}
		title, _, ok := inApp(learner, CodeWelcome)
		if !ok {
			t.Fatal("no notification was written for a language with no template")
		}
		if title != "Welcome to Engora, Aigerim" {
			t.Errorf("title = %q, want the English fallback", title)
		}
	})

	t.Run("an email template both records and sends", func(t *testing.T) {
		learner := newLearner("en")
		before := mailer.count()
		if err := svc.Notify(ctx, learner, CodePaymentSucceeded, map[string]any{
			"plan": "Pro", "amount": "49 000", "currency": "UZS",
		}); err != nil {
			t.Fatal(err)
		}
		if mailer.count() != before+1 {
			t.Fatalf("emails sent = %d, want one more than %d", mailer.count(), before)
		}
		if got := mailer.last().Subject; got != "Payment received — Pro" {
			t.Errorf("subject = %q", got)
		}
		var sentAt *time.Time
		if err := pool.QueryRow(ctx, `
			SELECT sent_at FROM notifications
			WHERE user_id = $1 AND channel = 'email' ORDER BY created_at DESC LIMIT 1`, learner).Scan(&sentAt); err != nil {
			t.Fatal(err)
		}
		if sentAt == nil {
			t.Error("sent_at must be set once the mailer accepted the message")
		}
	})

	t.Run("a muted code is not delivered on any channel", func(t *testing.T) {
		learner := newLearner("en")
		if _, err := pool.Exec(ctx, `
			INSERT INTO notification_preferences (user_id, muted) VALUES ($1, ARRAY[$2])`,
			learner, CodePaymentSucceeded); err != nil {
			t.Fatal(err)
		}
		before := mailer.count()
		if err := svc.Notify(ctx, learner, CodePaymentSucceeded, map[string]any{"plan": "Pro"}); err != nil {
			t.Fatal(err)
		}
		if _, _, ok := inApp(learner, CodePaymentSucceeded); ok {
			t.Error("a muted template was still written in-app")
		}
		if mailer.count() != before {
			t.Error("a muted template was still emailed")
		}
	})

	t.Run("turning email off leaves the in-app message in place", func(t *testing.T) {
		learner := newLearner("en")
		if _, err := pool.Exec(ctx, `
			INSERT INTO notification_preferences (user_id, email) VALUES ($1, false)`, learner); err != nil {
			t.Fatal(err)
		}
		before := mailer.count()
		if err := svc.Notify(ctx, learner, CodePaymentSucceeded, map[string]any{"plan": "Pro", "amount": "1", "currency": "UZS"}); err != nil {
			t.Fatal(err)
		}
		if mailer.count() != before {
			t.Error("email was sent although the learner switched it off")
		}
		if _, _, ok := inApp(learner, CodePaymentSucceeded); !ok {
			t.Error("switching email off must not silence the in-app notification")
		}
	})

	t.Run("an inactive template is not delivered", func(t *testing.T) {
		learner := newLearner("en")
		if _, err := pool.Exec(ctx, `UPDATE notification_templates SET is_active = false WHERE code = $1`, CodeStreakReminder); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `UPDATE notification_templates SET is_active = true WHERE code = $1`, CodeStreakReminder)
		})
		if err := svc.Notify(ctx, learner, CodeStreakReminder, map[string]any{"days": 5}); err != nil {
			t.Fatal(err)
		}
		if _, _, ok := inApp(learner, CodeStreakReminder); ok {
			t.Error("an inactive template was still delivered")
		}
	})

	t.Run("the expiry sweep warns once and not again", func(t *testing.T) {
		learner := newLearner("en")
		if _, err := pool.Exec(ctx, `
			INSERT INTO subscriptions (user_id, plan_id, status, current_period_start, current_period_end)
			VALUES ($1, (SELECT id FROM subscription_plans WHERE code = 'pro'), 'active',
			        now() - interval '27 days', now() + interval '2 days')`, learner); err != nil {
			t.Fatal(err)
		}
		sched := NewScheduler(svc, slog.New(slog.DiscardHandler))

		if _, err := sched.SendExpiryWarnings(ctx); err != nil {
			t.Fatal(err)
		}
		var warnings int
		_ = pool.QueryRow(ctx, `
			SELECT count(*) FROM notifications WHERE user_id = $1 AND template_code = $2 AND channel = 'in_app'`,
			learner, CodeSubscriptionExpiring).Scan(&warnings)
		if warnings != 1 {
			t.Fatalf("warnings after the first sweep = %d, want 1", warnings)
		}

		// A second sweep an hour later must not warn the same learner again.
		if _, err := sched.SendExpiryWarnings(ctx); err != nil {
			t.Fatal(err)
		}
		_ = pool.QueryRow(ctx, `
			SELECT count(*) FROM notifications WHERE user_id = $1 AND template_code = $2 AND channel = 'in_app'`,
			learner, CodeSubscriptionExpiring).Scan(&warnings)
		if warnings != 1 {
			t.Errorf("warnings after the second sweep = %d, want 1 — the sweep must be idempotent", warnings)
		}
	})
}

func TestRenderLeavesUnknownPlaceholdersVisible(t *testing.T) {
	got := Render("Hello {{name}}, your {{plan}} plan", map[string]any{"name": "Ali"})
	want := "Hello Ali, your {{plan}} plan"
	if got != want {
		t.Errorf("Render() = %q, want %q", got, want)
	}
}

func TestMissingVariables(t *testing.T) {
	got := MissingVariables("{{name}} paid {{amount}} for {{plan}}", []string{"name", "plan"})
	if len(got) != 1 || got[0] != "amount" {
		t.Errorf("MissingVariables() = %v, want [amount]", got)
	}
	if extra := MissingVariables("no placeholders here", nil); len(extra) != 0 {
		t.Errorf("MissingVariables() = %v, want none", extra)
	}
}
