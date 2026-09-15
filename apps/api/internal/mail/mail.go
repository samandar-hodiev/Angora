// Package mail abstracts outgoing email (password resets today; verification, receipts
// and learning reminders later). Business code depends on Mailer, never on a vendor.
package mail

import (
	"context"
	"log/slog"

	"github.com/samandar-hodiev/engora/apps/api/config"
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

// New selects a mailer from MAIL_PROVIDER: smtp (any SMTP service), resend, log
// (development: prints emails) or none. More providers implement Mailer.
func New(cfg config.MailConfig, log *slog.Logger) Mailer {
	switch cfg.Provider {
	case "smtp":
		return NewSMTP(SMTPConfig{Host: cfg.SMTPHost, Port: cfg.SMTPPort, Username: cfg.SMTPUsername, Password: cfg.SMTPPassword, From: cfg.From})
	case "resend":
		return NewResend(cfg.ResendAPIKey, cfg.From)
	case "log":
		return LogMailer{Log: log}
	default:
		return Nop{}
	}
}
