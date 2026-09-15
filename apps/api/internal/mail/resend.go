package mail

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// ResendMailer sends through the Resend HTTP API (https://resend.com). The sending domain must
// be verified in Resend, and MAIL_FROM must use it.
type ResendMailer struct {
	apiKey   string
	from     string
	endpoint string
	client   *http.Client
}

func NewResend(apiKey, from string) *ResendMailer {
	return &ResendMailer{apiKey: apiKey, from: from, endpoint: "https://api.resend.com/emails", client: &http.Client{Timeout: 15 * time.Second}}
}

func (m *ResendMailer) Send(ctx context.Context, msg Message) error {
	body, err := json.Marshal(map[string]any{"from": m.from, "to": []string{msg.To}, "subject": msg.Subject, "text": msg.Text})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+m.apiKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := m.client.Do(req)
	if err != nil {
		return fmt.Errorf("mail: resend request: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("mail: resend returned %d: %s", res.StatusCode, detail)
	}
	return nil
}
