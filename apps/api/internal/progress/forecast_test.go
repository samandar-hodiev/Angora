package progress

import (
	"math"
	"testing"
	"time"
)

func TestLeastSquaresFitsAStraightLineExactly(t *testing.T) {
	// y = 50 + 2x has no noise, so the fit must recover it and report a perfect R².
	xs := []float64{0, 1, 2, 3, 4}
	ys := []float64{50, 52, 54, 56, 58}
	slope, intercept, r2 := leastSquares(xs, ys)
	if math.Abs(slope-2) > 1e-9 {
		t.Errorf("slope = %v, want 2", slope)
	}
	if math.Abs(intercept-50) > 1e-9 {
		t.Errorf("intercept = %v, want 50", intercept)
	}
	if math.Abs(r2-1) > 1e-9 {
		t.Errorf("r2 = %v, want 1", r2)
	}
}

func TestLeastSquaresReportsNoConfidenceForAFlatSeries(t *testing.T) {
	// Every week the same score: the slope is zero and, more importantly, the fit explains
	// nothing, so confidence must not be reported as perfect.
	slope, _, r2 := leastSquares([]float64{0, 1, 2, 3}, []float64{60, 60, 60, 60})
	if slope != 0 {
		t.Errorf("slope = %v, want 0", slope)
	}
	if r2 != 0 {
		t.Errorf("r2 = %v, want 0 — a flat line explains none of the (absent) variation", r2)
	}
}

func TestLeastSquaresIsUndefinedForASinglePoint(t *testing.T) {
	slope, _, r2 := leastSquares([]float64{1}, []float64{70})
	if slope != 0 || r2 != 0 {
		t.Errorf("slope = %v, r2 = %v, want both zero for one point", slope, r2)
	}
}

func TestSummarizeWeightsWeeklyScoresByPractice(t *testing.T) {
	week := time.Date(2026, 9, 14, 0, 0, 0, 0, time.UTC)
	// One lucky reading set at 100 next to nine speaking sessions at 50 must not read as 75.
	weeks, skills, total := summarize([]weekRow{
		{week: week, skill: "reading", score: 100, sessions: 1, minutes: 5},
		{week: week, skill: "speaking", score: 50, sessions: 9, minutes: 45},
	})
	if len(weeks) != 1 {
		t.Fatalf("weeks = %d, want 1", len(weeks))
	}
	if weeks[0].AvgScore != 55 {
		t.Errorf("avg_score = %v, want 55 (weighted by sessions), not 75", weeks[0].AvgScore)
	}
	if weeks[0].Sessions != 10 || total != 10 {
		t.Errorf("sessions = %d / %d, want 10", weeks[0].Sessions, total)
	}
	if weeks[0].Minutes != 50 {
		t.Errorf("minutes = %d, want 50", weeks[0].Minutes)
	}
	if len(skills) != 2 {
		t.Fatalf("skills = %d, want reading and speaking", len(skills))
	}
}

func TestSummarizeReportsAFallingSkillAsFalling(t *testing.T) {
	base := time.Date(2026, 8, 3, 0, 0, 0, 0, time.UTC)
	var rows []weekRow
	for i, score := range []float64{70, 65, 60, 55} {
		rows = append(rows, weekRow{week: base.AddDate(0, 0, 7*i), skill: "writing", score: score, sessions: 2})
	}
	_, skills, _ := summarize(rows)
	if len(skills) != 1 {
		t.Fatalf("skills = %d, want 1", len(skills))
	}
	if skills[0].TrendPerWeek >= 0 {
		t.Errorf("trend = %v, want a negative slope for a skill that is getting worse", skills[0].TrendPerWeek)
	}
}
