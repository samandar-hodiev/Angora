// Package mistakes will own mistake extraction and weakness detection (Phase 6).
//
// Consumes validated ai.EvaluationResult mistakes, stores them, and aggregates recurring
// categories into weaknesses that feed recommendations.
//
// Tables: mistakes, weaknesses.
package mistakes
