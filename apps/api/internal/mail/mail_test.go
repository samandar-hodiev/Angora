package mail

import (
	"context"
	"encoding/json"
	"io"
	"mime"
	"mime/quotedprintable"
	"net/http"
	"net/http/httptest"
	netmail "net/mail"
	"strings"
	"testing"
	"time"
)

func TestBuildMessage(t *testing.T) {
	from, _ := netmail.ParseAddress("Engora <no-reply@engora.app>")
	to, _ := netmail.ParseAddress("learner@example.com")
	raw, err := buildMessage(from, to, Message{To: "learner@example.com", Subject: "123456 is your Engora code — ✓", Text: "Your code is 123456.\nIt expires soon."}, time.Unix(0, 0))
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := netmail.ReadMessage(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatalf("not a valid RFC 5322 message: %v", err)
	}
	if parsed.Header.Get("To") != "<learner@example.com>" || !strings.HasSuffix(parsed.Header.Get("Message-ID"), "@engora.app>") {
		t.Errorf("headers = %v", parsed.Header)
	}
	subject, err := new(mime.WordDecoder).DecodeHeader(parsed.Header.Get("Subject"))
	if err != nil || subject != "123456 is your Engora code — ✓" {
		t.Errorf("subject = %q (%v)", subject, err)
	}
	body, err := io.ReadAll(quotedprintable.NewReader(parsed.Body))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "Your code is 123456.") {
		t.Errorf("body = %q", body)
	}

	if _, err := buildMessage(from, to, Message{Subject: "hi\r\nBcc: attacker@example.com"}, time.Now()); err != errHeaderInjection {
		t.Errorf("header injection must be refused, got %v", err)
	}
}

func TestResendMailer(t *testing.T) {
	var got map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer re_test" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	m := NewResend("re_test", "Engora <no-reply@engora.app>")
	m.endpoint = server.URL
	if err := m.Send(context.Background(), Message{To: "learner@example.com", Subject: "Code", Text: "123456"}); err != nil {
		t.Fatal(err)
	}
	if got["from"] != "Engora <no-reply@engora.app>" || got["text"] != "123456" {
		t.Errorf("payload = %v", got)
	}

	m.apiKey = "wrong"
	if err := m.Send(context.Background(), Message{To: "learner@example.com"}); err == nil {
		t.Error("expected an error for a rejected request")
	}
}
