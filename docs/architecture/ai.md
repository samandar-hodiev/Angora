# AI architecture

AI is Engora's core capability and potentially its largest operating cost. The architecture
optimises for three things: **no vendor lock-in**, **machine-readable versioned results**, and
**cost visibility per call**.

## Layers

```text
Application module      speaking, writing, ai-coach, ielts ...
      │  depends on a task-level interface (internal/ai/services.go)
      ▼
AI service              e.g. SpeakingEvaluator implementation: prompt + rubric + parsing + validation
      │  calls the gateway with a Task
      ▼
AI gateway              internal/ai/gateway.go
      │  route Task → provider/model · measure latency · estimate cost
      │  record ai_requests + ai_usage · hide provider errors from clients
      ▼
Provider                internal/ai/providers/{mock,openai,...}  implements ai.Provider
```

Application code never imports a provider package, never sees provider names, raw provider
errors or API keys.

## Provider interface

```go
type Provider interface {
    Name() string
    GenerateText(ctx context.Context, req TextRequest) (*TextResponse, error)
    AnalyzeText(ctx context.Context, req AnalysisRequest) (*AnalysisResponse, error)       // JSON-schema structured output
    TranscribeAudio(ctx context.Context, req TranscriptionRequest) (*TranscriptionResponse, error)
}
```

- A provider without a capability returns `ai.ErrUnsupported` → clients get `NOT_IMPLEMENTED`.
- Upstream failures are `*ai.ProviderError` (status, retryable) → clients get
  `SERVICE_UNAVAILABLE` with a generic message; details go to logs only.

Implemented providers:

| Provider | Status |
| --- | --- |
| `mock` | Deterministic; used in development and tests; forbidden in production. |
| `openai` | Chat completions (text + JSON-schema output) and audio transcription over `net/http`; tested against a fake server. |
| Gemini, Anthropic, others | Add `providers/<name>` implementing `ai.Provider` and register it in `internal/app`. |

## Routing

`GatewayConfig.Routes` maps each `Task` to a provider and model, e.g. transcription on one vendor
and writing evaluation on another. Unrouted tasks use `AI_PROVIDER` / `AI_MODEL`.

Tasks: `transcription`, `speaking_evaluation`, `writing_evaluation`, `grammar_analysis`,
`vocabulary_analysis`, `pronunciation_analysis`, `content_relevance`, `ielts_scoring`,
`recommendation`, `content_generation`, `coach_chat`, `text_to_speech`, `realtime_conversation`.

## Future services (interfaces only today)

`Transcriber`, `SpeakingEvaluator`, `WritingEvaluator`, `GrammarAnalyzer`, `VocabularyAnalyzer`,
`PronunciationAnalyzer`, `RelevanceChecker`, `IELTSScorer`, `Recommender`, `ContentGenerator`,
`Coach`, `SpeechSynthesizer`, `RealtimeSessionFactory`.

Each implementation will own its prompts (versioned, e.g. `speaking_eval.v3`) and rubric
(e.g. `ielts_speaking_public_descriptors.v1`), call the gateway, validate the output and return
`EvaluationResult`.

Realtime conversation needs a streaming transport (WebRTC/WebSocket) and will get a dedicated
gateway path; it is intentionally not forced into the request/response interface.

## Structured, versioned results

```json
{
  "schema_version": "evaluation.v1",
  "model_version": "gpt-4.1-mini-2025-04-14",
  "prompt_version": "speaking_eval.v1",
  "rubric_version": "ielts_speaking.v1",
  "analysis_version": "speaking_pipeline.v1",
  "score": 6.5,
  "scale": "ielts_band",
  "scores": { "grammar": 6.0, "vocabulary": 7.0, "fluency": 6.5, "pronunciation": 6.5 },
  "mistakes": [
    { "category": "grammar.tense.past_simple", "original": "I go there yesterday",
      "correction": "I went there yesterday", "explanation": "…", "severity": "medium",
      "span": { "start": 0, "end": 20 } }
  ],
  "strengths": ["Clear structure"],
  "recommendations": [{ "type": "grammar_topic", "target": "past-simple", "reason": "Repeated tense errors" }]
}
```

- AI output is untrusted input: `EvaluationResult.Validate()` runs before anything is stored or
  used for progress, mistakes or recommendations.
- Results are stored in `ai_analyses.result` with the version columns denormalised for querying.
- Versions enable regression testing: re-run a fixed evaluation set with a new prompt/model and
  compare distributions before switching traffic.
- IELTS scores are always labelled as **estimated** bands in the product.

## Asynchronous pipeline

```text
upload audio → audio_files (pending) → enqueue speaking.evaluate
worker: transcribe (Transcriber) → evaluate (SpeakingEvaluator) → validate
      → ai_analyses + transcripts + mistakes + skill_progress → job succeeded
client polls /api/v1/jobs/:id → fetch session with analysis
```

Usage limits (`speaking.evaluations`, …) are consumed when the job is accepted, so abuse cannot
queue unbounded AI work.

## Cost tracking

Every gateway call writes `ai_requests`: provider, model, task, input/output tokens, audio
seconds, estimated USD cost, latency, status, error code, prompt version, request id — and updates
the daily `ai_usage` roll-up. Pricing is configuration (`GatewayConfig.Pricing`, keyed by
`provider/model`); unpriced calls record cost 0 so they are visible as gaps rather than wrong
numbers.

## Safety and privacy

- API keys only in environment variables; never logged or returned.
- Prompts and learner content are not stored in `ai_requests`.
- Provider error messages are logged server-side and never forwarded.
