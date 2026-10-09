package practice

import (
	"strings"
	"testing"
)

func TestOpeningLine(t *testing.T) {
	if got := openingLine("free", "", "", false); !strings.Contains(got, "week") {
		t.Errorf("free chat with no topic: %q", got)
	}
	if got := openingLine("free", "Food from your country", "", false); !strings.Contains(got, "Food from your country") {
		t.Errorf("a topic title must be in the opener: %q", got)
	}
	if got := openingLine("part2", "", "Describe a book.", true); !strings.HasPrefix(got, "Here is your cue card.") || !strings.Contains(got, "Describe a book.") {
		t.Errorf("part 2 with a task: %q", got)
	}
	if got := openingLine("part1", "", "Describe your hometown.", true); got != "Describe your hometown." {
		t.Errorf("a published task speaks for itself: %q", got)
	}
	if liveMode("hack") != "free" || feedbackLang("ru") != "en" || feedbackLang("uz") != "uz" {
		t.Error("unknown modes and languages must fall back")
	}
	if got := cleanTopic("  a\n\tb  " + strings.Repeat("x", 300)); len([]rune(got)) != 120 || strings.ContainsAny(got, "\n\t") {
		t.Errorf("cleanTopic = %q", got)
	}
}
