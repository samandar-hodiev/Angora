package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

// Authoring grammar content with AI.
//
// This is the production side of grammar, not the tutoring side. GrammarTutorService
// explains one topic to one learner, live; this writes the curriculum itself — the text an
// owner reviews, edits and publishes, and that every learner then reads.
//
// Three things shape it.
//
//   - One request per press. A generation returns every applicable level of a topic in one
//     structured response. Asking for a title, then a formula, then examples is the same
//     content at several times the price, and each round trip is another chance for the
//     model to forget what it already decided.
//   - The model may refuse a level. Inversion has no honest A1 explanation, and a model
//     forced to produce one writes something that is either wrong or so simplified it is
//     wrong. `applicable: false` with a reason is a better answer than filler.
//   - Nothing it returns is trusted. The output is validated before it reaches a column,
//     and it lands as a draft. An owner publishes; the model never does.
const (
	GrammarAuthorPrompt  = "grammar_author.v1"
	SchemaGrammarContent = "grammar_content"

	// Two levels of generated practice per level is a starting set, not a bank. The owner
	// adds more from the question bank, which is where practice is actually curated.
	minPracticePerLevel = 3
)

// GrammarAuthorRequest is everything the model is told about what it is writing.
type GrammarAuthorRequest struct {
	Topic       string
	Slug        string
	Category    string
	Description string
	/** The levels to attempt. The model decides which of them the topic is worth teaching at. */
	Levels []cefr.Level
	/** Output language. English is the source; uz and ru are written for those learners. */
	Language string
	/** Related topics worth contrasting with, by name. Optional. */
	RelatedTopics []string
	ActorID       *uuid.UUID
}

type GeneratedFormula struct {
	Label    string   `json:"label"`
	Pattern  string   `json:"pattern"`
	Examples []string `json:"examples"`
}

type GeneratedExample struct {
	Text string `json:"text"`
	Note string `json:"note"`
}

type GeneratedMistake struct {
	Wrong string `json:"wrong"`
	Right string `json:"right"`
	Why   string `json:"why"`
	Rule  string `json:"rule"`
}

// GeneratedPractice is one practice question: a multiple choice or a gap the learner types
// into. A choice's answer is an index, never text: a string answer has to be matched back
// against the options, and "The" and "the" then decide whether a learner was right. A gap's
// answer is the list of everything that is correct in it, compared after normalising.
type GeneratedPractice struct {
	/** multiple_choice or fill_blank. Empty is multiple_choice: rows written before gaps existed. */
	Type        string   `json:"type"`
	Prompt      string   `json:"prompt"`
	Options     []string `json:"options"`
	AnswerIndex int      `json:"answer_index"`
	Accepted    []string `json:"accepted"`
	Hint        string   `json:"hint"`
	Explanation string   `json:"explanation"`
	TargetRule  string   `json:"target_rule"`
}

const (
	PracticeMultipleChoice = "multiple_choice"
	PracticeFillBlank      = "fill_blank"
	// BlankMarker is where a fill_blank prompt's answer goes.
	BlankMarker = "___"
)

// IsFillBlank reports whether the question is answered by typing.
func (q GeneratedPractice) IsFillBlank() bool { return q.Type == PracticeFillBlank }

type GeneratedGrammarLevel struct {
	Level string `json:"level"`
	/** False when the topic is not worth teaching at this level; Reason says why. */
	Applicable     bool                `json:"applicable"`
	Reason         string              `json:"reason"`
	Title          string              `json:"title"`
	Summary        string              `json:"summary"`
	Intro          string              `json:"intro"`
	Explanation    string              `json:"explanation"`
	Usage          []string            `json:"usage"`
	Formulas       []GeneratedFormula  `json:"formulas"`
	SignalWords    []string            `json:"signal_words"`
	Examples       []GeneratedExample  `json:"examples"`
	CommonMistakes []GeneratedMistake  `json:"common_mistakes"`
	Practice       []GeneratedPractice `json:"practice"`
}

type GeneratedGrammarContent struct {
	Levels []GeneratedGrammarLevel `json:"levels"`
	// Dropped names the levels that came back unusable and were left out, so the caller
	// can say which ones still need writing.
	Dropped []string `json:"-"`
}

// AuthorGrammarContent writes one topic across the requested levels, in one call.
func (s *GrammarTutorService) AuthorGrammarContent(
	ctx context.Context, req GrammarAuthorRequest,
) (*GeneratedGrammarContent, *EvaluationMeta, error) {
	if len(req.Levels) == 0 {
		return nil, nil, fmt.Errorf("no levels requested")
	}
	res, err := s.gateway.AnalyzeText(ctx, CallMeta{
		Task:          TaskContentGeneration,
		UserID:        req.ActorID,
		PromptVersion: GrammarAuthorPrompt,
		Metadata: map[string]any{
			"topic": req.Slug, "language": req.Language, "levels": levelCodes(req.Levels),
		},
	}, AnalysisRequest{
		// The main model, not the fast one: this text is written once and then read by
		// every learner who opens the topic. It is the wrong place to save a few cents.
		Model:        s.mainModel,
		Instructions: authorInstructions(req),
		Input:        authorBrief(req),
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
	if err := validateAuthoredContent(&out, req); err != nil {
		return nil, nil, err
	}
	return &out, &EvaluationMeta{
		Versions:    Versions{SchemaVersion: GrammarSchemaVersion, ModelVersion: res.Model, PromptVersion: GrammarAuthorPrompt},
		AIRequestID: res.AIRequestID,
	}, nil
}

// validateAuthoredContent drops what cannot be taught and refuses what cannot be used.
//
// Model output is untrusted input. A practice question whose answer index points outside
// its own options marks a correct learner wrong, and an "applicable" level with no
// explanation is an empty page with a title — both are worse than the level simply not
// existing yet.
func validateAuthoredContent(out *GeneratedGrammarContent, req GrammarAuthorRequest) error {
	wanted := map[string]bool{}
	for _, level := range req.Levels {
		wanted[level.BaseCode()] = true
	}

	kept := out.Levels[:0]
	for i := range out.Levels {
		level := &out.Levels[i]
		level.Level = strings.ToUpper(strings.TrimSpace(level.Level))
		if !wanted[level.Level] {
			continue // a level nobody asked for
		}
		if !level.Applicable {
			kept = append(kept, *level)
			continue
		}
		// One level the model left empty is that level not written, not the whole
		// generation failed: the other five levels and their translations are still good.
		if strings.TrimSpace(level.Explanation) == "" && strings.TrimSpace(level.Intro) == "" {
			out.Dropped = append(out.Dropped, level.Level)
			continue
		}
		if len(level.Examples) == 0 && len(level.Formulas) == 0 {
			out.Dropped = append(out.Dropped, level.Level)
			continue
		}
		level.Practice = UsablePractice(level.Practice)
		kept = append(kept, *level)
	}
	out.Levels = kept

	if len(out.Levels) == 0 {
		if len(out.Dropped) > 0 {
			return fmt.Errorf("no usable levels were generated (%s came back empty)", strings.Join(out.Dropped, ", "))
		}
		return fmt.Errorf("no usable levels were generated")
	}
	return nil
}

// UsablePractice keeps only questions that can actually be marked, each with its kind's
// fields and nothing of the other's.
func UsablePractice(questions []GeneratedPractice) []GeneratedPractice {
	kept := questions[:0]
	for _, q := range questions {
		// Models draw the gap as anything from three underscores to ten; one width is what
		// the learner page and the check below look for.
		q.Prompt = longGap.ReplaceAllString(strings.TrimSpace(q.Prompt), BlankMarker)
		if q.Prompt == "" {
			continue
		}
		if q.IsFillBlank() {
			// Exactly one gap: with none there is nowhere to type, and with two the one
			// answer box cannot say which gap it fills.
			if strings.Count(q.Prompt, BlankMarker) != 1 {
				continue
			}
			accepted := make([]string, 0, len(q.Accepted))
			for _, a := range q.Accepted {
				if a = strings.TrimSpace(a); a != "" {
					accepted = append(accepted, a)
				}
			}
			if len(accepted) == 0 {
				continue
			}
			q.Accepted, q.Options, q.AnswerIndex = accepted, []string{}, -1
			q.Hint = strings.TrimSpace(q.Hint)
		} else {
			if len(q.Options) < 2 || q.AnswerIndex < 0 || q.AnswerIndex >= len(q.Options) {
				continue
			}
			// Two options that say the same thing are a question with two right answers,
			// or one with a duplicate distractor; either way it cannot be marked fairly.
			if !distinctOptions(q.Options) {
				continue
			}
			q.Type, q.Accepted, q.Hint = PracticeMultipleChoice, []string{}, ""
		}
		kept = append(kept, q)
	}
	return kept
}

var longGap = regexp.MustCompile(`_{3,}`)

func distinctOptions(options []string) bool {
	seen := map[string]bool{}
	for _, o := range options {
		key := normalizeChoice(o)
		if key == "" || seen[key] {
			return false
		}
		seen[key] = true
	}
	return true
}

// normalizeChoice is how two answers are compared: case, spacing and final punctuation
// do not make them different.
func normalizeChoice(s string) string {
	s = strings.ToLower(strings.Join(strings.Fields(s), " "))
	return strings.TrimRight(s, ".!?,;:")
}

func levelCodes(levels []cefr.Level) []string {
	out := make([]string, 0, len(levels))
	for _, level := range levels {
		out = append(out, level.BaseCode())
	}
	return out
}

func authorInstructions(req GrammarAuthorRequest) string {
	var b strings.Builder
	b.WriteString("You are writing the canonical explanation of one English grammar point for a language-learning platform. ")
	b.WriteString("This text is the curriculum: it is reviewed by an editor and then read by every learner who opens the topic.\n\n")

	b.WriteString("Write one version per CEFR level you are given. The versions must genuinely differ:\n")
	b.WriteString("- A1/A2: short sentences, everyday vocabulary, no grammatical terminology beyond the topic's own name. One idea per sentence.\n")
	b.WriteString("- B1/B2: fuller usage, contrasts with the forms learners confuse this with, and the exceptions that actually come up.\n")
	b.WriteString("- C1/C2: register, nuance, and the uses that are correct but rare. Do not pad — if a level has little to add, say less.\n")
	b.WriteString("Copying one level's text into another is a failure, not a shortcut.\n\n")

	b.WriteString("Some topics do not belong at every level. If this topic cannot be taught honestly at a level — because it needs grammar the learner does not have yet, or because it is too basic to be worth their time — set applicable to false for that level and give a one-sentence reason. Do not invent a simplified version that is wrong.\n\n")

	b.WriteString("Examples must be sentences someone would actually say. Common mistakes must be mistakes learners actually make — the wrong form, the right form, and why, in that order.\n\n")

	b.WriteString(practiceRules)

	switch req.Language {
	case "uz":
		b.WriteString("Write the explanation, usage, notes and mistakes in Uzbek (Latin script). Keep every English example sentence in English — the learner is learning English, not reading about it in translation. Grammar terms stay in English.\n")
	case "ru":
		b.WriteString("Write the explanation, usage, notes and mistakes in Russian. Keep every English example sentence in English. Grammar terms stay in English.\n")
	default:
		b.WriteString("Write in clear, plain English.\n")
	}
	return b.String()
}

func authorBrief(req GrammarAuthorRequest) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Topic: %s\n", req.Topic)
	if req.Category != "" {
		fmt.Fprintf(&b, "Category: %s\n", req.Category)
	}
	if strings.TrimSpace(req.Description) != "" {
		fmt.Fprintf(&b, "What it covers: %s\n", req.Description)
	}
	fmt.Fprintf(&b, "Levels to write: %s\n", strings.Join(levelCodes(req.Levels), ", "))
	if len(req.RelatedTopics) > 0 {
		fmt.Fprintf(&b, "Learners confuse this with: %s\n", strings.Join(req.RelatedTopics, ", "))
	}
	fmt.Fprintf(&b, "Write at least %d practice questions for each applicable level.\n", minPracticePerLevel)
	return b.String()
}
