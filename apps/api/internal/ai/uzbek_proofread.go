package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode"
)

// Uzbek proofreading.
//
// Uzbek written by a model slips in ways a learner notices at once and an owner may not:
// "vakt" for vaqt, "xayot" for hayot, a missing oʻ. So every Uzbek string
// the lexicon stores — translations, definitions, notes — passes through a second, narrow
// call that corrects spelling against the official Latin alphabet and changes nothing else.

const (
	UzbekProofreadPrompt      = "uzbek_proofread.v1"
	TaskUzbekProofread   Task = "uzbek_proofread"
)

// UzbekOrthography is the rule every prompt that writes Uzbek carries.
const UzbekOrthography = "Uzbek is written in the official Latin alphabet with correct spelling, Latin letters only (never a " +
	"Cyrillic а, е, о, never ə or ı): q and k are different letters (vaqt, qisqa, qilmoq — never vakt, kiska), x and h are different " +
	"(xona, hayot), o' and g' keep their apostrophe (ko'p, tog'), and the tutuq belgisi is kept where it belongs (ma'no, san'at). " +
	"Write every apostrophe as a plain ' ."

// uzbekApostrophes are the marks written for oʻ, gʻ and the tutuq belgisi. They are stored as
// one plain apostrophe: the text then looks the same everywhere, and a learner searching
// "o'z" with the apostrophe on their keyboard finds it.
var uzbekApostrophes = strings.NewReplacer("ʻ", "'", "ʼ", "'", "‘", "'", "’", "'", "`", "'", "´", "'")

// lookalikes are letters from other alphabets that look like Latin ones and slip into Uzbek
// written by a model: a Cyrillic а in "rаsmiy", an ə, a Turkish ı.
var lookalikes = strings.NewReplacer(
	"а", "a", "е", "e", "о", "o", "р", "p", "с", "c", "х", "x", "у", "y", "і", "i", "к", "k", "м", "m", "т", "t",
	"А", "A", "Е", "E", "О", "O", "Р", "P", "С", "C", "Х", "X", "К", "K", "М", "M", "Т", "T",
	"ə", "a", "Ə", "A", "ı", "i",
)

// NormalizeUzbek gives Uzbek text one apostrophe and Latin letters only. A string that is
// mostly Cyrillic is left as it is: it is not Uzbek Latin to begin with.
func NormalizeUzbek(text string) string {
	text = uzbekApostrophes.Replace(strings.TrimSpace(text))
	latin, other := 0, 0
	for _, r := range text {
		switch {
		case r < 128 && unicode.IsLetter(r):
			latin++
		case unicode.IsLetter(r):
			other++
		}
	}
	if latin > other {
		text = lookalikes.Replace(text)
	}
	return text
}

// latinOnly reports whether text has no letters outside the Latin alphabet.
func latinOnly(text string) bool {
	for _, r := range text {
		if r >= 128 && unicode.IsLetter(r) {
			return false
		}
	}
	return true
}

// UzbekText is one Uzbek string to check; Key is how the caller finds it again.
type UzbekText struct {
	Key  string
	Text string
}

// ProofreadUzbek returns the corrected strings for the ones that needed correcting: key → text.
// A string that was already right is left out of the answer.
func (s *GrammarTutorService) ProofreadUzbek(ctx context.Context, items []UzbekText) (map[string]string, error) {
	out := map[string]string{}
	if len(items) == 0 {
		return out, nil
	}
	schema, _ := json.Marshal(map[string]any{
		"type": "object", "additionalProperties": false, "required": []string{"items"},
		"properties": map[string]any{"items": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object", "additionalProperties": false, "required": []string{"key", "corrected"},
				"properties": map[string]any{
					"key":       map[string]any{"type": "string"},
					"corrected": map[string]any{"type": "string", "description": "The text with its spelling corrected; identical to the input when it was already correct."},
				},
			},
		}},
	})
	var in strings.Builder
	for _, it := range items {
		fmt.Fprintf(&in, "%s\t%s\n", it.Key, it.Text)
	}
	res, err := s.gateway.AnalyzeText(ctx, CallMeta{
		Task:          TaskUzbekProofread,
		PromptVersion: UzbekProofreadPrompt,
		Metadata:      map[string]any{"kind": "uzbek_proofread", "count": len(items)},
	}, AnalysisRequest{
		Model: s.mainModel,
		Instructions: "You are a meticulous proofreader of Uzbek (Latin script). Each input line is: key<TAB>text. Correct spelling " +
			"mistakes only — wrong letters, missing o'/g' apostrophes, q/k and x/h confusions, misspelt words. " + UzbekOrthography +
			" Do not change the wording, the meaning, the punctuation or the style; do not translate. Answer every key.",
		Input: in.String(), SchemaName: "uzbek_proofread", Schema: schema,
	})
	if err != nil {
		return nil, err
	}
	var raw struct {
		Items []struct {
			Key       string `json:"key"`
			Corrected string `json:"corrected"`
		} `json:"items"`
	}
	if err := json.Unmarshal(res.Output, &raw); err != nil {
		return nil, fmt.Errorf("proofreading is not valid JSON: %w", err)
	}
	original := map[string]string{}
	for _, it := range items {
		original[it.Key] = it.Text
	}
	for key, was := range original {
		fixed := ""
		for _, r := range raw.Items {
			if r.Key == key {
				fixed = NormalizeUzbek(r.Corrected)
			}
		}
		// Not trusted: a rewrite rather than a spelling fix, or a correction that brings in a
		// letter from another alphabet. Then only the mechanical normalisation applies.
		if fixed == "" || !closeEnough(was, fixed) || !latinOnly(fixed) {
			fixed = NormalizeUzbek(was)
		}
		if fixed != was {
			out[key] = fixed
		}
	}
	return out, nil
}

// closeEnough reports whether b is a spelling correction of a rather than a rewrite: about the
// same length and the same number of words.
func closeEnough(a, b string) bool {
	la, lb := len([]rune(a)), len([]rune(b))
	if lb > la+la/4+3 || lb < la-la/4-3 {
		return false
	}
	return len(strings.Fields(a)) == len(strings.Fields(b))
}
