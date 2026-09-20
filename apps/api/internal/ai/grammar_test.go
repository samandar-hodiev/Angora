package ai

import "testing"

// A generated visual is stored once and served to every learner who opens the topic, so
// one poisoned SVG would reach all of them. These are the cases that must never get through.
func TestValidateSVGRejectsActiveContent(t *testing.T) {
	bad := map[string]string{
		"script":           `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
		"foreignObject":    `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><b>x</b></foreignObject></svg>`,
		"onload":           `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>`,
		"onmouseover":      `<svg xmlns="http://www.w3.org/2000/svg"><rect onmouseover="steal()"/></svg>`,
		"unlisted handler": `<svg xmlns="http://www.w3.org/2000/svg"><rect onfocusin="x()"/></svg>`,
		"external image":   `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.test/a.png"/></svg>`,
		"xlink":            `<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="#x"/></svg>`,
		"javascript url":   `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)">x</a></svg>`,
		"entity":           `<!ENTITY xxe SYSTEM "file:///etc/passwd"><svg xmlns="http://www.w3.org/2000/svg"/>`,
		"css import":       `<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.test/x.css)</style></svg>`,
		"animate":          `<svg xmlns="http://www.w3.org/2000/svg"><animate onbegin="alert(1)"/></svg>`,
	}
	for name, svg := range bad {
		if err := ValidateSVG(svg); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
}

func TestValidateSVGAcceptsAPlainDiagram(t *testing.T) {
	good := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400">
	  <title>Past Simple on a timeline</title>
	  <line x1="40" y1="200" x2="760" y2="200" stroke="var(--border)" stroke-width="2"/>
	  <circle cx="240" cy="200" r="6" fill="var(--primary)"/>
	  <text x="240" y="180" font-family="inherit" font-size="14" fill="currentColor">I worked</text>
	  <text x="600" y="180" font-family="inherit" font-size="14" fill="var(--fg-muted)">now</text>
	</svg>`
	if err := ValidateSVG(good); err != nil {
		t.Errorf("a plain diagram was rejected: %v", err)
	}
}

func TestValidateSVGRejectsOversizedOutput(t *testing.T) {
	huge := `<svg xmlns="http://www.w3.org/2000/svg">` + string(make([]byte, 70<<10)) + `</svg>`
	if err := ValidateSVG(huge); err == nil {
		t.Error("an oversized SVG was accepted")
	}
}

func TestParseVisualExtractsTheDiagram(t *testing.T) {
	raw := "```svg\n" + `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400"><title>T</title><rect/></svg>` +
		"\nALT: A timeline showing a finished past action.\nCAPTION: Past Simple\n```"
	got, err := parseVisual(raw)
	if err != nil {
		t.Fatalf("parseVisual: %v", err)
	}
	if got.AltText != "A timeline showing a finished past action." {
		t.Errorf("alt = %q", got.AltText)
	}
	if got.Caption != "Past Simple" {
		t.Errorf("caption = %q", got.Caption)
	}
	if got.SVG[:4] != "<svg" {
		t.Errorf("svg did not start at the element: %q", got.SVG[:20])
	}
}

func TestParseVisualRejectsProseAndPoisonedSVG(t *testing.T) {
	if _, err := parseVisual("I cannot draw that, sorry."); err == nil {
		t.Error("prose with no SVG was accepted")
	}
	if _, err := parseVisual(`<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>`); err == nil {
		t.Error("a poisoned SVG passed parseVisual")
	}
}

// An explanation with no examples is worse than no AI explanation at all: the learner
// already has the canonical rule underneath it.
func TestValidateExplanationRequiresSubstance(t *testing.T) {
	if err := validateExplanation(&GrammarExplanation{}); err == nil {
		t.Error("an empty explanation was accepted")
	}
	if err := validateExplanation(&GrammarExplanation{Definition: "x"}); err == nil {
		t.Error("an explanation with no examples or formulas was accepted")
	}
	ok := &GrammarExplanation{Definition: "Past Simple is for finished actions.", Positive: []string{"I worked."}}
	if err := validateExplanation(ok); err != nil {
		t.Errorf("a usable explanation was rejected: %v", err)
	}
}

// A mini-check whose answer points outside its options would mark a correct learner wrong.
func TestValidateExplanationDropsABrokenMiniCheck(t *testing.T) {
	e := &GrammarExplanation{
		Definition: "x", Positive: []string{"I worked."},
		MiniCheck: &GrammarMiniCheck{Question: "q", Options: []string{"a", "b"}, Answer: 5},
	}
	if err := validateExplanation(e); err != nil {
		t.Fatalf("validateExplanation: %v", err)
	}
	if e.MiniCheck != nil {
		t.Error("a mini-check with an out-of-range answer should be dropped")
	}
}
