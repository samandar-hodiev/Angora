package grammar

import "testing"

func answers(n int, score, difficulty, ageDays float64, produced bool) []AnswerSignal {
	out := make([]AnswerSignal, n)
	for i := range out {
		out[i] = AnswerSignal{Score: score, Difficulty: difficulty, AgeDays: ageDays, Produced: produced}
	}
	return out
}

// The headline rule: one good quiz is not mastery. A learner who aces ten questions once,
// having never used the form in their own English, should be "developing", not "mastered".
func TestOneGoodQuizIsNotMastery(t *testing.T) {
	got := ComputeMastery(MasterySignals{
		Opened:   true,
		Answers:  answers(10, 1, 0.4, 0, false),
		Attempts: 1,
	})
	if got.State == StateMastered {
		t.Errorf("a single perfect quiz gave %q; mastery needs repetition and application", got.State)
	}
	if got.Practice < 90 {
		t.Errorf("practice = %v, want high after a perfect run", got.Practice)
	}
	if got.Application != 0 {
		t.Errorf("application = %v, want 0 with no real use", got.Application)
	}
}

func TestMasteryNeedsAllThreeSignals(t *testing.T) {
	got := ComputeMastery(MasterySignals{
		Opened: true, ExplanationRead: true, VisualViewed: true,
		Answers:      answers(12, 1, 0.6, 2, true),
		Applications: []ApplicationSignal{{Score: 1, AgeDays: 1}, {Score: 0.9, AgeDays: 3}},
		Attempts:     3,
	})
	if got.State != StateMastered {
		t.Errorf("state = %q, want mastered with understanding, practice and application", got.State)
	}
	if got.Mastery < masteredScore {
		t.Errorf("mastery = %v, want >= %v", got.Mastery, masteredScore)
	}
}

func TestStatesProgress(t *testing.T) {
	if got := ComputeMastery(MasterySignals{}); got.State != StateNotStarted {
		t.Errorf("empty = %q, want not_started", got.State)
	}
	if got := ComputeMastery(MasterySignals{Opened: true}); got.State != StateLearning {
		t.Errorf("opened only = %q, want learning", got.State)
	}
	practicing := ComputeMastery(MasterySignals{
		Opened: true, Answers: answers(6, 0.3, 0.4, 1, false), Attempts: 1,
	})
	if practicing.State != StatePracticing {
		t.Errorf("weak practice = %q, want practicing", practicing.State)
	}
}

// Grammar you have not touched in months is not grammar you still have — but a learner
// coming back after a break should not find their progress erased either.
func TestMasteryDecaysWithinBounds(t *testing.T) {
	base := MasterySignals{
		Opened: true, ExplanationRead: true,
		Answers:  answers(10, 1, 0.5, 0, true),
		Attempts: 2,
	}
	fresh := ComputeMastery(base)

	base.DaysSinceLastPractice = 10
	if grace := ComputeMastery(base); grace.Practice != fresh.Practice {
		t.Errorf("practice fell within the grace period: %v → %v", fresh.Practice, grace.Practice)
	}

	base.DaysSinceLastPractice = 400
	stale := ComputeMastery(base)
	if stale.Practice >= fresh.Practice {
		t.Errorf("practice did not decay after a year: %v → %v", fresh.Practice, stale.Practice)
	}
	if floor := fresh.Practice * (1 - maxDecay); stale.Practice < floor-0.01 {
		t.Errorf("practice decayed to %v, below the floor %v", stale.Practice, floor)
	}
}

// A topic the learner keeps getting wrong in their own writing is not a practised topic,
// however well the last quiz went.
func TestRecurringErrorsPullPracticeDown(t *testing.T) {
	base := MasterySignals{Opened: true, Answers: answers(10, 1, 0.5, 0, false), Attempts: 2}
	clean := ComputeMastery(base)

	base.ErrorSeverity = 100
	withErrors := ComputeMastery(base)
	if withErrors.Practice >= clean.Practice {
		t.Errorf("errors did not reduce practice: %v → %v", clean.Practice, withErrors.Practice)
	}
	if withErrors.State == StateMastered {
		t.Error("a topic with severe recurring errors should not be mastered")
	}
}

// Harder questions, and questions where the learner produced the form rather than
// recognising it, should count for more.
func TestDifficultyAndProductionRaiseWeight(t *testing.T) {
	easyRecognised := ComputeMastery(MasterySignals{
		Opened: true, Attempts: 1,
		Answers: append(answers(5, 1, 0.1, 0, false), answers(5, 0, 0.9, 0, true)...),
	})
	hardProduced := ComputeMastery(MasterySignals{
		Opened: true, Attempts: 1,
		Answers: append(answers(5, 0, 0.1, 0, false), answers(5, 1, 0.9, 0, true)...),
	})
	if hardProduced.Practice <= easyRecognised.Practice {
		t.Errorf("getting the hard, produced questions right scored %v, not more than %v",
			hardProduced.Practice, easyRecognised.Practice)
	}
}

func TestRecentAnswersOutweighOldOnes(t *testing.T) {
	improving := ComputeMastery(MasterySignals{
		Opened: true, Attempts: 2,
		Answers: append(answers(8, 1, 0.5, 0, false), answers(8, 0, 0.5, 90, false)...),
	})
	declining := ComputeMastery(MasterySignals{
		Opened: true, Attempts: 2,
		Answers: append(answers(8, 0, 0.5, 0, false), answers(8, 1, 0.5, 90, false)...),
	})
	if improving.Practice <= declining.Practice {
		t.Errorf("recent success scored %v, not more than old success %v",
			improving.Practice, declining.Practice)
	}
}

func TestMasteryStaysInRange(t *testing.T) {
	extreme := ComputeMastery(MasterySignals{
		Opened: true, ExplanationRead: true, VisualViewed: true,
		Answers:      answers(60, 5, 2, -10, true), // nonsense input from a bad caller
		Applications: []ApplicationSignal{{Score: 9, AgeDays: 0}},
		Attempts:     99, ErrorSeverity: 500,
	})
	for name, v := range map[string]float64{
		"mastery": extreme.Mastery, "understanding": extreme.Understanding,
		"practice": extreme.Practice, "application": extreme.Application,
	} {
		if v < 0 || v > 100 {
			t.Errorf("%s = %v, outside 0..100", name, v)
		}
	}
}
