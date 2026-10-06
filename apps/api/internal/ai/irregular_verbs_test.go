package ai

import "testing"

func TestIsIrregular(t *testing.T) {
	for _, tc := range []struct {
		base, past, pp string
		want           bool
	}{
		{"go", "went", "gone", true},
		{"cut", "cut", "cut", true},
		{"learn", "learnt / learned", "learnt / learned", true},
		{"work", "worked", "worked", false},
		{"like", "liked", "liked", false},
		{"study", "studied", "studied", false},
		{"stop", "stopped", "stopped", false},
		{"show", "showed", "shown", true},
	} {
		if got := IsIrregular(tc.base, tc.past, tc.pp); got != tc.want {
			t.Errorf("IsIrregular(%s, %s, %s) = %v, want %v", tc.base, tc.past, tc.pp, got, tc.want)
		}
	}
}

func TestVerbPattern(t *testing.T) {
	for _, tc := range []struct{ base, past, pp, want string }{
		{"cut", "cut", "cut", "AAA"},
		{"buy", "bought", "bought", "ABB"},
		{"come", "came", "come", "ABA"},
		{"go", "went", "gone", "ABC"},
		{"get", "got", "got / gotten", "ABB"},
	} {
		if got := VerbPattern(tc.base, tc.past, tc.pp); got != tc.want {
			t.Errorf("VerbPattern(%s) = %s, want %s", tc.base, got, tc.want)
		}
	}
}
