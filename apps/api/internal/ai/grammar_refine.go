package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

// Working on a draft that already exists.
//
// Generating a topic from nothing is one job; the rest of editing is another, and it is the
// one an owner actually spends their time on. "These examples are dull", "this needs a
// harder question", "make the B1 version work at B2", "now say it in Uzbek" — each is a
// small, bounded change to text somebody already approved the shape of.
//
// So these calls always carry the current draft and return a full level. The model is asked
// to change one named part and leave the rest as it found it; the handler then keeps only
// the part that was asked for, which means a model that ignores the instruction and rewrites
// everything still cannot quietly replace work an editor did.

const (
	GrammarRefinePrompt    = "grammar_refine.v1"
	GrammarTranslatePrompt = "grammar_translate.v1"
)

// RefineAction is what the owner pressed.
type RefineAction string

const (
	// RefineImprove rewrites the section to be clearer, keeping its substance.
	RefineImprove RefineAction = "improve"
	// RefineRegenerate replaces the section with a genuinely different take on it.
	RefineRegenerate RefineAction = "regenerate"
	// RefineExpand adds to a list-shaped section without discarding what is there.
	RefineExpand RefineAction = "expand"
	// RefineAdapt rewrites the whole level for a different CEFR level.
	RefineAdapt RefineAction = "adapt"
)

// RefineSections are the parts of a level that can be worked on one at a time. "" means the
// whole level, which is what Improve and Adapt use.
var RefineSections = []string{
	"intro", "explanation", "usage", "formulas", "signal_words", "examples", "common_mistakes", "practice",
}

func IsRefineSection(name string) bool {
	for _, s := range RefineSections {
		if s == name {
			return true
		}
	}
	return false
}

type GrammarRefineRequest struct {
	Topic       string
	Slug        string
	Category    string
	Description string
	Level       cefr.Level
	Language    string
	Action      RefineAction
	// Section is the one part to change. Empty means the whole level.
	Section string
	// Current is the draft as it stands. The model is editing this, not writing from scratch.
	Current GeneratedGrammarLevel
	// AdaptFrom is the level Current was written for, when Action is adapt.
	AdaptFrom string
	ActorID   *uuid.UUID
}

type GrammarTranslateRequest struct {
	Topic    string
	Slug     string
	Level    cefr.Level
	From     string
	To       string
	Source   GeneratedGrammarLevel
	ActorID  *uuid.UUID
	Category string
}

// RefineGrammarLevel asks for one more pass over a draft and returns the whole level back.
func (s *GrammarTutorService) RefineGrammarLevel(
	ctx context.Context, req GrammarRefineRequest,
) (*GeneratedGrammarLevel, *EvaluationMeta, error) {
	if req.Section != "" && !IsRefineSection(req.Section) {
		return nil, nil, fmt.Errorf("unknown section %q", req.Section)
	}
	return s.oneLevel(ctx, CallMeta{
		Task:          TaskContentGeneration,
		UserID:        req.ActorID,
		PromptVersion: GrammarRefinePrompt,
		Metadata: map[string]any{
			"topic": req.Slug, "language": req.Language, "level": req.Level.BaseCode(),
			"action": string(req.Action), "section": req.Section,
		},
	}, refineInstructions(req), refineBrief(req), req.Level)
}

// TranslateGrammarLevel carries an approved English level into another language.
//
// Deliberately not the same thing as generating in that language: a translation of reviewed
// text says what the editor approved, and a fresh generation says whatever the model thinks
// this time. When somebody has already decided what a topic teaches, the other languages
// should agree with it rather than compete with it.
func (s *GrammarTutorService) TranslateGrammarLevel(
	ctx context.Context, req GrammarTranslateRequest,
) (*GeneratedGrammarLevel, *EvaluationMeta, error) {
	return s.oneLevel(ctx, CallMeta{
		Task:          TaskContentGeneration,
		UserID:        req.ActorID,
		PromptVersion: GrammarTranslatePrompt,
		Metadata: map[string]any{
			"topic": req.Slug, "from": req.From, "to": req.To, "level": req.Level.BaseCode(),
		},
	}, translateInstructions(req), translateBrief(req), req.Level)
}

// oneLevel runs a call that must answer with exactly one level, and checks that it did.
func (s *GrammarTutorService) oneLevel(
	ctx context.Context, meta CallMeta, instructions, input string, level cefr.Level,
) (*GeneratedGrammarLevel, *EvaluationMeta, error) {
	res, err := s.gateway.AnalyzeText(ctx, meta, AnalysisRequest{
		Model:        s.mainModel,
		Instructions: instructions,
		Input:        input,
		SchemaName:   SchemaGrammarContent,
		Schema:       grammarContentSchema,
	})
	if err != nil {
		return nil, nil, err
	}
	var out GeneratedGrammarContent
	if err := json.Unmarshal(res.Output, &out); err != nil {
		return nil, nil, fmt.Errorf("generated grammar content is not valid JSON: %w", err)
	}
	if len(out.Levels) != 1 {
		return nil, nil, fmt.Errorf("expected one level, got %d", len(out.Levels))
	}
	got := out.Levels[0]
	// The level is fixed by the request, not by the model: it was told which one, and a
	// mismatch here would put B2 text under the B1 tab.
	got.Level = level.BaseCode()
	if got.Applicable {
		got.Practice = usablePractice(got.Practice)
	}
	return &got, &EvaluationMeta{
		Versions:    Versions{SchemaVersion: GrammarSchemaVersion, ModelVersion: res.Model, PromptVersion: meta.PromptVersion},
		AIRequestID: res.AIRequestID,
	}, nil
}

func refineInstructions(req GrammarRefineRequest) string {
	var b strings.Builder
	b.WriteString("You are editing an existing English-grammar lesson for a language-learning platform. ")
	b.WriteString("An editor has already approved its shape; your job is one specific change, not a rewrite.\n\n")

	switch req.Action {
	case RefineImprove:
		b.WriteString("Make the text clearer and more concrete. Keep what it teaches exactly the same — same rules, same claims, same level of difficulty. If a sentence is already good, leave it alone. Shorter is usually better.\n")
	case RefineRegenerate:
		b.WriteString("Replace this section with a genuinely different take on the same point: different examples, different angle, same rule. Returning a lightly reworded version of what is already there is a failure.\n")
	case RefineExpand:
		b.WriteString("Add to this section. Keep every existing item exactly as it is and append new ones that do not repeat them. New items must earn their place — another way of saying the same thing does not.\n")
	case RefineAdapt:
		b.WriteString("Rewrite the whole lesson for a different CEFR level. This is not a matter of shortening sentences: a lower level needs simpler vocabulary and fewer exceptions, a higher one needs the nuance and the cases the simpler version leaves out. If the topic cannot honestly be taught at the target level, set applicable to false and say why in one sentence.\n")
	default:
		b.WriteString("Improve the text without changing what it teaches.\n")
	}

	if req.Section != "" {
		fmt.Fprintf(&b, "\nChange only the %q section. Return every other field exactly as you received it.\n", req.Section)
	}

	b.WriteString("\nExamples must be sentences someone would actually say. Common mistakes must be mistakes learners actually make. Practice questions are multiple choice; answer_index counts from zero, and no two options may both be acceptable.\n\n")
	b.WriteString(languageRule(req.Language))
	return b.String()
}

func refineBrief(req GrammarRefineRequest) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Topic: %s\n", req.Topic)
	if req.Category != "" {
		fmt.Fprintf(&b, "Category: %s\n", req.Category)
	}
	if strings.TrimSpace(req.Description) != "" {
		fmt.Fprintf(&b, "What it covers: %s\n", req.Description)
	}
	if req.Action == RefineAdapt && req.AdaptFrom != "" {
		fmt.Fprintf(&b, "The draft below was written for %s. Rewrite it for %s.\n", req.AdaptFrom, req.Level.BaseCode())
	} else {
		fmt.Fprintf(&b, "CEFR level: %s\n", req.Level.BaseCode())
	}
	if req.Section != "" {
		fmt.Fprintf(&b, "Section to change: %s\n", req.Section)
	}
	b.WriteString("\nThe current draft, as one level:\n")
	b.WriteString(marshalLevel(req.Current))
	return b.String()
}

func translateInstructions(req GrammarTranslateRequest) string {
	var b strings.Builder
	b.WriteString("You are translating an approved English-grammar lesson for a language-learning platform.\n\n")
	b.WriteString("This is a translation, not a new lesson. Say what the source says: the same rules, the same order, the same examples, the same practice questions with the same correct answers. Do not add explanations the source does not make, and do not drop ones it does.\n\n")
	b.WriteString("Keep every English example sentence, every formula pattern and every signal word in English, exactly as written — the learner is learning English, not reading about it in translation. Grammar terms (present perfect, countable noun) stay in English. Translate the prose around them: the explanation, the usage notes, the reasons in common mistakes, the practice prompts and their explanations.\n\n")
	b.WriteString("Practice options stay in English when they are English words the learner must choose between. answer_index must not change.\n\n")
	b.WriteString(languageRule(req.To))
	return b.String()
}

func translateBrief(req GrammarTranslateRequest) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Topic: %s\n", req.Topic)
	fmt.Fprintf(&b, "CEFR level: %s\n", req.Level.BaseCode())
	fmt.Fprintf(&b, "Translate from %s into %s.\n\n", languageName(req.From), languageName(req.To))
	b.WriteString("The approved source lesson:\n")
	b.WriteString(marshalLevel(req.Source))
	return b.String()
}

func languageRule(code string) string {
	switch code {
	case "uz":
		return "Write the prose in Uzbek (Latin script). Keep every English example sentence in English. Grammar terms stay in English.\n"
	case "ru":
		return "Write the prose in Russian. Keep every English example sentence in English. Grammar terms stay in English.\n"
	default:
		return "Write in clear, plain English.\n"
	}
}

func languageName(code string) string {
	switch code {
	case "uz":
		return "Uzbek"
	case "ru":
		return "Russian"
	default:
		return "English"
	}
}

func marshalLevel(level GeneratedGrammarLevel) string {
	raw, err := json.MarshalIndent(level, "", "  ")
	if err != nil {
		return "{}"
	}
	return string(raw)
}
