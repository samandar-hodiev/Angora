package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
)

// Irregular verbs, suggested by the model for the owner to read and publish.
//
// The forms of an irregular verb are facts, not style, and a model can still slip a regular
// verb into the list ("work – worked") or invent a form. So every suggestion is checked here:
// a verb whose past forms are only the regular -ed is dropped, as is one already in the table.

const (
	IrregularVerbsPrompt      = "irregular_verbs_author.v1"
	TaskIrregularVerbs   Task = "irregular_verbs"
)

// IrregularVerbDraft is one suggested verb.
type IrregularVerbDraft struct {
	Base       string            `json:"base"`
	Past       string            `json:"past"`
	Participle string            `json:"past_participle"`
	Level      string            `json:"level"`
	Uz         string            `json:"uz"`
	Ru         string            `json:"ru"`
	Note       string            `json:"note"`
	Examples   map[string]string `json:"examples"`
}

// VerbFormsOf splits a form into its accepted spellings: "learnt / learned" → learnt, learned.
func VerbFormsOf(form string) []string {
	out := []string{}
	for _, f := range strings.Split(form, "/") {
		if f = strings.ToLower(strings.TrimSpace(f)); f != "" {
			out = append(out, f)
		}
	}
	return out
}

// regularPast is every spelling the regular -ed rule could give: work → worked, like → liked,
// study → studied, stop → stopped.
func regularPast(base string) []string {
	b := strings.ToLower(strings.TrimSpace(base))
	out := []string{b + "ed", b + "d"}
	if n := len(b); n > 1 {
		out = append(out, b+b[n-1:]+"ed")
		if b[n-1] == 'y' {
			out = append(out, b[:n-1]+"ied")
		}
	}
	return out
}

// IsIrregular reports whether a verb has at least one form the regular rule does not give.
func IsIrregular(base, past, participle string) bool {
	regular := regularPast(base)
	for _, f := range append(VerbFormsOf(past), VerbFormsOf(participle)...) {
		if !slices.Contains(regular, f) {
			return true
		}
	}
	return false
}

// VerbPattern is how the three forms relate, by their first spellings: AAA cut-cut-cut,
// ABB buy-bought-bought, ABA come-came-come, ABC go-went-gone.
func VerbPattern(base, past, participle string) string {
	a := strings.ToLower(strings.TrimSpace(base))
	b, c := firstForm(past), firstForm(participle)
	switch {
	case a == b && b == c:
		return "AAA"
	case b == c:
		return "ABB"
	case a == c:
		return "ABA"
	default:
		return "ABC"
	}
}

func firstForm(form string) string {
	if f := VerbFormsOf(form); len(f) > 0 {
		return f[0]
	}
	return ""
}

var verbsSchema = json.RawMessage(`{
  "type": "object", "additionalProperties": false, "required": ["verbs"],
  "properties": {"verbs": {"type": "array", "items": {
    "type": "object", "additionalProperties": false,
    "required": ["base", "past", "past_participle", "level", "uz", "ru", "note", "base_example", "past_example", "participle_example"],
    "properties": {
      "base": {"type": "string"},
      "past": {"type": "string", "description": "The past simple. Two accepted spellings as \"learnt / learned\", British first."},
      "past_participle": {"type": "string", "description": "The past participle, the same way."},
      "level": {"type": "string", "enum": ["A1", "A2", "B1", "B2", "C1", "C2"]},
      "uz": {"type": "string", "description": "The verb in Uzbek (Latin), infinitive: bormoq."},
      "ru": {"type": "string", "description": "The verb in Russian, infinitive."},
      "note": {"type": "string", "description": "In Uzbek: what learners confuse about this verb, one sentence; empty when nothing."},
      "base_example": {"type": "string"},
      "past_example": {"type": "string"},
      "participle_example": {"type": "string"}
    }
  }}}
}`)

// WriteIrregularVerbs suggests irregular verbs not yet in the table, each checked.
func (s *GrammarTutorService) WriteIrregularVerbs(ctx context.Context, count int, exclude []string, minLevel, maxLevel string) ([]IrregularVerbDraft, error) {
	count = min(max(count, 1), 40)
	var b strings.Builder
	fmt.Fprintf(&b, "List %d English irregular verbs that are NOT in the excluded list. Only verbs whose past simple or past participle "+
		"is irregular — never a regular -ed verb. Prefer verbs a learner preparing for IELTS actually meets, including common "+
		"prefixed forms (overcome, withdraw, mistake). Give the standard forms; where British and American differ give both, British first. ", count)
	if minLevel != "" || maxLevel != "" {
		fmt.Fprintf(&b, "Only verbs whose level is between %s and %s. ", orDefault(minLevel, "A1"), orDefault(maxLevel, "C2"))
	}
	b.WriteString(UzbekOrthography + " ")
	b.WriteString("Each example is one short natural sentence: the base form, the past simple, and the present perfect or passive with the participle.")
	res, err := s.gateway.AnalyzeText(ctx, CallMeta{
		Task:          TaskIrregularVerbs,
		PromptVersion: IrregularVerbsPrompt,
		Metadata:      map[string]any{"kind": "irregular_verbs", "count": count},
	}, AnalysisRequest{
		Model: s.mainModel, Instructions: b.String(),
		Input:      "EXCLUDED: " + strings.Join(exclude, ", ") + "\n",
		SchemaName: "irregular_verbs", Schema: verbsSchema,
	})
	if err != nil {
		return nil, err
	}
	var raw struct {
		Verbs []struct {
			IrregularVerbDraft
			BaseExample       string `json:"base_example"`
			PastExample       string `json:"past_example"`
			ParticipleExample string `json:"participle_example"`
		} `json:"verbs"`
	}
	if err := json.Unmarshal(res.Output, &raw); err != nil {
		return nil, fmt.Errorf("irregular verbs are not valid JSON: %w", err)
	}
	known := map[string]bool{}
	for _, e := range exclude {
		known[strings.ToLower(strings.TrimSpace(e))] = true
	}
	out := []IrregularVerbDraft{}
	for _, v := range raw.Verbs {
		d := v.IrregularVerbDraft
		d.Base = strings.ToLower(strings.TrimSpace(d.Base))
		d.Past, d.Participle = strings.TrimSpace(d.Past), strings.TrimSpace(d.Participle)
		if d.Base == "" || d.Past == "" || d.Participle == "" || known[d.Base] || !IsIrregular(d.Base, d.Past, d.Participle) {
			continue
		}
		known[d.Base] = true
		d.Uz, d.Ru, d.Note = NormalizeUzbek(d.Uz), strings.TrimSpace(d.Ru), NormalizeUzbek(d.Note)
		d.Examples = map[string]string{}
		if v.BaseExample != "" && v.PastExample != "" && v.ParticipleExample != "" {
			d.Examples = map[string]string{"base": v.BaseExample, "past": v.PastExample, "participle": v.ParticipleExample}
		}
		out = append(out, d)
	}
	return out, nil
}
