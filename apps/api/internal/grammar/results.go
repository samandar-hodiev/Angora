package grammar

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"

	"github.com/google/uuid"
)

// Scoring a run, turning what went wrong into weaknesses, and choosing what to do next.
//
// The breakdowns matter more than the score. "78%" tells a learner nothing they can act on;
// "negatives 65%, questions 61%, affirmative 92%" tells them exactly what to practise, and
// gives the coach something specific to recommend.

// difficultyBands group questions into something a learner can read.
var difficultyBands = []struct {
	key, label string
	max        float64
}{
	{"easy", "Easier", 0.35},
	{"medium", "Medium", 0.65},
	{"hard", "Harder", 1.01},
}

func bandOf(difficulty float64) (string, string) {
	for _, b := range difficultyBands {
		if difficulty < b.max {
			return b.key, b.label
		}
	}
	return "hard", "Harder"
}

// questionTypeLabels name the types for learners. "fill_blank" is an implementation detail.
var questionTypeLabels = map[string]string{
	TypeMultipleChoice:  "Multiple choice",
	TypeFillBlank:       "Fill in the blank",
	TypeOrdering:        "Sentence ordering",
	TypeErrorCorrection: "Error correction",
	TypeTransformation:  "Transformation",
	TypeMatching:        "Matching",
	TypeShortAnswer:     "Short answer",
	TypeFreeWriting:     "Free writing",
	TypeContextual:      "Contextual usage",
}

// weakAccuracy is the accuracy below which a rule is reported as a weakness.
const weakAccuracy = 70.0

func (m *Module) buildResult(ctx context.Context, userID uuid.UUID, a attemptRow) (Result, error) {
	result := Result{
		AttemptID: a.ID, TopicSlug: a.TopicSlug, TopicName: a.TopicName, Mode: a.Mode,
		Total: a.Total, ByRule: []TypeAccuracy{}, ByType: []TypeAccuracy{},
		ByDifficulty: []TypeAccuracy{}, Weaknesses: []string{}, Review: []ReviewItem{},
	}

	rows, err := m.pool.Query(ctx, `
		SELECT ans.grammar_question_id, q.prompt, ans.is_correct, ans.score::float8, ans.question_type,
		       ans.target_rule, ans.difficulty::float8, q.explanation, ans.response, ans.feedback
		FROM grammar_answers ans
		JOIN grammar_questions q ON q.id = ans.grammar_question_id
		WHERE ans.attempt_id = $1 AND ans.user_id = $2
		ORDER BY ans.created_at`, a.ID, userID)
	if err != nil {
		return result, err
	}
	defer rows.Close()

	byRule := map[string]*TypeAccuracy{}
	byType := map[string]*TypeAccuracy{}
	byBand := map[string]*TypeAccuracy{}
	var scoreSum float64
	answered := 0

	for rows.Next() {
		var (
			item        ReviewItem
			questionID  uuid.UUID
			score       float64
			qType, rule string
			difficulty  float64
			responseRaw []byte
			feedbackRaw []byte
			explanation string
		)
		if err := rows.Scan(&questionID, &item.Prompt, &item.Correct, &score, &qType, &rule,
			&difficulty, &explanation, &responseRaw, &feedbackRaw); err != nil {
			return result, err
		}
		answered++
		scoreSum += score
		if item.Correct {
			result.Correct++
		}

		item.QuestionID = questionID.String()
		item.Explanation = explanation
		item.Rule = rule
		_ = json.Unmarshal(responseRaw, &item.Response)
		var feedback struct {
			Expected string `json:"expected"`
		}
		if json.Unmarshal(feedbackRaw, &feedback) == nil {
			item.Expected = feedback.Expected
		}
		result.Review = append(result.Review, item)

		if rule != "" {
			tally(byRule, rule, humanizeRule(rule), item.Correct)
		}
		tally(byType, qType, labelOr(questionTypeLabels, qType), item.Correct)
		bandKey, bandLabel := bandOf(difficulty)
		tally(byBand, bandKey, bandLabel, item.Correct)
	}
	if err := rows.Err(); err != nil {
		return result, err
	}

	// Unanswered questions count against the run: skipping ten questions is not a 100%.
	if a.Total > 0 {
		result.Score = round2(scoreSum / float64(a.Total) * 100)
	}

	result.ByRule = sortedAccuracy(byRule)
	result.ByType = sortedAccuracy(byType)
	result.ByDifficulty = orderedBands(byBand)
	for _, r := range result.ByRule {
		if r.Accuracy < weakAccuracy {
			result.Weaknesses = append(result.Weaknesses, r.Label)
		}
	}
	return result, nil
}

func tally(into map[string]*TypeAccuracy, key, label string, correct bool) {
	entry, ok := into[key]
	if !ok {
		entry = &TypeAccuracy{Key: key, Label: label}
		into[key] = entry
	}
	entry.Total++
	if correct {
		entry.Correct++
	}
	entry.Accuracy = round2(float64(entry.Correct) / float64(entry.Total) * 100)
}

// sortedAccuracy puts the weakest first: the point of a breakdown is what to fix.
func sortedAccuracy(in map[string]*TypeAccuracy) []TypeAccuracy {
	out := make([]TypeAccuracy, 0, len(in))
	for _, v := range in {
		out = append(out, *v)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Accuracy != out[j].Accuracy {
			return out[i].Accuracy < out[j].Accuracy
		}
		return out[i].Key < out[j].Key
	})
	return out
}

// orderedBands keeps easy → hard, where the order is the meaning.
func orderedBands(in map[string]*TypeAccuracy) []TypeAccuracy {
	out := make([]TypeAccuracy, 0, len(in))
	for _, b := range difficultyBands {
		if v, ok := in[b.key]; ok {
			out = append(out, *v)
		}
	}
	return out
}

func labelOr(labels map[string]string, key string) string {
	if l, ok := labels[key]; ok {
		return l
	}
	return key
}

// humanizeRule turns "negative-base-form" into "Negative base form" for display. Rules are
// authored as slugs so they are stable identifiers; learners never see the slug.
func humanizeRule(rule string) string {
	out := []rune(rule)
	for i, r := range out {
		if r == '-' || r == '_' {
			out[i] = ' '
		}
	}
	if len(out) > 0 && out[0] >= 'a' && out[0] <= 'z' {
		out[0] -= 32
	}
	return string(out)
}

// recordError books a wrong answer against the rule it tested. This is what turns practice
// into a weakness signal, and it is the same store the coach and the writing/speaking
// analysers write into.
func (m *Module) recordError(ctx context.Context, userID, topicID uuid.UUID, q Question, wrote, expected, source string) error {
	rule := q.TargetRule
	if rule == "" {
		rule = q.Type
	}
	_, err := m.pool.Exec(ctx, `
		INSERT INTO grammar_user_errors
			(user_id, grammar_topic_id, target_rule, occurrences, last_example, last_correction,
			 severity_score, last_source, last_seen_at)
		VALUES ($1, $2, $3, 1, $4, $5, 20, $6, now())
		ON CONFLICT (user_id, grammar_topic_id, target_rule) DO UPDATE SET
			occurrences = grammar_user_errors.occurrences + 1,
			last_example = EXCLUDED.last_example,
			last_correction = EXCLUDED.last_correction,
			last_source = EXCLUDED.last_source,
			last_seen_at = now(),
			-- Severity climbs with repetition and saturates: the tenth mistake of a kind does
			-- not make it five times more urgent than the fifth.
			severity_score = LEAST(100, 20 + 12 * ln(grammar_user_errors.occurrences + 1))`,
		userID, topicID, rule, truncate(wrote, 300), truncate(expected, 300), source)
	return err
}

// syncWeaknesses promotes this topic's recurring errors into the global weaknesses table —
// the one the AI Coach, the learning plan and the Progress page already read. Grammar does
// not get a second weakness engine.
func (m *Module) syncWeaknesses(ctx context.Context, userID, topicID uuid.UUID) error {
	_, err := m.pool.Exec(ctx, `
		INSERT INTO weaknesses (user_id, skill_id, category, severity_score, evidence_count, status, last_detected_at)
		SELECT $1,
		       (SELECT id FROM skills WHERE code = 'grammar'),
		       'grammar.' || t.slug || CASE WHEN e.target_rule = '' THEN '' ELSE '.' || e.target_rule END,
		       e.severity_score, e.occurrences,
		       CASE WHEN e.severity_score < 25 THEN 'improving' ELSE 'active' END,
		       e.last_seen_at
		FROM grammar_user_errors e
		JOIN grammar_topics t ON t.id = e.grammar_topic_id
		WHERE e.user_id = $1 AND e.grammar_topic_id = $2
		ON CONFLICT (user_id, category) DO UPDATE SET
			severity_score = EXCLUDED.severity_score,
			evidence_count = EXCLUDED.evidence_count,
			status = EXCLUDED.status,
			last_detected_at = EXCLUDED.last_detected_at`, userID, topicID)
	return err
}

// nextStep picks the single most useful thing to do after a run. The order is the teaching
// order: fix what is broken, then apply what works, then move on.
func (m *Module) nextStep(ctx context.Context, userID, topicID uuid.UUID, r Result) (*NextStep, error) {
	// 1. A rule they are still getting wrong: practise that rule specifically.
	for _, rule := range r.ByRule {
		if rule.Accuracy < weakAccuracy && rule.Total > 1 {
			return &NextStep{
				Kind: "practice_rule", Topic: r.TopicSlug, Rule: rule.Key,
				Label:  fmt.Sprintf("Practise %s", rule.Label),
				Reason: fmt.Sprintf("%d of %d wrong in this run", rule.Total-rule.Correct, rule.Total),
			}, nil
		}
	}

	// 2. Solid in exercises but never used in their own English: go and use it.
	if r.Mastery.Practice >= masteredPractice && r.Mastery.Application < developingScore {
		return &NextStep{
			Kind: "apply_writing", Topic: r.TopicSlug,
			Label:  fmt.Sprintf("Write using %s", r.TopicName),
			Reason: "You know the rule — the next step is using it in your own writing",
		}, nil
	}

	// 3. Ready to move on: the next topic in the curriculum graph.
	var nextSlug, nextName string
	err := m.pool.QueryRow(ctx, `
		SELECT t.slug, t.name
		FROM grammar_relations r
		JOIN grammar_topics t ON t.id = r.to_topic_id AND t.status = 'published'
		LEFT JOIN user_grammar_progress p ON p.grammar_topic_id = t.id AND p.user_id = $1
		WHERE r.from_topic_id = $2 AND r.kind = 'next'
		  AND COALESCE(p.state, 'not_started') <> 'mastered'
		ORDER BY r.sort_order
		LIMIT 1`, userID, topicID).Scan(&nextSlug, &nextName)
	if err != nil {
		return nil, nil //nolint:nilerr // no next topic is a normal outcome, not a failure
	}
	return &NextStep{
		Kind: "next_topic", Topic: nextSlug, Label: "Learn " + nextName,
		Reason: "The natural next step after " + r.TopicName,
	}, nil
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}
