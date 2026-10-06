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

func TestCloseEnough(t *testing.T) {
	if !closeEnough("vakting bor", "vaqting bor") {
		t.Error("a letter fixed is a correction")
	}
	if closeEnough("vaqt", "boʻsh vaqt boʻlishi kerak") {
		t.Error("a rewrite is not a correction")
	}
}

func TestNormalizeUzbek(t *testing.T) {
	for in, want := range map[string]string{
		"rаsmiy uchrashuv":         "rasmiy uchrashuv", // a Cyrillic а
		"rəsmi ravishda":           "rasmi ravishda",
		"kimdandır":                "kimdandir",
		"koʻp, togʻ, maʼno, o‘zim": "ko'p, tog', ma'no, o'zim",
		"расстраивать":             "расстраивать", // Russian stays Russian
	} {
		if got := NormalizeUzbek(in); got != want {
			t.Errorf("NormalizeUzbek(%q) = %q, want %q", in, got, want)
		}
	}
	if latinOnly("Bo‘yин") {
		t.Error("Cyrillic inside a Latin word must be caught")
	}
}
