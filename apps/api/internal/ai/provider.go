// Package ai is Engora's provider-agnostic AI layer.
//
//	Application module (speaking, writing, coach, ...)
//	        │  depends on a task-level service interface (services.go)
//	        ▼
//	AI service (e.g. a SpeakingEvaluator implementation: prompts, rubric, result parsing)
//	        │  calls the gateway with a Task
//	        ▼
//	Gateway  — routes Task → provider/model, measures latency, estimates cost,
//	        │  records ai_requests/ai_usage, hides provider errors
//	        ▼
//	Provider — OpenAI, Gemini, Anthropic, mock ... (providers/*)
//
// Business code never imports a provider package and never sees provider names, raw
// provider errors or API keys. Switching or mixing providers is configuration.
package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/google/uuid"
)

// Task names what the AI is being used for. Routing, cost reports and regression suites
// are all keyed by task.
type Task string

const (
	TaskTranscription         Task = "transcription"
	TaskSpeakingEvaluation    Task = "speaking_evaluation"
	TaskWritingEvaluation     Task = "writing_evaluation"
	TaskGrammarAnalysis       Task = "grammar_analysis"
	TaskVocabularyAnalysis    Task = "vocabulary_analysis"
	TaskPronunciationAnalysis Task = "pronunciation_analysis"
	TaskContentRelevance      Task = "content_relevance"
	TaskIELTSScoring          Task = "ielts_scoring"
	TaskRecommendation        Task = "recommendation"
	TaskContentGeneration     Task = "content_generation"
	TaskCoachChat             Task = "coach_chat"
	TaskTextToSpeech          Task = "text_to_speech"
	TaskRealtimeConversation  Task = "realtime_conversation"
)

type Message struct {
	Role    string // "user" | "assistant"
	Content string
}

type Usage struct {
	InputTokens  int
	OutputTokens int
	AudioSeconds float64
}

type TextRequest struct {
	Model           string
	System          string
	Messages        []Message
	MaxOutputTokens int
	Temperature     *float64
}

type TextResponse struct {
	Text         string
	Model        string
	FinishReason string
	Usage        Usage
	// AIRequestID links to the ai_requests row recorded by the gateway.
	AIRequestID uuid.UUID
}

// AnalysisRequest asks for structured output that conforms to a JSON Schema.
type AnalysisRequest struct {
	Model        string
	Instructions string
	Input        string
	SchemaName   string
	Schema       json.RawMessage
}

type AnalysisResponse struct {
	Output      json.RawMessage
	Model       string
	Usage       Usage
	AIRequestID uuid.UUID
}

type TranscriptionRequest struct {
	Model    string
	Audio    io.Reader
	FileName string
	MimeType string
	Language string // ISO-639-1 hint, optional
}

type TranscriptSegment struct {
	StartMs int    `json:"start_ms"`
	EndMs   int    `json:"end_ms"`
	Text    string `json:"text"`
}

type TranscriptionResponse struct {
	Text            string
	Language        string
	DurationSeconds float64
	Segments        []TranscriptSegment
	Model           string
	Usage           Usage
	AIRequestID     uuid.UUID
}

// Provider is implemented once per AI vendor. A provider that lacks a capability returns
// ErrUnsupported; the gateway turns that into NOT_IMPLEMENTED for clients.
type Provider interface {
	Name() string
	GenerateText(ctx context.Context, req TextRequest) (*TextResponse, error)
	AnalyzeText(ctx context.Context, req AnalysisRequest) (*AnalysisResponse, error)
	TranscribeAudio(ctx context.Context, req TranscriptionRequest) (*TranscriptionResponse, error)
}

var ErrUnsupported = errors.New("capability not supported by this AI provider")

// ProviderError is returned by providers for failed upstream calls. Its message may
// contain vendor details, so it is logged but never shown to clients.
type ProviderError struct {
	Provider   string
	StatusCode int
	Retryable  bool
	Message    string
}

func (e *ProviderError) Error() string {
	return fmt.Sprintf("%s provider error (status %d): %s", e.Provider, e.StatusCode, e.Message)
}
