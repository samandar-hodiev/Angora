// Package practice serves reading and listening practice: a published passage or clip, the
// questions attached to it, and an attempt that is marked against the stored answer key.
//
// Reading and listening are one package because they are the same thing twice: a stimulus,
// objective questions, and a score that can be computed exactly. The skill is a parameter,
// not a second implementation.
//
// Nothing here asks an AI whether an answer is right. The answer key decides that, in Go, so
// the same submission always produces the same score and a result recorded a year ago can be
// recomputed. AI belongs to the explanation of a mistake, which is a separate, optional call.
package practice

import (
	"strings"
	"unicode"
)

// Answer is what the learner submitted for one question. Objective questions carry an
// option id; gap-fill and short answer carry text.
type Answer struct {
	OptionID string `json:"option_id,omitempty"`
	Text     string `json:"text,omitempty"`
}

// Key is the stored answer for one question, as authored in the question bank.
type Key struct {
	OptionID string `json:"option_id,omitempty"`
	Text     string `json:"text,omitempty"`
	// Accept lists further spellings that count as correct, e.g. "colour" for "color".
	Accept []string `json:"accept,omitempty"`
}

// Mark is the outcome for one question, returned to the learner after they finish.
type Mark struct {
	QuestionID  string `json:"question_id"`
	Correct     bool   `json:"correct"`
	Answered    bool   `json:"answered"`
	Given       Answer `json:"given"`
	Expected    Key    `json:"expected"`
	Explanation string `json:"explanation,omitempty"`
	/** The rule or skill the question targets; feeds mistake and weakness tracking. */
	Target string `json:"target,omitempty"`
}

// Result is the whole attempt, marked.
type Result struct {
	Correct int `json:"correct"`
	Total   int `json:"total"`
	/** 0–100, rounded to two decimals. An attempt with no questions scores zero, not NaN. */
	Score float64 `json:"score"`
	Marks []Mark  `json:"marks"`
}

// Question is the part of a bank item that marking needs.
type Question struct {
	ID          string
	Key         Key
	Explanation string
	Target      string
}

// normalize makes free-text comparison forgiving of the things that are not being tested:
// case, surrounding space, repeated spaces, and trailing punctuation. It deliberately does
// not touch spelling — a spelling mistake in a listening gap-fill is a wrong answer, and
// pretending otherwise would teach the wrong thing.
func normalize(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	lastSpace := false
	for _, r := range s {
		switch {
		case unicode.IsSpace(r):
			if !lastSpace && b.Len() > 0 {
				b.WriteRune(' ')
			}
			lastSpace = true
		case unicode.IsPunct(r) && (r == '.' || r == ',' || r == '!' || r == '?' || r == ';' || r == ':'):
			// Sentence punctuation is not part of the answer.
		default:
			b.WriteRune(r)
			lastSpace = false
		}
	}
	return strings.TrimSpace(b.String())
}

// MarkOne decides a single question. An unanswered question is wrong, not skipped: a learner
// who leaves half a test blank has not scored 100%.
func MarkOne(q Question, given Answer, answered bool) Mark {
	mark := Mark{QuestionID: q.ID, Answered: answered, Given: given, Expected: q.Key,
		Explanation: q.Explanation, Target: q.Target}
	if !answered {
		return mark
	}

	if q.Key.OptionID != "" {
		mark.Correct = given.OptionID != "" && given.OptionID == q.Key.OptionID
		return mark
	}

	if q.Key.Text != "" || len(q.Key.Accept) > 0 {
		got := normalize(given.Text)
		if got == "" {
			return mark
		}
		if got == normalize(q.Key.Text) {
			mark.Correct = true
			return mark
		}
		for _, accepted := range q.Key.Accept {
			if got == normalize(accepted) {
				mark.Correct = true
				return mark
			}
		}
	}
	return mark
}

// Score marks a whole attempt. Questions the learner never answered are included, so the
// total is the number of questions asked rather than the number attempted.
func Score(questions []Question, answers map[string]Answer) Result {
	result := Result{Total: len(questions), Marks: make([]Mark, 0, len(questions))}
	for _, q := range questions {
		given, answered := answers[q.ID]
		mark := MarkOne(q, given, answered)
		if mark.Correct {
			result.Correct++
		}
		result.Marks = append(result.Marks, mark)
	}
	if result.Total > 0 {
		result.Score = float64(int(float64(result.Correct)/float64(result.Total)*10000+0.5)) / 100
	}
	return result
}
