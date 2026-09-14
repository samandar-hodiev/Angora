package ai_test

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/ai/providers/mock"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

type recorder struct {
	mu      sync.Mutex
	records []ai.UsageRecord
}

func (r *recorder) Record(_ context.Context, rec ai.UsageRecord) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.records = append(r.records, rec)
}

// failingProvider simulates a vendor outage with a message that must never reach users.
type failingProvider struct{ name string }

func (p failingProvider) Name() string { return p.name }
func (p failingProvider) GenerateText(context.Context, ai.TextRequest) (*ai.TextResponse, error) {
	return nil, &ai.ProviderError{Provider: p.name, StatusCode: 503, Retryable: true, Message: "upstream overloaded, key sk-live-abc"}
}
func (p failingProvider) AnalyzeText(context.Context, ai.AnalysisRequest) (*ai.AnalysisResponse, error) {
	return nil, ai.ErrUnsupported
}
func (p failingProvider) TranscribeAudio(context.Context, ai.TranscriptionRequest) (*ai.TranscriptionResponse, error) {
	return nil, ai.ErrUnsupported
}

func newGateway(t *testing.T, cfg ai.GatewayConfig, rec ai.UsageRecorder) *ai.Gateway {
	t.Helper()
	g, err := ai.NewGateway(cfg, rec, logger.Discard(), mock.New(), failingProvider{name: "flaky"})
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func TestGatewayRecordsUsageAndCost(t *testing.T) {
	rec := &recorder{}
	g := newGateway(t, ai.GatewayConfig{
		DefaultProvider: "mock",
		DefaultModel:    "mock-large",
		Pricing:         map[string]ai.Pricing{"mock/mock-large": {InputPerMillionUSD: 1_000_000, OutputPerMillionUSD: 2_000_000}},
	}, rec)
	user := uuid.New()

	res, err := g.GenerateText(context.Background(),
		ai.CallMeta{Task: ai.TaskCoachChat, UserID: &user, PromptVersion: "coach.v1"},
		ai.TextRequest{Messages: []ai.Message{{Role: "user", Content: "hello there"}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(rec.records) != 1 {
		t.Fatalf("records = %d, want 1", len(rec.records))
	}
	r := rec.records[0]
	if r.Task != ai.TaskCoachChat || r.Provider != "mock" || r.Model != "mock-large" || !r.Succeeded {
		t.Errorf("record = %+v", r)
	}
	if *r.UserID != user || r.PromptVersion != "coach.v1" {
		t.Errorf("meta not recorded: %+v", r)
	}
	want := float64(r.Usage.InputTokens)*1 + float64(r.Usage.OutputTokens)*2
	if math.Abs(r.EstimatedCost-want) > 1e-9 || want == 0 {
		t.Errorf("cost = %v, want %v", r.EstimatedCost, want)
	}
	if res.AIRequestID != r.ID {
		t.Error("response must reference the recorded ai_requests id")
	}
}

func TestGatewayRoutesTasksToProviders(t *testing.T) {
	rec := &recorder{}
	g := newGateway(t, ai.GatewayConfig{
		DefaultProvider: "mock",
		Routes:          map[ai.Task]ai.Route{ai.TaskWritingEvaluation: {Provider: "flaky", Model: "flaky-1"}},
	}, rec)

	if _, err := g.GenerateText(context.Background(), ai.CallMeta{Task: ai.TaskCoachChat}, ai.TextRequest{}); err != nil {
		t.Fatalf("default route: %v", err)
	}
	_, err := g.GenerateText(context.Background(), ai.CallMeta{Task: ai.TaskWritingEvaluation}, ai.TextRequest{})
	if err == nil {
		t.Fatal("expected routed provider failure")
	}
	if rec.records[1].Provider != "flaky" || rec.records[1].Model != "flaky-1" {
		t.Errorf("routed record = %+v", rec.records[1])
	}
}

func TestGatewayHidesProviderErrors(t *testing.T) {
	rec := &recorder{}
	g := newGateway(t, ai.GatewayConfig{DefaultProvider: "flaky"}, rec)

	_, err := g.GenerateText(context.Background(), ai.CallMeta{Task: ai.TaskCoachChat}, ai.TextRequest{})
	appErr := apperr.From(err)
	if appErr.Code != apperr.CodeUnavailable {
		t.Fatalf("code = %s, want SERVICE_UNAVAILABLE", appErr.Code)
	}
	if strings.Contains(appErr.Message, "sk-live") || strings.Contains(appErr.Message, "flaky") {
		t.Errorf("client message leaks provider details: %q", appErr.Message)
	}
	if rec.records[0].Succeeded || rec.records[0].ErrorCode != "provider_unavailable" {
		t.Errorf("failure not recorded: %+v", rec.records[0])
	}

	_, err = g.AnalyzeText(context.Background(), ai.CallMeta{Task: ai.TaskWritingEvaluation}, ai.AnalysisRequest{})
	if !apperr.Is(err, apperr.CodeNotImplemented) {
		t.Errorf("unsupported capability: err = %v, want NOT_IMPLEMENTED", err)
	}
}

func TestGatewayRejectsUnknownProvider(t *testing.T) {
	if _, err := ai.NewGateway(ai.GatewayConfig{DefaultProvider: "nope"}, ai.NopRecorder{}, logger.Discard(), mock.New()); err == nil {
		t.Error("expected error for unregistered default provider")
	}
	_, err := ai.NewGateway(ai.GatewayConfig{
		DefaultProvider: "mock",
		Routes:          map[ai.Task]ai.Route{ai.TaskTranscription: {Provider: "missing"}},
	}, ai.NopRecorder{}, logger.Discard(), mock.New())
	if err == nil {
		t.Error("expected error for route to unregistered provider")
	}
}

func TestMockAnalysisProducesValidVersionedResult(t *testing.T) {
	g := newGateway(t, ai.GatewayConfig{DefaultProvider: "mock"}, ai.NopRecorder{})
	res, err := g.AnalyzeText(context.Background(), ai.CallMeta{Task: ai.TaskSpeakingEvaluation}, ai.AnalysisRequest{Input: "I go there yesterday"})
	if err != nil {
		t.Fatal(err)
	}
	var result ai.EvaluationResult
	if err := json.Unmarshal(res.Output, &result); err != nil {
		t.Fatal(err)
	}
	if err := result.Validate(); err != nil {
		t.Errorf("mock result invalid: %v", err)
	}
}

func TestEvaluationResultValidation(t *testing.T) {
	score := 6.0
	bad := ai.EvaluationResult{
		Versions: ai.Versions{SchemaVersion: "evaluation.v0"},
		Score:    &score,
		Mistakes: []ai.Mistake{{Severity: "catastrophic", Span: &ai.Span{Start: 5, End: 2}}},
	}
	err := bad.Validate()
	if err == nil {
		t.Fatal("expected validation errors")
	}
	for _, want := range []string{"schema_version", "versions are required", "scale", "category", "severity", "span"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("missing %q in %v", want, err)
		}
	}
}
