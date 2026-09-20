package grammar

import "testing"

func q(qType string, payload QuestionPayload, answer Answer) Question {
	return Question{Type: qType, Payload: payload, answer: answer}
}

func idx(i int) *int { return &i }

func TestScoreChoice(t *testing.T) {
	question := q(TypeMultipleChoice, QuestionPayload{Options: []string{"go", "went", "gone", "going"}},
		Answer{CorrectIndex: idx(1)})

	if mark := Score(question, Response{Index: idx(1)}); !mark.Correct || mark.Score != 1 {
		t.Errorf("correct choice = %+v", mark)
	}
	if mark := Score(question, Response{Index: idx(0)}); mark.Correct {
		t.Error("wrong choice marked correct")
	}
	// No answer at all is wrong, not an error.
	if mark := Score(question, Response{}); mark.Correct || mark.Expected != "went" {
		t.Errorf("missing choice = %+v, want wrong with expected went", mark)
	}
}

func TestScoreTextForgivesFormattingButNotForm(t *testing.T) {
	question := q(TypeFillBlank, QuestionPayload{Hint: "go"}, Answer{Accepted: []string{"didn't go", "did not go"}})

	same := []string{"didn't go", "Didn't go", "  didn't   go  ", "didn’t go", "didn't go."}
	for _, in := range same {
		if mark := Score(question, Response{Text: in}); !mark.Correct {
			t.Errorf("Score(%q) should be correct", in)
		}
	}
	// A second accepted form is just as right.
	if mark := Score(question, Response{Text: "did not go"}); !mark.Correct {
		t.Error("alternative accepted answer marked wrong")
	}
	// The whole point of the question: a different verb form is wrong.
	for _, in := range []string{"didn't went", "don't go", "didnt go", ""} {
		if mark := Score(question, Response{Text: in}); mark.Correct {
			t.Errorf("Score(%q) should be wrong", in)
		}
	}
}

func TestScoreOrdering(t *testing.T) {
	want := []string{"I", "went", "to", "the", "cinema"}
	question := q(TypeOrdering, QuestionPayload{Segments: want}, Answer{Order: want})

	if mark := Score(question, Response{Order: want}); !mark.Correct {
		t.Error("correct order marked wrong")
	}
	if mark := Score(question, Response{Order: []string{"went", "I", "to", "the", "cinema"}}); mark.Correct {
		t.Error("wrong order marked correct")
	}
	if mark := Score(question, Response{Order: []string{"I", "went"}}); mark.Correct {
		t.Error("short answer marked correct")
	}
}

// Matching gives partial credit: three pairs of four right is not the same as none right,
// and a learner who sees 0 for a near miss stops trusting the score.
func TestScoreMatchingIsPartial(t *testing.T) {
	question := q(TypeMatching,
		QuestionPayload{Left: []string{"go", "buy", "see", "write"}, Right: []string{"went", "bought", "saw", "wrote"}},
		Answer{Pairs: map[string]int{"0": 0, "1": 1, "2": 2, "3": 3}})

	full := Score(question, Response{Pairs: map[string]int{"0": 0, "1": 1, "2": 2, "3": 3}})
	if !full.Correct || full.Score != 1 {
		t.Errorf("all pairs = %+v", full)
	}

	partial := Score(question, Response{Pairs: map[string]int{"0": 0, "1": 1, "2": 2, "3": 0}})
	if partial.Correct {
		t.Error("three of four should not be fully correct")
	}
	if partial.Score != 0.75 {
		t.Errorf("three of four = %v, want 0.75", partial.Score)
	}

	if none := Score(question, Response{Pairs: map[string]int{}}); none.Score != 0 {
		t.Errorf("no pairs = %v, want 0", none.Score)
	}
}

// Free writing is the one type the engine hands to an AI model, and the only one.
func TestFreeWritingNeedsAI(t *testing.T) {
	if mark := Score(q(TypeFreeWriting, QuestionPayload{MinWords: 25}, Answer{}), Response{Text: "I went home."}); !mark.NeedsAI {
		t.Error("free writing should be routed to AI")
	}
	for _, deterministic := range []string{TypeMultipleChoice, TypeFillBlank, TypeOrdering,
		TypeErrorCorrection, TypeTransformation, TypeMatching, TypeShortAnswer, TypeContextual} {
		if mark := Score(q(deterministic, QuestionPayload{}, Answer{}), Response{}); mark.NeedsAI {
			t.Errorf("%s should be scored without AI", deterministic)
		}
	}
}

func TestNormalizeAnswerKeepsWordsIntact(t *testing.T) {
	// Apostrophes and hyphens are part of English words and must survive normalisation,
	// or "don't" and "do not" would both collapse to "dont".
	cases := map[string]string{
		"Didn't go.":    "didn't go",
		"  well-known ": "well-known",
		"I went!":       "i went",
		"He said:":      "he said",
	}
	for in, want := range cases {
		if got := normalizeAnswer(in); got != want {
			t.Errorf("normalizeAnswer(%q) = %q, want %q", in, got, want)
		}
	}
}
