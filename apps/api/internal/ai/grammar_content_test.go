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
	var root map[string]any
	if err := json.Unmarshal(grammarContentSchema, &root); err != nil {
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
