// Package ielts will own IELTS mode (Phase 8).
//
// IELTS is a mode of the general learning engine, not a separate product: it reuses
// speaking/writing/reading/listening sessions with mode = ielts_*, content_items with
// exam = ielts, and ai.IELTSScorer for band scores stored in ai_analyses.
//
// Planned tables: mock exam attempts linking section attempts. Entitlements: ielts.mode, ielts.mock_exams.
package ielts
