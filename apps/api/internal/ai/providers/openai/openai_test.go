package openai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
)

func TestGenerateText(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer sk-test" {
			t.Errorf("missing bearer auth")
		}
		var body chatRequest
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.Model != "gpt-test" || len(body.Messages) != 2 || body.Messages[0].Role != "system" {
			t.Errorf("unexpected request: %+v", body)
		}
		_, _ = w.Write([]byte(`{"model":"gpt-test","choices":[{"message":{"role":"assistant","content":"Hi!"},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":3}}`))
	}))
	defer srv.Close()

	res, err := New("sk-test", srv.URL).GenerateText(context.Background(), ai.TextRequest{
		Model: "gpt-test", System: "Be a coach", Messages: []ai.Message{{Role: "user", Content: "Hello"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Text != "Hi!" || res.Usage.InputTokens != 12 || res.Usage.OutputTokens != 3 {
		t.Errorf("response = %+v", res)
	}
}

func TestAnalyzeTextRequestsJSONSchema(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		rf, _ := body["response_format"].(map[string]any)
		if rf["type"] != "json_schema" {
			t.Errorf("response_format = %v", body["response_format"])
		}
		_, _ = w.Write([]byte(`{"model":"m","choices":[{"message":{"content":"{\"score\":7}"}}],"usage":{}}`))
	}))
	defer srv.Close()

	res, err := New("k", srv.URL).AnalyzeText(context.Background(), ai.AnalysisRequest{
		SchemaName: "evaluation", Schema: json.RawMessage(`{"type":"object"}`), Input: "text",
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(res.Output) != `{"score":7}` {
		t.Errorf("output = %s", res.Output)
	}
}

func TestUpstreamErrorsAreProviderErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"message":"Rate limit reached for org-secret-123"}}`))
	}))
	defer srv.Close()

	_, err := New("k", srv.URL).GenerateText(context.Background(), ai.TextRequest{})
	var pe *ai.ProviderError
	if !errors.As(err, &pe) {
		t.Fatalf("err = %v, want *ai.ProviderError", err)
	}
	if pe.StatusCode != 429 || !pe.Retryable || !strings.Contains(pe.Message, "Rate limit") {
		t.Errorf("provider error = %+v", pe)
	}
}

func TestTranscribeAudioMultipart(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatalf("parse multipart: %v", err)
		}
		if r.FormValue("model") != DefaultTranscriptionModel || r.FormValue("language") != "en" {
			t.Errorf("form = %v", r.MultipartForm.Value)
		}
		if _, _, err := r.FormFile("file"); err != nil {
			t.Errorf("file missing: %v", err)
		}
		_, _ = w.Write([]byte(`{"text":"hello world","usage":{"seconds":3.5}}`))
	}))
	defer srv.Close()

	res, err := New("k", srv.URL).TranscribeAudio(context.Background(), ai.TranscriptionRequest{
		Audio: strings.NewReader("fake-audio"), MimeType: "audio/webm", Language: "en",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Text != "hello world" || res.Usage.AudioSeconds != 3.5 {
		t.Errorf("response = %+v", res)
	}
}
