package ielts

import "testing"

// Band conversion is the part of the exam a learner will compare against their real result,
// so it is pinned down here rather than left to drift.

func TestBandForRawFullPaper(t *testing.T) {
	cases := []struct {
		skill   Skill
		correct int
		want    float64
	}{
		{SkillListening, 40, 9},
		{SkillListening, 30, 7},
		{SkillListening, 23, 6},
		{SkillListening, 0, 0},
		// Reading is marked harder at the same raw score.
		{SkillReading, 30, 7},
		{SkillReading, 27, 6.5},
		{SkillReading, 23, 6},
	}
	for _, tc := range cases {
		if got := BandForRaw(tc.skill, tc.correct, 40); got != tc.want {
			t.Errorf("BandForRaw(%s, %d/40) = %v, want %v", tc.skill, tc.correct, got, tc.want)
		}
	}
}

func TestBandForRawScalesShortPapers(t *testing.T) {
	// A ten-question practice section: 8 right is 80%, which on a full paper is 32/40.
	if got := BandForRaw(SkillListening, 8, 10); got != 7.5 {
		t.Errorf("8/10 listening = %v, want 7.5 (scaled to 32/40)", got)
	}
	// The same proportion on the harder reading table lands a half band lower.
	if got := BandForRaw(SkillReading, 8, 10); got != 7 {
		t.Errorf("8/10 reading = %v, want 7 — reading is marked harder than listening", got)
	}
	if got := BandForRaw(SkillReading, 0, 0); got != 0 {
		t.Errorf("an empty paper must be 0, got %v", got)
	}
	if got := BandForRaw(SkillListening, 15, 10); got != 9 {
		t.Errorf("more correct than asked must clamp to full marks, got %v", got)
	}
}

func TestBandForRubric(t *testing.T) {
	cases := map[float64]float64{0: 0, 50: 4.5, 58: 5, 62: 5.5, 72: 6.5, 100: 9, 120: 9}
	for score, want := range cases {
		if got := BandForRubric(score); got != want {
			t.Errorf("BandForRubric(%v) = %v, want %v", score, got, want)
		}
	}
}

func TestOverallRoundsLikeIELTS(t *testing.T) {
	cases := []struct {
		bands map[Skill]float64
		want  float64
	}{
		// 6.5 + 6.5 + 5 + 7 = 25 / 4 = 6.25 → 6.5
		{map[Skill]float64{SkillListening: 6.5, SkillReading: 6.5, SkillWriting: 5, SkillSpeaking: 7}, 6.5},
		// 6.5 + 6.5 + 5.5 + 7 = 25.5 / 4 = 6.375 → 6.5
		{map[Skill]float64{SkillListening: 6.5, SkillReading: 6.5, SkillWriting: 5.5, SkillSpeaking: 7}, 6.5},
		// All the same band stays that band.
		{map[Skill]float64{SkillListening: 7, SkillReading: 7, SkillWriting: 7, SkillSpeaking: 7}, 7},
		// A partial sitting averages what was done rather than counting the rest as zero.
		{map[Skill]float64{SkillListening: 7, SkillReading: 8}, 7.5},
		{map[Skill]float64{}, 0},
	}
	for _, tc := range cases {
		if got := Overall(tc.bands); got != tc.want {
			t.Errorf("Overall(%v) = %v, want %v", tc.bands, got, tc.want)
		}
	}
}
