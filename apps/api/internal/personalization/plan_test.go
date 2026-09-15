package personalization

import (
	"testing"

	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

func TestGenerateFromAssessmentFocus(t *testing.T) {
	plan := Generate(Input{
		Level: cefr.MustParse("B1"), DailyMinutes: 40, Goals: []string{GoalSpeakConfidently},
		FocusAreas:        []Area{{Type: "skill", Code: "writing"}, {Type: "criterion", Code: "writing.grammar"}},
		MistakeCategories: []string{"vocabulary.word_choice", "grammar.tense.past_simple"},
	})

	if len(plan.Items) != 4 {
		t.Fatalf("40 minutes should give 4 items, got %d", len(plan.Items))
	}
	if plan.Items[0].Skill != "writing" || plan.Items[0].ReasonCode != "weakness" {
		t.Errorf("weak skill first: %+v", plan.Items[0])
	}
	if plan.Items[1].Skill != "grammar" || plan.Items[1].Title != "Past tense practice" {
		t.Errorf("grammar focus from mistakes second: %+v", plan.Items[1])
	}
	if plan.Items[2].Skill != "speaking" || plan.Items[2].ReasonCode != "goal" {
		t.Errorf("goal skill next: %+v", plan.Items[2])
	}
	total := 0
	for i, item := range plan.Items {
		total += item.Minutes
		if item.Position != i+1 || item.Title == "" || item.ActivityCode == "" {
			t.Errorf("incomplete item: %+v", item)
		}
	}
	if total != 40 {
		t.Errorf("minutes add up to %d, want 40", total)
	}
	if plan.TargetLevel.String() != "B2" {
		t.Errorf("target = %s", plan.TargetLevel)
	}
}

func TestGenerateManualLevelWithoutAssessment(t *testing.T) {
	plan := Generate(Input{Level: cefr.MustParse("A2"), DailyMinutes: 10, Goals: []string{GoalTravel}})
	if len(plan.Items) != 2 || plan.Items[0].Skill != "speaking" || plan.Items[0].Minutes != 5 {
		t.Fatalf("plan = %+v", plan.Items)
	}
	if plan.Items[0].Title != "Travel conversations" {
		t.Errorf("A-level travel goal title = %q", plan.Items[0].Title)
	}
}

func TestGenerateDefaults(t *testing.T) {
	plan := Generate(Input{})
	if plan.Goal != GoalImproveEnglish || plan.DailyMinutes != 15 || len(plan.Items) != 2 {
		t.Errorf("defaults = %+v", plan)
	}
	if got := Generate(Input{Level: cefr.MustParse("B2"), DailyMinutes: 30, Goals: []string{GoalIELTS}}); got.Items[0].Title != "IELTS-style writing practice" {
		t.Errorf("IELTS goal at B2 = %+v", got.Items[0])
	}
}
