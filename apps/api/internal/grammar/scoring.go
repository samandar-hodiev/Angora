package grammar

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"
)

// Deterministic scoring.
//
// Everything a computer can mark, a computer marks: multiple choice, gap fills, ordering,
// error correction, transformation and matching are all decided here, in Go, for free and
// in microseconds. Only free writing — where the learner produces their own sentences —
// reaches an AI model.
//
// This is not only about cost. A deterministic marker gives the same answer every time,
// can be unit tested, and cannot be talked out of a correct mark by the learner's phrasing.

// Question is a practice question as the engine sees it. Answer is never serialised to a
// learner: startPractice strips it.
type Question struct {
	ID          string          `json:"id"`
	TopicSlug   string          `json:"topic"`
	Type        string          `json:"type"`
	Level       *string         `json:"level"`
	Difficulty  float64         `json:"difficulty"`
	Prompt      string          `json:"prompt"`
	Payload     QuestionPayload `json:"payload"`
	Explanation string          `json:"explanation,omitempty"`
	TargetRule  string          `json:"target_rule"`
	Tags        []string        `json:"tags"`

	answer Answer
}

// QuestionPayload carries the type-specific parts a learner sees.
type QuestionPayload struct {
	// multiple_choice, contextual
	Options []string `json:"options,omitempty"`
	// ordering: the segments, already shuffled for presentation
	Segments []string `json:"segments,omitempty"`
	// fill_blank: the hint shown in brackets, e.g. "go"
	Hint string `json:"hint,omitempty"`
	// error_correction / transformation: the sentence to work on and what to do with it
	Sentence    string `json:"sentence,omitempty"`
	Instruction string `json:"instruction,omitempty"`
	// matching: the two columns to pair up
	Left  []string `json:"left,omitempty"`
	Right []string `json:"right,omitempty"`
	// free_writing
	MinWords int `json:"min_words,omitempty"`
	MaxWords int `json:"max_words,omitempty"`
}

// Answer is the marking key (grammar_questions.answer). It never leaves the server.
type Answer struct {
	// multiple_choice / contextual: index into Payload.Options.
	CorrectIndex *int `json:"correct_index,omitempty"`
	// fill_blank, error_correction, transformation, short_answer: every accepted answer.
	// More than one is normal ("don't" and "do not" are the same answer).
	Accepted []string `json:"accepted,omitempty"`
	// ordering: the segments in the right order.
	Order []string `json:"order,omitempty"`
	// matching: left index → right index.
	Pairs map[string]int `json:"pairs,omitempty"`
	// free_writing: what the AI analysis must find for the answer to count.
	TargetForms []string `json:"target_forms,omitempty"`
}

// Response is what the learner sent back.
type Response struct {
	// multiple_choice / contextual
	Index *int `json:"index,omitempty"`
	// fill_blank, error_correction, transformation, short_answer, free_writing
	Text string `json:"text,omitempty"`
	// ordering
	Order []string `json:"order,omitempty"`
	// matching: left index → right index
	Pairs map[string]int `json:"pairs,omitempty"`
}

// Mark is the outcome of scoring one answer.
type Mark struct {
	Correct bool    `json:"correct"`
	Score   float64 `json:"score"`
	// Expected is the model answer, shown in learning mode only.
	Expected string `json:"expected,omitempty"`
	// NeedsAI is set for free writing: the engine cannot mark it alone.
	NeedsAI bool `json:"-"`
}

// Score marks a response against a question. It never returns an error: an unparseable or
// missing response is simply wrong, which is what it is from the learner's point of view.
func Score(q Question, r Response) Mark {
	switch q.Type {
	case TypeMultipleChoice, TypeContextual:
		return scoreChoice(q, r)
	case TypeFillBlank, TypeErrorCorrection, TypeTransformation, TypeShortAnswer:
		return scoreText(q, r)
	case TypeOrdering:
		return scoreOrdering(q, r)
	case TypeMatching:
		return scoreMatching(q, r)
	case TypeFreeWriting:
		return Mark{NeedsAI: true}
	default:
		return Mark{}
	}
}

// Question types. They mirror the grammar_questions CHECK constraint.
const (
	TypeMultipleChoice  = "multiple_choice"
	TypeFillBlank       = "fill_blank"
	TypeOrdering        = "ordering"
	TypeErrorCorrection = "error_correction"
	TypeTransformation  = "transformation"
	TypeMatching        = "matching"
	TypeShortAnswer     = "short_answer"
	TypeFreeWriting     = "free_writing"
	TypeContextual      = "contextual"
)

func scoreChoice(q Question, r Response) Mark {
	if q.answer.CorrectIndex == nil {
		return Mark{}
	}
	expected := ""
	if i := *q.answer.CorrectIndex; i >= 0 && i < len(q.Payload.Options) {
		expected = q.Payload.Options[i]
	}
	correct := r.Index != nil && *r.Index == *q.answer.CorrectIndex
	return Mark{Correct: correct, Score: boolScore(correct), Expected: expected}
}

func scoreText(q Question, r Response) Mark {
	got := normalizeAnswer(r.Text)
	expected := ""
	if len(q.answer.Accepted) > 0 {
		expected = q.answer.Accepted[0]
	}
	if got == "" {
		return Mark{Expected: expected}
	}
	for _, accepted := range q.answer.Accepted {
		if normalizeAnswer(accepted) == got {
			return Mark{Correct: true, Score: 1, Expected: expected}
		}
	}
	return Mark{Expected: expected}
}

func scoreOrdering(q Question, r Response) Mark {
	expected := strings.Join(q.answer.Order, " ")
	if len(r.Order) != len(q.answer.Order) {
		return Mark{Expected: expected}
	}
	for i := range r.Order {
		if normalizeAnswer(r.Order[i]) != normalizeAnswer(q.answer.Order[i]) {
			return Mark{Expected: expected}
		}
	}
	return Mark{Correct: true, Score: 1, Expected: expected}
}

// scoreMatching gives partial credit: getting three pairs of four right is not the same as
// getting none, and a learner who sees 0 for a near-miss stops trusting the score.
func scoreMatching(q Question, r Response) Mark {
	if len(q.answer.Pairs) == 0 {
		return Mark{}
	}
	hits := 0
	for left, right := range q.answer.Pairs {
		if got, ok := r.Pairs[left]; ok && got == right {
			hits++
		}
	}
	score := float64(hits) / float64(len(q.answer.Pairs))
	return Mark{Correct: hits == len(q.answer.Pairs), Score: score, Expected: describePairs(q)}
}

func describePairs(q Question) string {
	keys := make([]string, 0, len(q.answer.Pairs))
	for k := range q.answer.Pairs {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		ri := q.answer.Pairs[k]
		li := atoiSafe(k)
		if li >= 0 && li < len(q.Payload.Left) && ri >= 0 && ri < len(q.Payload.Right) {
			parts = append(parts, q.Payload.Left[li]+" → "+q.Payload.Right[ri])
		}
	}
	return strings.Join(parts, "; ")
}

func atoiSafe(s string) int {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return -1
		}
		n = n*10 + int(r-'0')
	}
	if s == "" {
		return -1
	}
	return n
}

var (
	// Curly quotes and apostrophes: a learner typing didn’t on a phone is not making a
	// grammar mistake.
	quoteReplacer = strings.NewReplacer("’", "'", "‘", "'", "“", "\"", "”", "\"")
	spaceRun      = regexp.MustCompile(`\s+`)
	// Trailing sentence punctuation only. Apostrophes and hyphens are part of English words
	// (don't, well-known) and are never stripped.
	trailingPunct = regexp.MustCompile(`[.!?,;:]+$`)
)

// normalizeAnswer decides what counts as "the same answer". It forgives case, spacing,
// smart quotes and a trailing full stop — never a different word or a different form.
func normalizeAnswer(s string) string {
	s = quoteReplacer.Replace(s)
	s = strings.ToLower(strings.TrimSpace(s))
	s = spaceRun.ReplaceAllString(s, " ")
	s = trailingPunct.ReplaceAllString(s, "")
	return strings.TrimSpace(s)
}

func boolScore(b bool) float64 {
	if b {
		return 1
	}
	return 0
}

// WordCount counts words the way a writing task does.
func WordCount(s string) int {
	return len(strings.Fields(s))
}

func parseAnswer(raw []byte) (Answer, error) {
	var a Answer
	if len(raw) == 0 {
		return a, nil
	}
	err := json.Unmarshal(raw, &a)
	return a, err
}
