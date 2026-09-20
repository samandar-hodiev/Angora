package mock

import (
	"encoding/json"
	"strings"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
)

// Grammar responses for development. The mock provider is the default in development, so
// without these the whole grammar AI surface — explanation, tutor, free-writing marking,
// visuals — would be dead on a developer's machine and only testable against a paid
// provider. These are deliberately plausible rather than clever: enough shape for the UI
// to be built and the parsing, validation and caching paths to be exercised.

func grammarAnalysis(req ai.AnalysisRequest) (json.RawMessage, bool) {
	switch req.SchemaName {
	case ai.SchemaGrammarExplain:
		return grammarExplanation(req), true
	case ai.SchemaGrammarWriting:
		return grammarWritingAnalysis(req), true
	default:
		return nil, false
	}
}

func grammarExplanation(req ai.AnalysisRequest) json.RawMessage {
	topic := valueAfter(req.Input, "TOPIC:")
	if topic == "" {
		topic = "this grammar point"
	}
	out, _ := json.Marshal(ai.GrammarExplanation{
		Definition: "[mock] " + topic + " is explained here at the learner's level.",
		WhenToUse: []string{
			"When the situation matches the rule above",
			"In both speaking and writing",
		},
		Formulas: []ai.GrammarFormula{
			{Label: "Affirmative", Pattern: "Subject + verb", Example: "I worked late."},
			{Label: "Negative", Pattern: "Subject + did not + verb", Example: "I didn't work late."},
		},
		Positive:  []string{"I finished the report.", "She arrived on time."},
		Negative:  []string{"I didn't finish the report.", "She didn't arrive on time."},
		Questions: []string{"Did you finish the report?", "Did she arrive on time?"},
		CommonMistakes: []ai.GrammarCorrection{
			{Wrong: "I didn't finished.", Right: "I didn't finish.", Why: "After didn't, use the base form."},
		},
		MiniCheck: &ai.GrammarMiniCheck{
			Question: "Which sentence is correct?",
			Options:  []string{"I didn't went.", "I didn't go.", "I not went."},
			Answer:   1,
		},
	})
	return out
}

// grammarWritingAnalysis looks for one mistake it can actually find, so a developer sees a
// real correction rather than an invented one, and marks the answer accordingly.
func grammarWritingAnalysis(req ai.AnalysisRequest) json.RawMessage {
	// The learner's text starts on the line after the marker and runs to the end.
	text := restAfter(req.Input, "LEARNER'S TEXT:")
	analysis := ai.GrammarWritingAnalysis{
		TargetUsedCorrectly: true,
		Score:               0.85,
		Summary:             "[mock] The target grammar is used correctly.",
		Corrections:         []ai.GrammarCorrection{},
		Kinds:               []string{},
	}
	for wrong, right := range map[string]string{
		"didn't went": "didn't go",
		"don't went":  "didn't go",
		"have went":   "have gone",
		"i am agree":  "I agree",
		"more better": "better",
		"didn't saw":  "didn't see",
	} {
		if !strings.Contains(strings.ToLower(text), wrong) {
			continue
		}
		analysis.TargetUsedCorrectly = false
		analysis.Score = 0.4
		analysis.Summary = "[mock] The target grammar is used, but not correctly."
		analysis.Corrections = append(analysis.Corrections, ai.GrammarCorrection{
			Wrong: wrong, Right: right, Why: "After did or didn't, English uses the base form of the verb.",
		})
		analysis.Kinds = append(analysis.Kinds, "target_grammar")
	}
	if len(strings.Fields(text)) < 5 {
		analysis.TargetUsedCorrectly = false
		analysis.Score = 0.1
		analysis.Summary = "[mock] Too short to show the target grammar."
	}
	out, _ := json.Marshal(analysis)
	return out
}

// grammarVisual answers the visual prompt with a real, valid SVG. It has to pass the same
// ValidateSVG the production path uses, or the mock would hide a bug in that boundary.
func grammarVisual(req ai.TextRequest) (string, bool) {
	if !strings.Contains(req.System, "SVG diagram") {
		return "", false
	}
	topic := "Grammar"
	if len(req.Messages) > 0 {
		if name := valueAfter(req.Messages[len(req.Messages)-1].Content, "TOPIC:"); name != "" {
			topic = name
		}
	}
	svg := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400">` +
		`<title>` + escapeXML(topic) + ` on a timeline</title>` +
		`<line x1="60" y1="220" x2="740" y2="220" stroke="var(--border)" stroke-width="2"/>` +
		`<circle cx="260" cy="220" r="7" fill="var(--primary)"/>` +
		`<line x1="600" y1="180" x2="600" y2="260" stroke="var(--fg-muted)" stroke-width="2"/>` +
		`<text x="260" y="196" text-anchor="middle" font-family="inherit" font-size="15" fill="currentColor">` +
		escapeXML(topic) + `</text>` +
		`<text x="600" y="290" text-anchor="middle" font-family="inherit" font-size="13" fill="var(--fg-muted)">now</text>` +
		`</svg>`
	return svg + "\nALT: A timeline showing where " + topic + " sits before now.\nCAPTION: " + topic, true
}

// valueAfter returns the rest of the line following a marker, e.g. "TOPIC: Past Simple".
func valueAfter(text, marker string) string {
	i := strings.Index(text, marker)
	if i < 0 {
		return ""
	}
	rest := text[i+len(marker):]
	if end := strings.IndexByte(rest, '\n'); end >= 0 {
		rest = rest[:end]
	}
	return strings.TrimSpace(rest)
}

// restAfter returns everything following a marker, not just the rest of its line.
func restAfter(text, marker string) string {
	i := strings.Index(text, marker)
	if i < 0 {
		return ""
	}
	return strings.TrimSpace(text[i+len(marker):])
}

func escapeXML(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(s)
}
