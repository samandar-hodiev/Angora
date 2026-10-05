package vocabulary

import "testing"

func TestMastery(t *testing.T) {
	cases := []struct {
		status      string
		repetitions int
		want        int
	}{
		{"new", 0, 0},
		{"learning", 1, 30},
		{"reviewing", 2, 70},
		{"reviewing", 50, 95}, // capped below mastered
		{"mastered", 0, 100},
		{"unknown", 0, 0},
	}
	for _, tc := range cases {
		if got := Mastery(tc.status, tc.repetitions); got != tc.want {
			t.Errorf("Mastery(%q, %d) = %d, want %d", tc.status, tc.repetitions, got, tc.want)
		}
	}
}

func TestScheduleGrowsAndResets(t *testing.T) {
	s := SRSState{EaseFactor: 2.5}
	var status string
	s, status, _ = Schedule(s, 4)
	if s.IntervalDays != 1 || status != "learning" {
		t.Fatalf("first good review: got %d days, %s", s.IntervalDays, status)
	}
	s, _, _ = Schedule(s, 4)
	if s.IntervalDays != 3 {
		t.Fatalf("second good review: got %d days, want 3", s.IntervalDays)
	}
	s, status, _ = Schedule(s, 4)
	if s.IntervalDays < 7 || status != "reviewing" {
		t.Fatalf("third good review: got %d days, %s", s.IntervalDays, status)
	}
	for range 3 {
		s, status, _ = Schedule(s, 4)
	}
	if status != "mastered" {
		t.Fatalf("after six good reviews: got %s at %d days", status, s.IntervalDays)
	}
	s, status, wait := Schedule(s, 1)
	if s.Repetitions != 0 || s.IntervalDays != 0 || status != "learning" || wait != againDelay {
		t.Fatalf("again: got %+v %s %v", s, status, wait)
	}
	if s.EaseFactor < 1.3 {
		t.Fatalf("ease factor fell below 1.3: %v", s.EaseFactor)
	}
}

func TestScheduleEasyJumpsFurtherThanHard(t *testing.T) {
	easy, _, _ := Schedule(SRSState{EaseFactor: 2.5, IntervalDays: 10, Repetitions: 3}, 5)
	hard, _, _ := Schedule(SRSState{EaseFactor: 2.5, IntervalDays: 10, Repetitions: 3}, 3)
	if easy.IntervalDays <= hard.IntervalDays {
		t.Fatalf("easy %d days should be past hard %d days", easy.IntervalDays, hard.IntervalDays)
	}
}

func TestNormalizeTerms(t *testing.T) {
	got, err := NormalizeTerms([]string{"  Job ", "OCCUPATION"})
	if err != nil || got[0] != "job" || got[1] != "occupation" {
		t.Fatalf("got %v, %v", got, err)
	}
	if termsKey([]string{"occupation", "job"}) != termsKey([]string{"job", "occupation"}) {
		t.Fatal("the same words in another order must share a cache key")
	}
	for _, bad := range [][]string{{"job", "job"}, {"job", "kasb!"}, {"job", "1984"}, {"job", "работа"}} {
		if _, err := NormalizeTerms(bad); err == nil {
			t.Errorf("NormalizeTerms(%v) should fail", bad)
		}
	}
	if got, err := NormalizeTerms([]string{"look  after", "take care of"}); err != nil || got[0] != "look after" {
		t.Fatalf("phrases: got %v, %v", got, err)
	}
}

func TestAcceptsForm(t *testing.T) {
	cases := []struct {
		form, answer string
		want         bool
	}{
		{"went", "went", true},
		{"went", " Went ", true},
		{"learnt / learned", "learned", true},
		{"learnt / learned", "learnt", true},
		{"was / were", "was/were", true},
		{"was / were", "were", true},
		{"got / gotten", "gotten", true},
		{"gone", "goed", false},
		{"gone", "", false},
	}
	for _, tc := range cases {
		if got := AcceptsForm(tc.form, tc.answer); got != tc.want {
			t.Errorf("AcceptsForm(%q, %q) = %v, want %v", tc.form, tc.answer, got, tc.want)
		}
	}
}
