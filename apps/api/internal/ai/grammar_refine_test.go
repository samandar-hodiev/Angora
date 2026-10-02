package ai

import (
	"strings"
	"testing"
)

func TestUntranslated(t *testing.T) {
	source := GeneratedGrammarLevel{
		Applicable: true, Intro: "We use can for ability.", Explanation: "Can is followed by the base verb.",
		Examples:       []GeneratedExample{{Text: "I can swim."}},
		CommonMistakes: []GeneratedMistake{{Wrong: "I can to swim.", Right: "I can swim.", Why: "No 'to' after can."}},
	}

	translated := source
	translated.Intro = "Can qobiliyat uchun ishlatiladi."
	translated.Explanation = "Can dan keyin fe'lning asosiy shakli keladi."
	translated.CommonMistakes = []GeneratedMistake{{Wrong: "I can to swim.", Right: "I can swim.", Why: "Can dan keyin 'to' kelmaydi."}}
	if untranslated(source, translated) {
		t.Error("a real translation with English examples kept as they are must pass")
	}

	if !untranslated(source, source) {
		t.Error("the source handed back unchanged must be caught")
	}

	half := translated
	half.CommonMistakes = source.CommonMistakes
	if !untranslated(source, half) {
		t.Error("a mistake explanation left in English must be caught")
	}

	refused := GeneratedGrammarLevel{Applicable: false}
	if untranslated(GeneratedGrammarLevel{}, refused) {
		t.Error("a level the model refused has no prose to check")
	}
}

func TestDefaultVisualKind(t *testing.T) {
	cases := map[string]string{
		"Tenses": "timeline", "Articles": "rule_diagram", "Comparisons": "comparison_table",
		"Conditionals": "transformation", "Passive": "transformation", "Nouns": "rule_diagram", "": "rule_diagram",
	}
	for category, want := range cases {
		if got := DefaultVisualKind(category); got != want {
			t.Errorf("%q: kind = %q, want %q — a time line only explains grammar about time", category, got, want)
		}
	}
}

func TestThemeSVG(t *testing.T) {
	in := []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" font-family="inherit"><title>A / An</title><rect fill="var(--surface)"/><text fill="var( --primary, red )">a cat</text><text fill="var(--unknown)">x</text></svg>`)
	out := string(ThemeSVG(in))
	if strings.Contains(out, "<style") {
		t.Error("the API's CSP blocks a stylesheet inside the SVG; colours must be attributes")
	}
	if strings.Contains(out, `font-family="inherit"`) {
		t.Error("inherit has nothing to inherit from inside an image and falls back to Times")
	}
	if !strings.HasPrefix(out, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" color="#0f172a" font-family="Inter`) {
		t.Fatalf("the root must carry the text colour and font, got %q", out)
	}
	if strings.Contains(out, "var(") {
		t.Errorf("var() left in an image paints black: %q", out)
	}
	for _, want := range []string{`fill="#e2f5ec"`, `fill="#059669"`, `fill="currentColor"`, `<rect x="0" y="0" width="100%"`, "<title>A / An</title>"} {
		if !strings.Contains(out, want) {
			t.Errorf("themed SVG is missing %q", want)
		}
	}
	if err := ValidateSVG(out); err != nil {
		t.Errorf("a themed SVG must still pass validation: %v", err)
	}
	if string(ThemeSVG([]byte("not an svg"))) != "not an svg" {
		t.Error("anything that is not an SVG is passed through untouched")
	}
}
