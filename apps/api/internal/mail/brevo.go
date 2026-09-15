package mail

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	netmail "net/mail"
	"time"
)

// BrevoMailer sends through the Brevo transactional email HTTP API (https://brevo.com).
// It only needs outbound HTTPS, so it works on networks that block SMTP ports. The sender
// address in MAIL_FROM must be verified in Brevo (Senders & IPs); a custom domain is optional.
type BrevoMailer struct {
	apiKey   string
	from     string
	endpoint string
	client   *http.Client
}

func NewBrevo(apiKey, from string) *BrevoMailer {
	return &BrevoMailer{apiKey: apiKey, from: from, endpoint: "https://api.brevo.com/v3/smtp/email", client: &http.Client{Timeout: 15 * time.Second}}
}

func (m *BrevoMailer) Send(ctx context.Context, msg Message) error {
	sender, err := netmail.ParseAddress(m.from)
	if err != nil {
		return fmt.Errorf("mail: invalid MAIL_FROM: %w", err)
	}
	body, err := json.Marshal(map[string]any{
		"sender":      map[string]string{"name": sender.Name, "email": sender.Address},
		"to":          []map[string]string{{"email": msg.To}},
		"subject":     msg.Subject,
		"textContent": msg.Text,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("api-key", m.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	res, err := m.client.Do(req)
	if err != nil {
		return fmt.Errorf("mail: brevo request: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("mail: brevo returned %d: %s", res.StatusCode, detail)
	}
	return nil
}
