// Package mock is a deterministic AI provider for local development and tests. It lets
// the whole pipeline (jobs, storage, results, usage tracking) run without API keys or cost.
package mock

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
)

const Name = "mock"

type Provider struct{}

func New() *Provider { return &Provider{} }

func (*Provider) Name() string { return Name }

func model(m string) string {
	if m == "" {
		return "mock-1"
	}
	return m
}

func (*Provider) GenerateText(_ context.Context, req ai.TextRequest) (*ai.TextResponse, error) {
	last := ""
	if n := len(req.Messages); n > 0 {
		last = req.Messages[n-1].Content
	}
	return &ai.TextResponse{
		Text:         fmt.Sprintf("[mock] You said: %s", last),
		Model:        model(req.Model),
		FinishReason: "stop",
		Usage:        ai.Usage{InputTokens: tokens(req.System + last), OutputTokens: tokens(last) + 4},
	}, nil
}

func (*Provider) AnalyzeText(_ context.Context, req ai.AnalysisRequest) (*ai.AnalysisResponse, error) {
	score := 6.5
	out, err := json.Marshal(ai.EvaluationResult{
		Versions: ai.Versions{
			SchemaVersion: ai.EvaluationSchemaVersion, ModelVersion: model(req.Model),
			PromptVersion: "mock", RubricVersion: "mock", AnalysisVersion: "mock",
		},
		Score:  &score,
		Scale:  "ielts_band",
		Scores: map[string]float64{"grammar": 6.0, "vocabulary": 7.0, "fluency": 6.5, "pronunciation": 6.5},
		Mistakes: []ai.Mistake{{
			Category: "grammar.tense.past_simple", Original: "I go there yesterday",
			Correction: "I went there yesterday", Explanation: "Use the past simple for finished past actions.",
			Severity: "medium",
		}},
		Strengths:       []string{"Clear structure"},
		Recommendations: []ai.Recommendation{{Type: "grammar_topic", Target: "past-simple", Reason: "Repeated tense errors"}},
	})
	if err != nil {
		return nil, err
	}
	return &ai.AnalysisResponse{
		Output: out,
		Model:  model(req.Model),
		Usage:  ai.Usage{InputTokens: tokens(req.Instructions + req.Input), OutputTokens: tokens(string(out))},
	}, nil
}

func (*Provider) TranscribeAudio(_ context.Context, req ai.TranscriptionRequest) (*ai.TranscriptionResponse, error) {
	n, err := io.Copy(io.Discard, req.Audio)
	if err != nil {
		return nil, err
	}
	// Pretend 16 kB/s of compressed audio.
	seconds := float64(n) / 16000
	return &ai.TranscriptionResponse{
		Text:            "This is a mock transcript.",
		Language:        "en",
		DurationSeconds: seconds,
		Segments:        []ai.TranscriptSegment{{StartMs: 0, EndMs: int(seconds * 1000), Text: "This is a mock transcript."}},
		Model:           model(req.Model),
		Usage:           ai.Usage{AudioSeconds: seconds},
	}, nil
}

func tokens(s string) int {
	return len(strings.Fields(s))
}
