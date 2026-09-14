package ai

import (
	"errors"
	"fmt"
)

// EvaluationSchemaVersion identifies the shape of EvaluationResult. Bump it when the
// JSON shape changes incompatibly; stored results keep the version they were written with.
const EvaluationSchemaVersion = "evaluation.v1"

// Versions pins exactly what produced a result so results can be compared, audited and
// regression-tested across model, prompt and rubric changes.
type Versions struct {
	SchemaVersion   string `json:"schema_version"`
	ModelVersion    string `json:"model_version"`
	PromptVersion   string `json:"prompt_version"`
	RubricVersion   string `json:"rubric_version"`
	AnalysisVersion string `json:"analysis_version"`
}

// EvaluationResult is the machine-readable output of speaking, writing and exam
// evaluations. It is stored in ai_analyses.result and returned to clients as-is.
type EvaluationResult struct {
	Versions
	// Score is the overall score on the scale named by Scale (e.g. "ielts_band", "percent").
	Score           *float64           `json:"score"`
	Scale           string             `json:"scale"`
	Scores          map[string]float64 `json:"scores"` // grammar, vocabulary, fluency, pronunciation, ...
	Mistakes        []Mistake          `json:"mistakes"`
	Strengths       []string           `json:"strengths"`
	Recommendations []Recommendation   `json:"recommendations"`
}

type Mistake struct {
	Category    string `json:"category"` // dotted taxonomy: grammar.tense.past_simple
	Original    string `json:"original"`
	Correction  string `json:"correction"`
	Explanation string `json:"explanation"`
	Severity    string `json:"severity"` // low | medium | high
	Span        *Span  `json:"span,omitempty"`
}

// Span locates a mistake in the transcript or text (character offsets).
type Span struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

type Recommendation struct {
	Type   string `json:"type"` // practice_skill | grammar_topic | vocabulary | content_item
	Target string `json:"target"`
	Reason string `json:"reason"`
}

var validSeverity = map[string]bool{"low": true, "medium": true, "high": true}

// Validate rejects results that downstream code (mistake extraction, progress,
// recommendations) cannot safely consume. AI output is untrusted input.
func (r EvaluationResult) Validate() error {
	var errs []error
	if r.SchemaVersion != EvaluationSchemaVersion {
		errs = append(errs, fmt.Errorf("schema_version %q is not %q", r.SchemaVersion, EvaluationSchemaVersion))
	}
	if r.ModelVersion == "" || r.PromptVersion == "" || r.RubricVersion == "" || r.AnalysisVersion == "" {
		errs = append(errs, errors.New("model, prompt, rubric and analysis versions are required"))
	}
	if r.Score != nil && r.Scale == "" {
		errs = append(errs, errors.New("scale is required when score is set"))
	}
	for i, m := range r.Mistakes {
		if m.Category == "" {
			errs = append(errs, fmt.Errorf("mistakes[%d].category is required", i))
		}
		if !validSeverity[m.Severity] {
			errs = append(errs, fmt.Errorf("mistakes[%d].severity %q is invalid", i, m.Severity))
		}
		if m.Span != nil && (m.Span.Start < 0 || m.Span.End < m.Span.Start) {
			errs = append(errs, fmt.Errorf("mistakes[%d].span is invalid", i))
		}
	}
	return errors.Join(errs...)
}
