package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

// Writing a topic's test.
//
// The lesson call writes a handful of questions as part of the page. A test is more than
// that: fifteen questions per level, some picked from options and some typed into a gap, so
// a learner cannot pass by recognising the right shape among four. Written in a call of its
// own, one per level, because fifteen questions for each of six levels inside the lesson
// call is a response long enough that the end of it gets careless — and the end is where
// the C2 questions would be.

const (
	GrammarPracticePrompt      = "grammar_practice.v1"
	GrammarPracticeCheckPrompt = "grammar_practice_check.v1"
	SchemaGrammarPractice      = "grammar_practice"
	SchemaGrammarPracticeCheck = "grammar_practice_check"

	// PracticeSetSize is how many questions a generated test has per level.
	PracticeSetSize = 15
	// practiceDraftSize is how many are written: a few more than the test needs, because
	// the check that follows drops any question whose key it does not agree with.
	practiceDraftSize = 18
	// practiceGapShare is how many of them are typed rather than picked.
	practiceGapShare = 7
	// minUsablePractice is the fewest usable questions a set may come back with before it
	// counts as a failed generation rather than a short one.
	minUsablePractice = 8
)

// practiceRules is what every call that writes questions is told about them.
const practiceRules = "Practice questions come in two kinds. multiple_choice: 2 to 4 options (as many as there are genuinely wrong choices), answer_index is the position of the correct one counting from zero, accepted is empty and hint is empty. Every distractor must make the sentence ungrammatical, for a reason a learner would recognise — not merely a different meaning. Never offer an option that also gives a correct sentence (for an a/an question, \"the\" usually does, so leave it out). " +
	"fill_blank: the prompt is one English sentence with exactly one ___ where the answer goes; accepted lists every answer that is correct in that gap (contracted and full forms both, e.g. \"has gone\" and \"'s gone\"); hint is the base form or a short cue such as (go), or empty; options is empty and answer_index is -1. The sentence must allow only the answers you list. " +
	"Every question's explanation says why the right answer is right and, for the answer learners most often choose instead, why it is wrong.\n\n"

// GrammarPracticeRequest is one level's test to write.
type GrammarPracticeRequest struct {
	Topic       string
	Slug        string
	Category    string
	Description string
	Level       cefr.Level
	/** The lesson the questions test, so they ask about what the page actually teaches. */
	Lesson  GeneratedGrammarLevel
	ActorID *uuid.UUID
}

type generatedPracticeSet struct {
	Questions []GeneratedPractice `json:"questions"`
}

// WriteGrammarPractice writes one level's test: PracticeSetSize questions, mixed.
func (s *GrammarTutorService) WriteGrammarPractice(
	ctx context.Context, req GrammarPracticeRequest,
) ([]GeneratedPractice, *EvaluationMeta, error) {
	res, err := s.gateway.AnalyzeText(ctx, CallMeta{
		Task:          TaskContentGeneration,
		UserID:        req.ActorID,
		PromptVersion: GrammarPracticePrompt,
		Metadata:      map[string]any{"topic": req.Slug, "level": req.Level.BaseCode()},
	}, AnalysisRequest{
		// The main model: a question with two right answers marks a correct learner wrong,
		// and that is the mistake a cheaper model makes.
		Model:        s.mainModel,
		Instructions: practiceInstructions(),
		Input:        practiceBrief(req),
		SchemaName:   SchemaGrammarPractice,
		Schema:       grammarPracticeSchema,
	})
	if err != nil {
		return nil, nil, err
	}
	var out generatedPracticeSet
	if err := json.Unmarshal(res.Output, &out); err != nil {
		return nil, nil, fmt.Errorf("generated practice is not valid JSON: %w", err)
	}
	questions := UsablePractice(out.Questions)
	questions = s.checkPractice(ctx, req, questions)
	if len(questions) < minUsablePractice {
		return nil, nil, fmt.Errorf("only %d of %d generated questions can be marked", len(questions), len(out.Questions))
	}
	return questions, &EvaluationMeta{
		Versions:    Versions{SchemaVersion: GrammarSchemaVersion, ModelVersion: res.Model, PromptVersion: GrammarPracticePrompt},
		AIRequestID: res.AIRequestID,
	}, nil
}

func practiceInstructions() string {
	var b strings.Builder
	b.WriteString("You are writing the test for one English grammar point at one CEFR level, for a language-learning platform. ")
	b.WriteString("A learner takes it after reading the lesson you are given. Each question is marked automatically, so each must have exactly the answers you say it has.\n\n")
	b.WriteString(practiceRules)
	fmt.Fprintf(&b, "Write exactly %d questions: %d multiple_choice and %d fill_blank, mixed together rather than grouped by kind. ",
		practiceDraftSize, practiceDraftSize-practiceGapShare, practiceGapShare)
	b.WriteString("Cover every rule and every common mistake in the lesson, not the same rule fifteen times. Order them from easier to harder. ")
	b.WriteString("Use vocabulary the level knows: A1/A2 everyday words and short sentences; C1/C2 may use register and nuance. ")
	b.WriteString("Write prompts, options and explanations in plain English; at A1/A2 keep explanations to one short sentence. ")
	b.WriteString("Do not reuse the lesson's example sentences as questions.\n")
	return b.String()
}

func practiceBrief(req GrammarPracticeRequest) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Topic: %s\nLevel: %s\n", req.Topic, req.Level.BaseCode())
	if req.Category != "" {
		fmt.Fprintf(&b, "Category: %s\n", req.Category)
	}
	if strings.TrimSpace(req.Description) != "" {
		fmt.Fprintf(&b, "What it covers: %s\n", req.Description)
	}
	lesson := req.Lesson
	if lesson.Summary != "" {
		fmt.Fprintf(&b, "\nLesson summary: %s\n", lesson.Summary)
	}
	if lesson.Explanation != "" {
		fmt.Fprintf(&b, "Lesson explanation: %s\n", lesson.Explanation)
	}
	for _, f := range lesson.Formulas {
		fmt.Fprintf(&b, "Form — %s: %s\n", f.Label, f.Pattern)
	}
	if len(lesson.Usage) > 0 {
		fmt.Fprintf(&b, "Uses: %s\n", strings.Join(lesson.Usage, "; "))
	}
	for _, e := range lesson.Examples {
		fmt.Fprintf(&b, "Example (do not reuse): %s\n", e.Text)
	}
	for _, m := range lesson.CommonMistakes {
		fmt.Fprintf(&b, "Common mistake [%s]: %s → %s (%s)\n", m.Rule, m.Wrong, m.Right, m.Why)
	}
	return b.String()
}

var grammarPracticeSchema = json.RawMessage(`{
  "type": "object",
  "additionalProperties": false,
  "required": ["questions"],
  "properties": {
    "questions": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["type", "prompt", "options", "answer_index", "accepted", "hint", "explanation", "target_rule"],
        "properties": ` + practiceItemProperties + `
      }
    }
  }
}`)

// Checking the key.
//
// A question whose key is wrong marks every learner who gets it right as wrong, and the
// model that wrote it is the one most likely to believe it. So each question is answered
// again, cold, by a call that never sees the key: where the two disagree, or where the
// second call finds more than one acceptable answer, the question is dropped. Fewer, right
// questions beat fifteen with one that teaches the wrong rule.

type practiceCheck struct {
	Answers []struct {
		Index       int      `json:"index"`
		AnswerIndex int      `json:"answer_index"`
		AnswerText  string   `json:"answer_text"`
		Acceptable  []string `json:"acceptable"`
		Ambiguous   bool     `json:"ambiguous"`
	} `json:"answers"`
}

// checkPractice keeps the questions an independent answer agrees with, at most
// PracticeSetSize of them. If the check itself cannot run, the questions are kept as
// written: a provider hiccup should not cost the owner the whole test.
func (s *GrammarTutorService) checkPractice(ctx context.Context, req GrammarPracticeRequest, questions []GeneratedPractice) []GeneratedPractice {
	if len(questions) == 0 {
		return questions
	}
	res, err := s.gateway.AnalyzeText(ctx, CallMeta{
		Task:          TaskContentGeneration,
		UserID:        req.ActorID,
		PromptVersion: GrammarPracticeCheckPrompt,
		Metadata:      map[string]any{"topic": req.Slug, "level": req.Level.BaseCode(), "questions": len(questions)},
	}, AnalysisRequest{
		Model:        s.mainModel,
		Instructions: practiceCheckInstructions,
		Input:        practiceCheckInput(questions),
		SchemaName:   SchemaGrammarPracticeCheck,
		Schema:       grammarPracticeCheckSchema,
	})
	if err != nil {
		return capPractice(questions)
	}
	var check practiceCheck
	if err := json.Unmarshal(res.Output, &check); err != nil {
		return capPractice(questions)
	}
	return capPractice(agreedPractice(questions, check))
}

// agreedPractice keeps each question the check answered the same way, unambiguously.
func agreedPractice(questions []GeneratedPractice, check practiceCheck) []GeneratedPractice {
	kept := make([]GeneratedPractice, 0, len(questions))
	answered := map[int]bool{}
	for _, a := range check.Answers {
		if a.Index < 1 || a.Index > len(questions) || answered[a.Index] {
			continue
		}
		answered[a.Index] = true
		q := questions[a.Index-1]
		if a.Ambiguous {
			continue
		}
		if q.IsFillBlank() {
			// The gap keeps only the answers both sides accept, and must still accept the
			// checker's own. "I want to eat ___ banana" written with ["a", "an"] keeps "a".
			right := map[string]bool{normalizeChoice(a.AnswerText): true}
			for _, alt := range a.Acceptable {
				right[normalizeChoice(alt)] = true
			}
			var accepted []string
			agreed := false
			for _, ans := range q.Accepted {
				if right[normalizeChoice(ans)] {
					accepted = append(accepted, ans)
					if normalizeChoice(ans) == normalizeChoice(a.AnswerText) {
						agreed = true
					}
				}
			}
			if !agreed {
				continue
			}
			q.Accepted = accepted
		} else if a.AnswerIndex != q.AnswerIndex {
			continue
		}
		kept = append(kept, q)
	}
	// Kept in the order they were written, which runs from easier to harder.
	order := map[string]int{}
	for i, q := range questions {
		order[q.Prompt] = i
	}
	sort.SliceStable(kept, func(i, j int) bool { return order[kept[i].Prompt] < order[kept[j].Prompt] })
	return kept
}

func capPractice(questions []GeneratedPractice) []GeneratedPractice {
	if len(questions) > PracticeSetSize {
		return questions[:PracticeSetSize]
	}
	return questions
}

const practiceCheckInstructions = "You are checking an English grammar test before learners take it. Answer every question yourself, as a careful native-speaker teacher would. " +
	"For a multiple_choice question give answer_index, the position of the one correct option counting from zero, and leave answer_text empty. " +
	"For a fill_blank question give answer_text, exactly the word(s) that go in the ___ gap (not the whole sentence), list in acceptable every other fill that is also correct (contracted forms, for example; empty when there are none), and set answer_index to -1. " +
	"An option counts as correct whenever it gives a grammatical, natural sentence, even if the meaning changes — \"I have the cat\" is correct English. " +
	"Set ambiguous to true when more than one option is correct, when no option is correct, or when the gap could reasonably be filled in more than one way that changes which grammar is being tested. " +
	"Use standard modern English as taught to learners; do not mark a question ambiguous only because of a rare dialect. Return one answer per question, with its number as index."

func practiceCheckInput(questions []GeneratedPractice) string {
	var b strings.Builder
	for i, q := range questions {
		if q.IsFillBlank() {
			fmt.Fprintf(&b, "%d. [fill_blank] %s", i+1, q.Prompt)
			if q.Hint != "" {
				fmt.Fprintf(&b, " %s", q.Hint)
			}
			b.WriteString("\n")
			continue
		}
		fmt.Fprintf(&b, "%d. [multiple_choice] %s\n", i+1, q.Prompt)
		for j, o := range q.Options {
			fmt.Fprintf(&b, "   %d) %s\n", j, o)
		}
	}
	return b.String()
}

var grammarPracticeCheckSchema = json.RawMessage(`{
  "type": "object",
  "additionalProperties": false,
  "required": ["answers"],
  "properties": {
    "answers": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["index", "answer_index", "answer_text", "acceptable", "ambiguous"],
        "properties": {
          "index": { "type": "integer", "description": "The question's number, from 1." },
          "answer_index": { "type": "integer", "description": "multiple_choice: the correct option, from 0. fill_blank: -1." },
          "answer_text": { "type": "string", "description": "fill_blank: the word(s) for the gap. multiple_choice: empty." },
          "acceptable": {
            "type": "array",
            "items": { "type": "string" },
            "description": "fill_blank: other fills that are equally correct. Empty otherwise."
          },
          "ambiguous": { "type": "boolean", "description": "True when the question does not have exactly one right answer." }
        }
      }
    }
  }
}`)
