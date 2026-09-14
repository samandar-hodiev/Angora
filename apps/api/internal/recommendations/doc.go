// Package recommendations will own the personalization engine (Phase 6).
//
// Starts rule-based (weaknesses + level + goals → content), later augmented by
// ai.Recommender. Every recommendation records its source (rule | ai | teacher).
//
// Tables: learning_plans, recommendations.
package recommendations
