// Package openai adapts the OpenAI HTTP API to ai.Provider using only net/http.
//
// It is the only place in the codebase that knows OpenAI request and response shapes.
package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
)

const Name = "openai"

// Default models used when neither the route nor the request names one. Configure
// AI_MODEL or per-task routes to change them without code.
const (
	DefaultTextModel          = "gpt-4.1-mini"
	DefaultTranscriptionModel = "gpt-4o-mini-transcribe"
)

type Provider struct {
	apiKey  string
	baseURL string
	http    *http.Client
}

func New(apiKey, baseURL string) *Provider {
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	return &Provider{
		apiKey:  apiKey,
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{Timeout: 120 * time.Second},
	}
}

func (*Provider) Name() string { return Name }

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model               string         `json:"model"`
	Messages            []chatMessage  `json:"messages"`
	MaxCompletionTokens int            `json:"max_completion_tokens,omitempty"`
	Temperature         *float64       `json:"temperature,omitempty"`
	ResponseFormat      map[string]any `json:"response_format,omitempty"`
}

type chatResponse struct {
	Model   string `json:"model"`
	Choices []struct {
		Message      chatMessage `json:"message"`
		FinishReason string      `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
}

func (p *Provider) GenerateText(ctx context.Context, req ai.TextRequest) (*ai.TextResponse, error) {
	body := chatRequest{
		Model:               orDefault(req.Model, DefaultTextModel),
		Messages:            toMessages(req.System, req.Messages),
		MaxCompletionTokens: req.MaxOutputTokens,
		Temperature:         req.Temperature,
	}
	var res chatResponse
	if err := p.postJSON(ctx, "/chat/completions", body, &res); err != nil {
		return nil, err
	}
	if len(res.Choices) == 0 {
		return nil, &ai.ProviderError{Provider: Name, StatusCode: http.StatusBadGateway, Message: "no choices returned"}
	}
	return &ai.TextResponse{
		Text:         res.Choices[0].Message.Content,
		Model:        res.Model,
		FinishReason: res.Choices[0].FinishReason,
		Usage:        ai.Usage{InputTokens: res.Usage.PromptTokens, OutputTokens: res.Usage.CompletionTokens},
	}, nil
}

func (p *Provider) AnalyzeText(ctx context.Context, req ai.AnalysisRequest) (*ai.AnalysisResponse, error) {
	if len(req.Schema) == 0 || req.SchemaName == "" {
		return nil, errors.New("openai: AnalyzeText requires SchemaName and Schema")
	}
	body := chatRequest{
		Model:    orDefault(req.Model, DefaultTextModel),
		Messages: toMessages(req.Instructions, []ai.Message{{Role: "user", Content: req.Input}}),
		ResponseFormat: map[string]any{
			"type": "json_schema",
			"json_schema": map[string]any{
				"name":   req.SchemaName,
				"schema": req.Schema,
				"strict": true,
			},
		},
	}
	var res chatResponse
	if err := p.postJSON(ctx, "/chat/completions", body, &res); err != nil {
		return nil, err
	}
	if len(res.Choices) == 0 || !json.Valid([]byte(res.Choices[0].Message.Content)) {
		return nil, &ai.ProviderError{Provider: Name, StatusCode: http.StatusBadGateway, Message: "structured output was not valid JSON"}
	}
	return &ai.AnalysisResponse{
		Output: json.RawMessage(res.Choices[0].Message.Content),
		Model:  res.Model,
		Usage:  ai.Usage{InputTokens: res.Usage.PromptTokens, OutputTokens: res.Usage.CompletionTokens},
	}, nil
}

type transcriptionResponse struct {
	Text     string  `json:"text"`
	Language string  `json:"language"`
	Duration float64 `json:"duration"`
	Segments []struct {
		Start float64 `json:"start"`
		End   float64 `json:"end"`
		Text  string  `json:"text"`
	} `json:"segments"`
	Usage struct {
		InputTokens  int     `json:"input_tokens"`
		OutputTokens int     `json:"output_tokens"`
		Seconds      float64 `json:"seconds"`
	} `json:"usage"`
}

func (p *Provider) TranscribeAudio(ctx context.Context, req ai.TranscriptionRequest) (*ai.TranscriptionResponse, error) {
	model := orDefault(req.Model, DefaultTranscriptionModel)

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("model", model)
	// verbose_json (with segments) is only offered by whisper-1; newer models return json.
	format := "json"
	if model == "whisper-1" {
		format = "verbose_json"
	}
	_ = mw.WriteField("response_format", format)
	if req.Language != "" {
		_ = mw.WriteField("language", req.Language)
	}
	fw, err := mw.CreateFormFile("file", orDefault(req.FileName, "audio.webm"))
	if err != nil {
		return nil, err
	}
	if _, err := io.Copy(fw, req.Audio); err != nil {
		return nil, fmt.Errorf("openai: read audio: %w", err)
	}
	if err := mw.Close(); err != nil {
		return nil, err
	}

	var res transcriptionResponse
	if err := p.do(ctx, "/audio/transcriptions", mw.FormDataContentType(), &buf, &res); err != nil {
		return nil, err
	}
	out := &ai.TranscriptionResponse{
		Text:            res.Text,
		Language:        res.Language,
		DurationSeconds: res.Duration,
		Model:           model,
		Usage: ai.Usage{
			InputTokens:  res.Usage.InputTokens,
			OutputTokens: res.Usage.OutputTokens,
			AudioSeconds: max(res.Duration, res.Usage.Seconds),
		},
	}
	for _, s := range res.Segments {
		out.Segments = append(out.Segments, ai.TranscriptSegment{
			StartMs: int(s.Start * 1000), EndMs: int(s.End * 1000), Text: strings.TrimSpace(s.Text),
		})
	}
	return out, nil
}

func (p *Provider) postJSON(ctx context.Context, path string, body, out any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	return p.do(ctx, path, "application/json", bytes.NewReader(raw), out)
}

func (p *Provider) do(ctx context.Context, path, contentType string, body io.Reader, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+p.apiKey)
	req.Header.Set("Content-Type", contentType)

	resp, err := p.http.Do(req)
	if err != nil {
		return &ai.ProviderError{Provider: Name, StatusCode: 0, Retryable: true, Message: err.Error()}
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return &ai.ProviderError{Provider: Name, StatusCode: resp.StatusCode, Retryable: true, Message: err.Error()}
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		var apiErr struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(data, &apiErr)
		return &ai.ProviderError{
			Provider:   Name,
			StatusCode: resp.StatusCode,
			Retryable:  resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500,
			Message:    truncate(apiErr.Error.Message, 300),
		}
	}
	if err := json.Unmarshal(data, out); err != nil {
		return &ai.ProviderError{Provider: Name, StatusCode: resp.StatusCode, Message: "invalid JSON response"}
	}
	return nil
}

func toMessages(system string, msgs []ai.Message) []chatMessage {
	out := make([]chatMessage, 0, len(msgs)+1)
	if system != "" {
		out = append(out, chatMessage{Role: "system", Content: system})
	}
	for _, m := range msgs {
		out = append(out, chatMessage{Role: m.Role, Content: m.Content})
	}
	return out
}

func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
