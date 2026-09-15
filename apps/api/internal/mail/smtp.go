package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"mime/quotedprintable"
	"net"
	netmail "net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

// SMTPConfig works with any SMTP provider: Gmail/Google Workspace (smtp.gmail.com:587 with an
// App Password), Mailgun, SendGrid, Amazon SES SMTP, Postmark, Brevo, Mailtrap, ...
type SMTPConfig struct {
	Host     string
	Port     int // 587 (STARTTLS) or 465 (implicit TLS)
	Username string
	Password string
	From     string // "Engora <no-reply@example.com>"
}

type SMTPMailer struct {
	cfg SMTPConfig
}

func NewSMTP(cfg SMTPConfig) *SMTPMailer { return &SMTPMailer{cfg: cfg} }

var errHeaderInjection = errors.New("mail: header values must not contain line breaks")

func (m *SMTPMailer) Send(ctx context.Context, msg Message) error {
	from, err := netmail.ParseAddress(m.cfg.From)
	if err != nil {
		return fmt.Errorf("mail: invalid MAIL_FROM: %w", err)
	}
	to, err := netmail.ParseAddress(msg.To)
	if err != nil {
		return fmt.Errorf("mail: invalid recipient: %w", err)
	}
	raw, err := buildMessage(from, to, msg, time.Now())
	if err != nil {
		return err
	}

	addr := net.JoinHostPort(m.cfg.Host, strconv.Itoa(m.cfg.Port))
	tlsConfig := &tls.Config{ServerName: m.cfg.Host, MinVersion: tls.VersionTLS12}
	dialer := &net.Dialer{Timeout: 10 * time.Second}

	var conn net.Conn
	if m.cfg.Port == 465 {
		conn, err = tls.DialWithDialer(dialer, "tcp", addr, tlsConfig)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return fmt.Errorf("mail: connect to SMTP server: %w", err)
	}
	deadline := time.Now().Add(30 * time.Second)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	_ = conn.SetDeadline(deadline)

	client, err := smtp.NewClient(conn, m.cfg.Host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("mail: SMTP handshake: %w", err)
	}
	defer client.Close()

	if m.cfg.Port != 465 {
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err := client.StartTLS(tlsConfig); err != nil {
				return fmt.Errorf("mail: STARTTLS: %w", err)
			}
		} else if m.cfg.Username != "" {
			return errors.New("mail: SMTP server does not offer STARTTLS; refusing to send credentials unencrypted")
		}
	}
	if m.cfg.Username != "" {
		if err := client.Auth(smtp.PlainAuth("", m.cfg.Username, m.cfg.Password, m.cfg.Host)); err != nil {
			return fmt.Errorf("mail: SMTP authentication failed (check SMTP_USERNAME/SMTP_PASSWORD): %w", err)
		}
	}
	if err := client.Mail(from.Address); err != nil {
		return fmt.Errorf("mail: MAIL FROM rejected: %w", err)
	}
	if err := client.Rcpt(to.Address); err != nil {
		return fmt.Errorf("mail: recipient rejected: %w", err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("mail: DATA: %w", err)
	}
	if _, err := w.Write(raw); err != nil {
		return fmt.Errorf("mail: write message: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("mail: message rejected: %w", err)
	}
	return client.Quit()
}

// buildMessage renders a UTF-8 plain-text email with safe headers.
func buildMessage(from, to *netmail.Address, msg Message, now time.Time) ([]byte, error) {
	if strings.ContainsAny(msg.Subject, "\r\n") {
		return nil, errHeaderInjection
	}
	id := make([]byte, 12)
	_, _ = rand.Read(id)
	domain := "engora.local"
	if at := strings.LastIndex(from.Address, "@"); at >= 0 {
		domain = from.Address[at+1:]
	}

	var b bytes.Buffer
	header := func(k, v string) { fmt.Fprintf(&b, "%s: %s\r\n", k, v) }
	header("From", from.String())
	header("To", to.String())
	header("Subject", mime.QEncoding.Encode("utf-8", msg.Subject))
	header("Date", now.Format(time.RFC1123Z))
	header("Message-ID", fmt.Sprintf("<%s@%s>", hex.EncodeToString(id), domain))
	header("MIME-Version", "1.0")
	header("Content-Type", `text/plain; charset="utf-8"`)
	header("Content-Transfer-Encoding", "quoted-printable")
	b.WriteString("\r\n")

	qp := quotedprintable.NewWriter(&b)
	if _, err := qp.Write([]byte(strings.ReplaceAll(msg.Text, "\n", "\r\n"))); err != nil {
		return nil, err
	}
	if err := qp.Close(); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}
