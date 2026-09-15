package scoring

import (
	"strings"
	"testing"

	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

func objective(level string, correct, total int) []ObjectiveResponse {
	out := make([]ObjectiveResponse, total)
	for i := range out {
		out[i] = ObjectiveResponse{ItemType: "multiple_choice", Level: cefr.MustParse(level), Difficulty: 5, Answered: true, Correct: i < correct}
	}
	return out
}

func concat(parts ...[]ObjectiveResponse) []ObjectiveResponse {
	var out []ObjectiveResponse
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

func TestScoreObjectiveLevels(t *testing.T) {
	cases := []struct {
		name      string
		responses []ObjectiveResponse
		want      string
	}{
		{"passes core, partial challenge", concat(objective("A2", 3, 3), objective("B1", 3, 4), objective("B2", 1, 3)), "B1+"},
		{"passes challenge too", concat(objective("A2", 3, 3), objective("B1", 3, 4), objective("B2", 2, 3)), "B2"},
		{"passes core, fails challenge", concat(objective("A2", 3, 3), objective("B1", 3, 4), objective("B2", 0, 3)), "B1"},
		{"passes everything", concat(objective("A2", 3, 3), objective("B1", 4, 4), objective("B2", 3, 3)), "B2+"},
		{"fails core partially", concat(objective("A2", 2, 3), objective("B1", 2, 4), objective("B2", 0, 3)), "A2+"},
		{"fails core", concat(objective("A2", 2, 3), objective("B1", 1, 4), objective("B2", 0, 3)), "A2"},
		{"fails foundation partially", concat(objective("A2", 1, 3), objective("B1", 0, 4), objective("B2", 0, 3)), "A1+"},
		{"fails foundation entirely", concat(objective("A2", 0, 3), objective("B1", 0, 4), objective("B2", 0, 3)), "A1"},
		// Inconsistent guessing on hard items does not lift a failed easier level.
		{"lucky on hard items", concat(objective("A2", 1, 3), objective("B1", 1, 4), objective("B2", 3, 3)), "A1+"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ScoreObjective(SkillReading, c.responses)
			if got.Level.String() != c.want {
				t.Errorf("level = %s, want %s (evidence %v)", got.Level, c.want, got.Evidence)
			}
			if got.Score < 0 || got.Score > 100 || got.Confidence < 0.2 || got.Confidence > 0.95 {
				t.Errorf("out of range: %+v", got)
			}
		})
	}
}

func TestScoreObjectiveWeightsDifficultyAndUnanswered(t *testing.T) {
	easy := ObjectiveResponse{Level: cefr.MustParse("A2"), Difficulty: 2, Answered: true}
	hard := ObjectiveResponse{Level: cefr.MustParse("B2"), Difficulty: 9, Answered: true}

	easyRight, hardWrong := easy, hard
	easyRight.Correct = true
	hardRight, easyWrong := hard, easy
	hardRight.Correct = true

	a := ScoreObjective(SkillReading, []ObjectiveResponse{easyRight, hardWrong})
	b := ScoreObjective(SkillReading, []ObjectiveResponse{easyWrong, hardRight})
	if b.Score <= a.Score {
		t.Errorf("a hard correct answer should count more: %v vs %v", b.Score, a.Score)
	}

	unanswered := hardRight
	unanswered.Answered = false
	if ScoreObjective(SkillReading, []ObjectiveResponse{unanswered}).Score != 0 {
		t.Error("unanswered items must score zero even if marked correct")
	}
}

func TestScoreObjectiveConfidencePenalisesInconsistency(t *testing.T) {
	consistent := ScoreObjective(SkillListening, concat(objective("A2", 3, 3), objective("B1", 3, 4), objective("B2", 1, 3)))
	inconsistent := ScoreObjective(SkillListening, concat(objective("A2", 1, 3), objective("B1", 2, 4), objective("B2", 3, 3)))
	if inconsistent.Confidence >= consistent.Confidence {
		t.Errorf("inconsistent answers should lower confidence: %v vs %v", inconsistent.Confidence, consistent.Confidence)
	}
	if ScoreObjective(SkillListening, nil).Confidence > 0.2 {
		t.Error("no evidence means very low confidence")
	}
}

func f(v float64) *float64 { return &v }

func writingTask(level string, criteria float64, words int) ProductiveTask {
	return ProductiveTask{
		Band: BandCore, Level: cefr.MustParse(level), Words: words, MinWords: 100,
		Criteria: map[string]*float64{"task_response": f(criteria), "grammar": f(criteria), "vocabulary": f(criteria), "coherence": f(criteria)},
	}
}

func TestScoreWriting(t *testing.T) {
	if got := ScoreWriting([]ProductiveTask{writingTask("B1", 60, 120)}); got.Level.String() != "B1" {
		t.Errorf("solid B1 task = %s", got.Level)
	}
	if got := ScoreWriting([]ProductiveTask{writingTask("B1", 90, 150)}); got.Level.String() != "B2" {
		t.Errorf("excellent B1 task = %s", got.Level)
	}
	short := ScoreWriting([]ProductiveTask{writingTask("B1", 90, 40)})
	if short.Score >= 70 || short.Level.Value() >= cefr.MustParse("B2").Value() {
		t.Errorf("length must cap a short answer: %+v", short)
	}
	if got := ScoreWriting([]ProductiveTask{writingTask("B1", 95, 5)}); got.Score > 10 {
		t.Errorf("a five-word answer cannot score above 10, got %v", got.Score)
	}
	if got := ScoreWriting([]ProductiveTask{{Band: BandCore, Level: cefr.MustParse("B1"), Missing: true}}); got.Level.String() != "A2" && got.Level.String() != "A1" {
		t.Errorf("missing task should estimate well below target, got %s", got.Level)
	}
}

func TestScoreWritingBlendsAIEstimateByConfidence(t *testing.T) {
	task := writingTask("B1", 60, 120)
	c1 := cefr.MustParse("C1")
	task.AIEstimate, task.AIConfidence = &c1, 1
	blended := ScoreWriting([]ProductiveTask{task})
	if blended.Level.Value() <= cefr.MustParse("B1").Value() {
		t.Errorf("a confident higher AI estimate should lift the level: %s", blended.Level)
	}
	if blended.Level.Value() > cefr.MustParse("B2").Value() {
		t.Errorf("the AI estimate is clamped and only half-weighted: %s", blended.Level)
	}
}

func TestScoreSpeakingRenormalisesUnavailablePronunciation(t *testing.T) {
	task := ProductiveTask{
		Band: BandCore, Level: cefr.MustParse("B1"), Words: 120, SpeechSeconds: 60, ExpectedSeconds: 45,
		Criteria: map[string]*float64{"fluency": f(60), "grammar": f(60), "vocabulary": f(60), "relevance": f(60), "pronunciation": nil},
	}
	got := ScoreSpeaking([]ProductiveTask{task})
	if got.Score != 60 {
		t.Errorf("score = %v, want 60 (weights renormalised)", got.Score)
	}
	if _, ok := got.Subscores["pronunciation"]; ok {
		t.Error("unavailable criteria must not appear as a subscore")
	}
	if u, _ := got.Evidence["unavailable_criteria"].([]string); len(u) != 1 || u[0] != "pronunciation" {
		t.Errorf("evidence should record unavailable criteria: %v", got.Evidence)
	}
}

func skill(name, level string, score, confidence float64, sub map[string]float64) SkillResult {
	if sub == nil {
		sub = map[string]float64{}
	}
	return SkillResult{Skill: name, Level: cefr.MustParse(level), Score: score, Confidence: confidence, Subscores: sub}
}

func TestCombine(t *testing.T) {
	o := Combine([]SkillResult{
		skill(SkillReading, "B2", 76, 0.8, map[string]float64{"comprehension": 78, "vocabulary": 72}),
		skill(SkillListening, "B1", 64, 0.8, nil),
		skill(SkillWriting, "A2+", 54, 0.7, map[string]float64{"grammar": 48, "vocabulary": 61, "coherence": 58, "task_response": 60}),
		skill(SkillSpeaking, "B1", 68, 0.6, nil),
	})
	if o.Level.String() != "B1" {
		t.Errorf("overall = %s, want B1", o.Level)
	}
	if !containsArea(o.Strengths, "skill", SkillReading) {
		t.Errorf("reading should be a strength: %+v", o.Strengths)
	}
	if !containsArea(o.FocusAreas, "skill", SkillWriting) || !containsArea(o.FocusAreas, "criterion", "writing.grammar") {
		t.Errorf("writing and writing.grammar should be focus areas: %+v", o.FocusAreas)
	}
	if !strings.Contains(o.Summary.Text, "grammar is limiting your writing") {
		t.Errorf("summary = %q", o.Summary.Text)
	}
	if strings.Contains(strings.ToLower(o.Summary.Text), "official") || strings.Contains(o.Summary.Text, "IELTS") {
		t.Error("summary must not claim an official certification")
	}
}

func TestCombineIsNotAPlainAverageAndCapsByWeakestSkill(t *testing.T) {
	o := Combine([]SkillResult{
		skill(SkillReading, "C1", 90, 0.9, nil),
		skill(SkillListening, "C1", 90, 0.9, nil),
		skill(SkillWriting, "C1", 90, 0.9, nil),
		skill(SkillSpeaking, "A1", 10, 0.9, nil),
	})
	if o.Level.Value() > cefr.MustParse("A2+").Value() {
		t.Errorf("one A1 skill must cap the overall level at A2+, got %s", o.Level)
	}

	lowConfidence := Combine([]SkillResult{
		skill(SkillReading, "B2", 80, 0.9, nil),
		skill(SkillWriting, "A2", 40, 0.2, nil),
	})
	if lowConfidence.Level.Value() < cefr.MustParse("B1+").Value() {
		t.Errorf("a low-confidence estimate should weigh less: %s", lowConfidence.Level)
	}
}

func containsArea(list []Area, typ, code string) bool {
	for _, a := range list {
		if a.Type == typ && a.Code == code {
			return true
		}
	}
	return false
}
