package mail

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBrevoMailer(t *testing.T) {
	var got struct {
		Sender      map[string]string   `json:"sender"`
		To          []map[string]string `json:"to"`
		Subject     string              `json:"subject"`
		TextContent string              `json:"textContent"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("api-key") != "xkeysib-test" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	m := NewBrevo("xkeysib-test", "Engora <sender@gmail.com>")
	m.endpoint = server.URL
	if err := m.Send(context.Background(), Message{To: "learner@example.com", Subject: "Code", Text: "123456"}); err != nil {
		t.Fatal(err)
	}
	if got.Sender["email"] != "sender@gmail.com" || got.Sender["name"] != "Engora" || got.To[0]["email"] != "learner@example.com" || got.TextContent != "123456" {
		t.Errorf("payload = %+v", got)
	}

	m.apiKey = "wrong"
	if err := m.Send(context.Background(), Message{To: "learner@example.com"}); err == nil {
		t.Error("expected an error for a rejected request")
	}
}
