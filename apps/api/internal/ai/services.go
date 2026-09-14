package ai

import (
	"context"
	"io"

	"github.com/google/uuid"
)

// Task-level AI services.
//
// These interfaces are what application modules depend on. Each will get an
// implementation (in a subpackage such as ai/evaluation) that owns its prompts, rubric
// and result parsing and calls the Gateway. None are implemented in the foundation
// phase; they define the seams so feature work does not reshape the architecture.

type EvaluationSubject struct {
	UserID    uuid.UUID
	Level     string // learner's CEFR level, calibrates feedback
	Mode      string // practice | ielts_part_1 | ...
	PromptRef string // content_items.id of the topic/task answered
}

// Transcriber turns learner audio into text.
type Transcriber interface {
	Transcribe(ctx context.Context, userID uuid.UUID, audio io.Reader, mimeType, language string) (*TranscriptionResponse, error)
}

// SpeakingEvaluator scores a spoken answer from its transcript (and later audio features).
type SpeakingEvaluator interface {
	EvaluateSpeaking(ctx context.Context, subject EvaluationSubject, transcript string) (*EvaluationResult, error)
}

// WritingEvaluator scores a written answer.
type WritingEvaluator interface {
	EvaluateWriting(ctx context.Context, subject EvaluationSubject, text string) (*EvaluationResult, error)
}

// GrammarAnalyzer extracts grammar mistakes with corrections.
type GrammarAnalyzer interface {
	AnalyzeGrammar(ctx context.Context, subject EvaluationSubject, text string) ([]Mistake, error)
}

// VocabularyAnalyzer assesses range and suggests better word choices.
type VocabularyAnalyzer interface {
	AnalyzeVocabulary(ctx context.Context, subject EvaluationSubject, text string) (*EvaluationResult, error)
}

// PronunciationAnalyzer assesses pronunciation from audio.
type PronunciationAnalyzer interface {
	AnalyzePronunciation(ctx context.Context, subject EvaluationSubject, audio io.Reader, mimeType, referenceText string) (*EvaluationResult, error)
}

// RelevanceChecker reports whether an answer addresses the prompt (0..1).
type RelevanceChecker interface {
	CheckRelevance(ctx context.Context, prompt, answer string) (float64, error)
}

// IELTSScorer produces band scores against the official public descriptors.
type IELTSScorer interface {
	ScoreIELTS(ctx context.Context, subject EvaluationSubject, module string, answer string) (*EvaluationResult, error)
}

// Recommender proposes next learning steps from weaknesses and progress.
type Recommender interface {
	Recommend(ctx context.Context, userID uuid.UUID, limit int) ([]Recommendation, error)
}

// ContentGenerator drafts learning content for human review (never auto-published).
type ContentGenerator interface {
	GenerateContent(ctx context.Context, contentType, level, topic string) ([]byte, error)
}

// Coach is the conversational AI coach.
type Coach interface {
	Reply(ctx context.Context, userID uuid.UUID, conversationID uuid.UUID, message string) (*TextResponse, error)
}

// SpeechSynthesizer produces audio for listening content and coach replies.
type SpeechSynthesizer interface {
	Synthesize(ctx context.Context, text, voice string) (audio io.ReadCloser, mimeType string, err error)
}

// RealtimeSessionFactory creates low-latency voice conversation sessions. Realtime needs
// a streaming transport (WebRTC/WebSocket) and will get its own gateway path.
type RealtimeSessionFactory interface {
	CreateSession(ctx context.Context, userID uuid.UUID, scenario string) (sessionToken string, err error)
}
