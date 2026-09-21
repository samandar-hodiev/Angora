package practice

import "testing"

// Marking is the part of practice that must never drift: a learner's score has to be the
// same today and after any refactor, and it must never depend on a model.

func TestMarkOptionQuestions(t *testing.T) {
	q := Question{ID: "q1", Key: Key{OptionID: "b"}}

	if m := MarkOne(q, Answer{OptionID: "b"}, true); !m.Correct {
		t.Error("the keyed option must be marked correct")
	}
	if m := MarkOne(q, Answer{OptionID: "a"}, true); m.Correct {
		t.Error("another option must be marked wrong")
	}
	if m := MarkOne(q, Answer{}, false); m.Correct || m.Answered {
		t.Error("an unanswered question is wrong and must be reported as unanswered")
	}
	if m := MarkOne(q, Answer{Text: "b"}, true); m.Correct {
		t.Error("text must not satisfy an option-keyed question")
	}
}

func TestMarkTextQuestions(t *testing.T) {
	q := Question{ID: "q2", Key: Key{Text: "the National Museum", Accept: []string{"National Museum"}}}

	for _, given := range []string{"the National Museum", "  the national museum  ", "the  national   museum", "the national museum."} {
		if m := MarkOne(q, Answer{Text: given}, true); !m.Correct {
			t.Errorf("%q should be accepted: case, spacing and sentence punctuation are not what is being tested", given)
		}
	}
	if m := MarkOne(q, Answer{Text: "National Museum"}, true); !m.Correct {
		t.Error("an explicitly accepted alternative must be correct")
	}
	// Spelling is part of the answer in a gap-fill, so this stays wrong on purpose.
	if m := MarkOne(q, Answer{Text: "the National Musem"}, true); m.Correct {
		t.Error("a misspelling must not be accepted")
	}
	if m := MarkOne(q, Answer{Text: "   "}, true); m.Correct {
		t.Error("whitespace is not an answer")
	}
}

func TestScoreCountsEveryQuestion(t *testing.T) {
	questions := []Question{
		{ID: "a", Key: Key{OptionID: "x"}},
		{ID: "b", Key: Key{OptionID: "y"}},
		{ID: "c", Key: Key{Text: "cat"}},
		{ID: "d", Key: Key{OptionID: "z"}},
	}
	// Three answered, one wrong, one left blank.
	answers := map[string]Answer{
		"a": {OptionID: "x"},
		"b": {OptionID: "wrong"},
		"c": {Text: "Cat"},
	}

	result := Score(questions, answers)
	if result.Total != 4 {
		t.Errorf("total = %d, want 4 — unanswered questions still count", result.Total)
	}
	if result.Correct != 2 {
		t.Errorf("correct = %d, want 2", result.Correct)
	}
	if result.Score != 50 {
		t.Errorf("score = %v, want 50", result.Score)
	}
	if len(result.Marks) != 4 {
		t.Fatalf("marks = %d, want one per question", len(result.Marks))
	}
	if result.Marks[3].Answered {
		t.Error("the blank question must be reported as unanswered")
	}
}

func TestScoreIsStable(t *testing.T) {
	questions := []Question{{ID: "a", Key: Key{OptionID: "x"}}, {ID: "b", Key: Key{OptionID: "y"}}, {ID: "c", Key: Key{OptionID: "z"}}}
	answers := map[string]Answer{"a": {OptionID: "x"}, "b": {OptionID: "y"}, "c": {OptionID: "wrong"}}

	first := Score(questions, answers)
	for i := 0; i < 20; i++ {
		again := Score(questions, answers)
		if again.Score != first.Score || again.Correct != first.Correct {
			t.Fatal("the same submission produced a different score")
		}
	}
	if first.Score != 66.67 {
		t.Errorf("score = %v, want 66.67 (2 of 3)", first.Score)
	}
}

func TestScoreEmptyAttempt(t *testing.T) {
	result := Score(nil, nil)
	if result.Total != 0 || result.Correct != 0 || result.Score != 0 {
		t.Errorf("an attempt with no questions must score zero, got %+v", result)
	}
}
