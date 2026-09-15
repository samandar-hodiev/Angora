// Package mail abstracts outgoing email (password resets today; verification, receipts
// and learning reminders later). Business code depends on Mailer, never on a vendor.
package mail

import (
	"context"
	"log/slog"

	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

type Message struct {
	To      string
	Subject string
	Text    string
}

type Mailer interface {
	Send(ctx context.Context, msg Message) error
}

// LogMailer writes messages to the log instead of sending them. Development only: the
// message body can contain secrets such as reset links.
type LogMailer struct {
	Log *slog.Logger
}

func (m LogMailer) Send(ctx context.Context, msg Message) error {
	logger.FromContext(ctx, m.Log).Info("email (not sent: MAIL_PROVIDER=log)",
		slog.String("to", msg.To), slog.String("subject", msg.Subject), slog.String("body", msg.Text))
	return nil
}

// Nop drops messages. Used in tests and when email is disabled.
type Nop struct{}

func (Nop) Send(context.Context, Message) error { return nil }

// New selects a mailer from MAIL_PROVIDER. A real provider (SES, Postmark, Resend, ...)
// is added here by implementing Mailer.
func New(provider string, log *slog.Logger) Mailer {
	switch provider {
	case "log":
		return LogMailer{Log: log}
	default:
		return Nop{}
	}
}
