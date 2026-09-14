// Package speaking will own speaking practice (Phase 2).
//
// Flow: start session for a content item → client uploads audio (presigned URL or API
// upload, validated by storage.AudioPolicy) → enqueue jobs.TypeSpeakingEvaluate → worker
// transcribes (ai.Transcriber) and evaluates (ai.SpeakingEvaluator) → result stored in
// ai_analyses, mistakes extracted, skill_progress updated → client polls /jobs/:id.
//
// Tables: speaking_sessions, audio_files, transcripts, ai_analyses.
// Entitlements: speaking.practice (feature), speaking.evaluations (limit).
// Routes (planned): POST /api/v1/speaking/sessions, POST /api/v1/speaking/sessions/:id/audio,
// POST /api/v1/speaking/sessions/:id/submit, GET /api/v1/speaking/sessions/:id.
package speaking
