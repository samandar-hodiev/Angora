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
