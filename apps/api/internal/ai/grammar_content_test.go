package ai

import (
	"encoding/json"
	"testing"

	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

// OpenAI's strict structured output rejects a schema outright if any object omits
// additionalProperties:false or leaves a property out of `required`. A rejected request is
// not a worse generation — it is no generation at all — so the shape is asserted here.
func TestGrammarContentSchemaIsStrictModeSafe(t *testing.T) {
	assertStrictSchema(t, grammarContentSchema)
}

func TestGrammarPracticeSchemaIsStrictModeSafe(t *testing.T) {
	assertStrictSchema(t, grammarPracticeSchema)
}

func assertStrictSchema(t *testing.T, schema json.RawMessage) {
	t.Helper()
	var root map[string]any
	if err := json.Unmarshal(schema, &root); err != nil {
		t.Fatalf("schema is not valid JSON: %v", err)
	}

	var check func(path string, node map[string]any)
	check = func(path string, node map[string]any) {
		if node["type"] == "object" {
			if node["additionalProperties"] != false {
				t.Errorf("%s: additionalProperties must be false", path)
			}
			props, _ := node["properties"].(map[string]any)
			required := map[string]bool{}
			if list, ok := node["required"].([]any); ok {
				for _, r := range list {
					if name, ok := r.(string); ok {
						required[name] = true
					}
				}
			}
			for name := range props {
				if !required[name] {
					t.Errorf("%s: property %q is not in required", path, name)
				}
			}
			for name, child := range props {
				if c, ok := child.(map[string]any); ok {
					check(path+"."+name, c)
				}
			}
		}
		if items, ok := node["items"].(map[string]any); ok {
			check(path+"[]", items)
		}
	}
	check("root", root)
}

func levels(codes ...string) []cefr.Level {
	out := make([]cefr.Level, 0, len(codes))
	for _, code := range codes {
		out = append(out, cefr.MustParse(code))
	}
	return out
}

func TestValidateAuthoredContentKeepsAnHonestRefusal(t *testing.T) {
	// A model that says "this topic does not belong at A1" is doing its job. Filler would
	// be worse than an empty level, so the refusal is kept as an answer.
	out := &GeneratedGrammarContent{Levels: []GeneratedGrammarLevel{
		{Level: "A1", Applicable: false, Reason: "Inversion needs structures an A1 learner has not met."},
		{Level: "C1", Applicable: true, Explanation: "Inversion fronts a negative adverbial.",
			Examples: []GeneratedExample{{Text: "Never had I seen such a thing."}}},
	}}
	if err := validateAuthoredContent(out, GrammarAuthorRequest{Levels: levels("A1", "C1")}); err != nil {
		t.Fatalf("validateAuthoredContent: %v", err)
	}
	if len(out.Levels) != 2 {
		t.Fatalf("levels = %d, want the refusal kept alongside the written level", len(out.Levels))
	}
}

func TestValidateAuthoredContentRejectsAnEmptyApplicableLevel(t *testing.T) {
	// "Applicable" with nothing in it is a page with a title and no lesson.
	out := &GeneratedGrammarContent{Levels: []GeneratedGrammarLevel{
		{Level: "B1", Applicable: true, Title: "Present Perfect"},
	}}
	if err := validateAuthoredContent(out, GrammarAuthorRequest{Levels: levels("B1")}); err == nil {
		t.Fatal("an applicable level with no explanation should be refused")
	}
}

func TestValidateAuthoredContentRejectsAnExplanationWithNothingToShow(t *testing.T) {
	out := &GeneratedGrammarContent{Levels: []GeneratedGrammarLevel{
		{Level: "B1", Applicable: true, Explanation: "It is used for experience."},
	}}
	if err := validateAuthoredContent(out, GrammarAuthorRequest{Levels: levels("B1")}); err == nil {
		t.Fatal("a level with neither examples nor formulas should be refused")
	}
}

func TestValidateAuthoredContentDropsUnmarkableQuestions(t *testing.T) {
	out := &GeneratedGrammarContent{Levels: []GeneratedGrammarLevel{{
		Level: "B1", Applicable: true, Explanation: "x",
		Examples: []GeneratedExample{{Text: "I have finished."}},
		Practice: []GeneratedPractice{
			{Prompt: "Pick one", Options: []string{"have", "has"}, AnswerIndex: 0},
			// Points past its own options: would mark a correct learner wrong.
			{Prompt: "Bad", Options: []string{"a", "b"}, AnswerIndex: 7},
			// Negative index, same problem from the other end.
			{Prompt: "Worse", Options: []string{"a", "b"}, AnswerIndex: -1},
			// One option is not a choice.
			{Prompt: "Lonely", Options: []string{"a"}, AnswerIndex: 0},
			{Prompt: "", Options: []string{"a", "b"}, AnswerIndex: 1},
		},
	}}}
	if err := validateAuthoredContent(out, GrammarAuthorRequest{Levels: levels("B1")}); err != nil {
		t.Fatalf("validateAuthoredContent: %v", err)
	}
	practice := out.Levels[0].Practice
	if len(practice) != 1 || practice[0].Prompt != "Pick one" {
		t.Errorf("practice = %+v, want only the one question that can be marked", practice)
	}
}

func TestValidateAuthoredContentIgnoresLevelsNobodyAskedFor(t *testing.T) {
	out := &GeneratedGrammarContent{Levels: []GeneratedGrammarLevel{
		{Level: "B1", Applicable: true, Explanation: "x", Examples: []GeneratedExample{{Text: "y"}}},
		{Level: "C2", Applicable: true, Explanation: "x", Examples: []GeneratedExample{{Text: "y"}}},
	}}
	if err := validateAuthoredContent(out, GrammarAuthorRequest{Levels: levels("B1")}); err != nil {
		t.Fatal(err)
	}
	if len(out.Levels) != 1 || out.Levels[0].Level != "B1" {
		t.Errorf("levels = %+v, want only the requested one", out.Levels)
	}
}

func TestAuthorInstructionsKeepExamplesInEnglish(t *testing.T) {
	// The learner is learning English; an Uzbek explanation with Uzbek example sentences
	// teaches nothing.
	for _, language := range []string{"uz", "ru"} {
		got := authorInstructions(GrammarAuthorRequest{Language: language})
		if !contains(got, "English example sentence in English") {
			t.Errorf("%s instructions do not pin example sentences to English", language)
		}
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && (func() bool {
		for i := 0; i+len(needle) <= len(haystack); i++ {
			if haystack[i:i+len(needle)] == needle {
				return true
			}
		}
		return false
	})()
}

func TestUsablePracticeKeepsBothKinds(t *testing.T) {
	got := UsablePractice([]GeneratedPractice{
		{Type: "multiple_choice", Prompt: "She ___ here.", Options: []string{"live", "lives"}, AnswerIndex: 1, Accepted: []string{"x"}},
		{Type: "fill_blank", Prompt: "He ___ (go) home.", Accepted: []string{" goes ", ""}, Hint: " (go) ", Options: []string{"a"}, AnswerIndex: 0},
		// No gap: nowhere to type the answer.
		{Type: "fill_blank", Prompt: "He goes home.", Accepted: []string{"goes"}},
		// Two gaps: one box cannot fill both.
		{Type: "fill_blank", Prompt: "He ___ home ___.", Accepted: []string{"goes"}},
		// Nothing accepted: no answer could ever be right.
		{Type: "fill_blank", Prompt: "He ___ home.", Accepted: []string{"  "}},
		{Type: "multiple_choice", Prompt: "Pick", Options: []string{"a", "b"}, AnswerIndex: 2},
	})
	if len(got) != 2 {
		t.Fatalf("kept %d questions, want 2: %+v", len(got), got)
	}
	if got[0].Type != PracticeMultipleChoice || len(got[0].Accepted) != 0 {
		t.Errorf("choice = %+v, want its gap fields cleared", got[0])
	}
	gap := got[1]
	if !gap.IsFillBlank() || len(gap.Accepted) != 1 || gap.Accepted[0] != "goes" || gap.Hint != "(go)" {
		t.Errorf("gap = %+v, want accepted [goes] and hint (go)", gap)
	}
	if len(gap.Options) != 0 || gap.AnswerIndex != -1 {
		t.Errorf("gap = %+v, want its choice fields cleared", gap)
	}
}

func TestUsablePracticeDropsDuplicateOptions(t *testing.T) {
	got := UsablePractice([]GeneratedPractice{
		{Prompt: "Which is correct?", Options: []string{"He is an teacher.", "He is a teacher.", "He is a teacher"}, AnswerIndex: 1},
	})
	if len(got) != 0 {
		t.Errorf("kept %+v, want a question with the same option twice dropped", got)
	}
}

func TestGrammarSpeakingTaskSchemaIsStrictModeSafe(t *testing.T) {
	assertStrictSchema(t, grammarSpeakingTaskSchema)
}

func TestGrammarPracticeCheckSchemaIsStrictModeSafe(t *testing.T) {
	assertStrictSchema(t, grammarPracticeCheckSchema)
}

func TestAgreedPracticeDropsWhatTheCheckDisputes(t *testing.T) {
	questions := []GeneratedPractice{
		{Type: PracticeMultipleChoice, Prompt: "He gave me ___ one-time offer.", Options: []string{"a", "an"}, AnswerIndex: 1},
		{Type: PracticeMultipleChoice, Prompt: "I ate ___ egg.", Options: []string{"a", "an"}, AnswerIndex: 1},
		{Type: PracticeFillBlank, Prompt: "She is ___ honest person.", Accepted: []string{"an"}},
		{Type: PracticeFillBlank, Prompt: "I need ___ hour.", Accepted: []string{"an"}},
		{Type: PracticeFillBlank, Prompt: "It is ___ historic day.", Accepted: []string{"a"}},
		{Type: PracticeFillBlank, Prompt: "I want to eat ___ banana.", Accepted: []string{"a", "an"}},
	}
	var check practiceCheck
	_ = json.Unmarshal([]byte(`{"answers":[
		{"index":1,"answer_index":0,"answer_text":"","ambiguous":false},
		{"index":2,"answer_index":1,"answer_text":"","ambiguous":false},
		{"index":6,"answer_index":-1,"answer_text":"a","acceptable":[],"ambiguous":false},
		{"index":3,"answer_index":-1,"answer_text":"An.","ambiguous":false},
		{"index":4,"answer_index":-1,"answer_text":"a","ambiguous":false},
		{"index":5,"answer_index":-1,"answer_text":"a","ambiguous":true}
	]}`), &check)
	got := agreedPractice(questions, check)
	if len(got) != 3 || got[0].Prompt != "I ate ___ egg." || got[1].Prompt != "She is ___ honest person." {
		t.Fatalf("kept %+v, want the egg, honest and banana questions only", got)
	}
	if banana := got[2]; len(banana.Accepted) != 1 || banana.Accepted[0] != "a" {
		t.Errorf("banana accepts %v, want only the answer both sides agree on", banana.Accepted)
	}
}

func TestUsablePracticeNormalisesTheGap(t *testing.T) {
	got := UsablePractice([]GeneratedPractice{{Type: PracticeFillBlank, Prompt: "He ______ home.", Accepted: []string{"went"}}})
	if len(got) != 1 || got[0].Prompt != "He ___ home." {
		t.Errorf("got %+v, want the long gap drawn as ___", got)
	}
}

func TestValidateAuthoredContentDropsOneEmptyLevelAndKeepsTheRest(t *testing.T) {
	// One sloppy level must not cost the owner the five good ones and their translations.
	out := &GeneratedGrammarContent{Levels: []GeneratedGrammarLevel{
		{Level: "B1", Applicable: true, Explanation: "Experience up to now.", Examples: []GeneratedExample{{Text: "I have been there."}}},
		{Level: "C2", Applicable: true, Title: "Present Perfect"},
	}}
	if err := validateAuthoredContent(out, GrammarAuthorRequest{Levels: levels("B1", "C2")}); err != nil {
		t.Fatalf("validateAuthoredContent: %v", err)
	}
	if len(out.Levels) != 1 || out.Levels[0].Level != "B1" {
		t.Errorf("levels = %+v, want B1 kept", out.Levels)
	}
	if len(out.Dropped) != 1 || out.Dropped[0] != "C2" {
		t.Errorf("dropped = %v, want [C2] named so the owner knows", out.Dropped)
	}
}

func TestAgreedPracticeDropsAGapThatAllowsAnUnkeyedAnswer(t *testing.T) {
	// "Look at ___ picture" takes this or that; keyed to "this" alone, a learner who typed
	// "that" would be marked wrong for correct English.
	questions := []GeneratedPractice{{Type: PracticeFillBlank, Prompt: "Look at ___ picture on the wall.", Accepted: []string{"this"}}}
	var check practiceCheck
	_ = json.Unmarshal([]byte(`{"answers":[{"index":1,"answer_index":-1,"answer_text":"this","acceptable":["that"],"ambiguous":false}]}`), &check)
	if got := agreedPractice(questions, check); len(got) != 0 {
		t.Errorf("kept %+v, want the open gap dropped", got)
	}
}
