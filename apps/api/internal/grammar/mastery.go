package grammar

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
)

// Mastery.
//
// A learner who scores 90% on one ten-question quiz has not mastered a tense. They have
// shown one thing, once, on easy questions, possibly by recognising options rather than
// producing the form. So mastery here is not the last score; it is three signals combined:
//
//	understanding   they read the rule, asked about it, looked at the visual
//	practice        they get exercises right — weighted by difficulty and by how recently
//	application     they use it correctly in their own writing and speaking
//
// and it fades. Grammar you have not touched in three months is not grammar you still have,
// so the practice and application signals decay with time since the last practice. Every
// number in here is a product decision rather than a formula from a paper; they live in one
// place so they can be tuned without touching the engine.
const (
	weightUnderstanding = 0.25
	weightPractice      = 0.45
	weightApplication   = 0.30

	// How recent answers are weighted against older ones. An answer from today counts
	// roughly twice one from three weeks ago.
	answerHalfLifeDays = 21.0
	// Only the most recent answers count towards practice: improvement should show up
	// quickly, and a bad first session should not follow a learner forever.
	practiceWindow = 40

	// How far mastery can fade from disuse, and how long that takes.
	maxDecay     = 0.30
	decayDays    = 120.0
	decayGrace   = 14.0 // nothing fades in the first two weeks
	errorPenalty = 0.35 // how much a topic's own recurring errors pull practice down
)

// Mastery state thresholds. Mastered deliberately needs more than a score: repeated
// practice and evidence the learner can use the form, not only recognise it.
const (
	masteredScore    = 80.0
	masteredPractice = 75.0
	masteredAttempts = 2
	developingScore  = 50.0
)

// AnswerSignal is one marked answer, as mastery sees it.
type AnswerSignal struct {
	// Score is 0..1.
	Score float64
	// Difficulty is 0..1. Harder questions carry more weight: getting a hard one right
	// says more than getting an easy one right.
	Difficulty float64
	AgeDays    float64
	// Produced is true when the learner had to write the form rather than pick it. It
	// counts for more, for the same reason.
	Produced bool
}

// ApplicationSignal is evidence from real use — the learner's own writing or speaking.
type ApplicationSignal struct {
	// Score is 0..1: how well the target grammar was used.
	Score   float64
	AgeDays float64
}

// MasterySignals is everything the calculation reads.
type MasterySignals struct {
	Opened bool
	// ExplanationRead and VisualViewed are the other two understanding signals.
	ExplanationRead bool
	VisualViewed    bool

	Answers      []AnswerSignal
	Applications []ApplicationSignal

	// Attempts is completed practice runs, not questions.
	Attempts int
	// ErrorSeverity is 0..100 from this topic's recurring errors.
	ErrorSeverity float64
	// DaysSinceLastPractice is 0 when the learner has just practised.
	DaysSinceLastPractice float64
}

// MasteryResult is what gets written to user_grammar_progress, and what clients read.
type MasteryResult struct {
	Mastery       float64 `json:"mastery"`
	Understanding float64 `json:"understanding"`
	Practice      float64 `json:"practice"`
	Application   float64 `json:"application"`
	State         string  `json:"state"`
}

// ComputeMastery is pure: same signals, same result, no database and no clock. That is what
// makes the algorithm testable and what lets it be tuned with confidence.
func ComputeMastery(s MasterySignals) MasteryResult {
	understanding := computeUnderstanding(s)
	practice := computePractice(s)
	application := computeApplication(s.Applications)

	decay := decayFactor(s.DaysSinceLastPractice)
	practice *= decay
	application *= decay

	mastery := weightUnderstanding*understanding + weightPractice*practice + weightApplication*application

	return MasteryResult{
		Mastery:       round2(clamp(mastery, 0, 100)),
		Understanding: round2(clamp(understanding, 0, 100)),
		Practice:      round2(clamp(practice, 0, 100)),
		Application:   round2(clamp(application, 0, 100)),
		State:         masteryState(mastery, practice, s),
	}
}

// computeUnderstanding rewards engaging with the explanation, but caps low: reading is
// where learning starts, not where it ends. Practice accuracy carries the rest, because
// answering correctly is itself evidence of understanding.
func computeUnderstanding(s MasterySignals) float64 {
	score := 0.0
	if s.Opened {
		score += 25
	}
	if s.ExplanationRead {
		score += 15
	}
	if s.VisualViewed {
		score += 10
	}
	if len(s.Answers) > 0 {
		accuracy := 0.0
		for _, a := range s.Answers {
			accuracy += a.Score
		}
		score += (accuracy / float64(len(s.Answers))) * 50
	}
	return score
}

// computePractice is a weighted mean of recent answers. Recency, difficulty and whether the
// learner produced the form all raise an answer's weight, then recurring errors on this
// topic pull the result down.
func computePractice(s MasterySignals) float64 {
	answers := s.Answers
	if len(answers) == 0 {
		return 0
	}
	if len(answers) > practiceWindow {
		answers = answers[:practiceWindow] // callers pass newest first
	}

	var weighted, total float64
	for _, a := range answers {
		w := math.Pow(0.5, a.AgeDays/answerHalfLifeDays)
		w *= 0.6 + a.Difficulty // 0.6 at difficulty 0, 1.6 at difficulty 1
		if a.Produced {
			w *= 1.25
		}
		weighted += clamp(a.Score, 0, 1) * w
		total += w
	}
	if total == 0 {
		return 0
	}
	score := weighted / total * 100

	// A topic the learner keeps getting wrong in the wild is not a practised topic, however
	// well the last quiz went.
	return score * (1 - errorPenalty*clamp(s.ErrorSeverity/100, 0, 1))
}

func computeApplication(signals []ApplicationSignal) float64 {
	if len(signals) == 0 {
		return 0
	}
	var weighted, total float64
	for _, a := range signals {
		w := math.Pow(0.5, a.AgeDays/answerHalfLifeDays)
		weighted += clamp(a.Score, 0, 1) * w
		total += w
	}
	if total == 0 {
		return 0
	}
	return weighted / total * 100
}

// decayFactor fades unused grammar, after a grace period and never below 1-maxDecay:
// forgetting is real, but a learner returning after a break should not find their progress
// erased.
func decayFactor(days float64) float64 {
	if days <= decayGrace {
		return 1
	}
	elapsed := (days - decayGrace) / decayDays
	return 1 - maxDecay*clamp(elapsed, 0, 1)
}

func masteryState(mastery, practice float64, s MasterySignals) string {
	switch {
	case !s.Opened && len(s.Answers) == 0:
		return StateNotStarted
	case mastery >= masteredScore && practice >= masteredPractice && s.Attempts >= masteredAttempts:
		return StateMastered
	case mastery >= developingScore:
		return StateDeveloping
	case len(s.Answers) > 0:
		return StatePracticing
	default:
		return StateLearning
	}
}

func clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

func round2(v float64) float64 { return math.Round(v*100) / 100 }

// recomputeMastery reloads every signal for one topic and writes the result. It runs after
// a practice run completes and after writing or speaking evidence arrives, so the stored
// number is always derived from the full history rather than nudged by the last event.
func (m *Module) recomputeMastery(ctx context.Context, userID, topicID uuid.UUID) (MasteryResult, error) {
	var s MasterySignals

	// Every understanding signal is this learner's own. A cached explanation or a generated
	// visual existing for the topic says nothing about whether they ever looked at it.
	var openedAt, explainedAt, visualViewedAt, lastPracticed *time.Time
	err := m.pool.QueryRow(ctx, `
		SELECT p.opened_at, p.explained_at, p.visual_viewed_at, p.last_practiced_at,
		       COALESCE(p.attempts, 0),
		       COALESCE((SELECT max(e.severity_score) FROM grammar_user_errors e
		                  WHERE e.user_id = $1 AND e.grammar_topic_id = $2), 0)::float8
		FROM (SELECT $1::uuid AS user_id) u
		LEFT JOIN user_grammar_progress p ON p.user_id = u.user_id AND p.grammar_topic_id = $2`,
		userID, topicID).
		Scan(&openedAt, &explainedAt, &visualViewedAt, &lastPracticed, &s.Attempts, &s.ErrorSeverity)
	if err != nil {
		return MasteryResult{}, err
	}
	s.Opened = openedAt != nil
	s.ExplanationRead = explainedAt != nil
	s.VisualViewed = visualViewedAt != nil
	s.DaysSinceLastPractice = daysSince(lastPracticed)

	rows, err := m.pool.Query(ctx, `
		SELECT a.score::float8, a.difficulty::float8, a.question_type,
		       EXTRACT(EPOCH FROM (now() - a.created_at)) / 86400
		FROM grammar_answers a
		JOIN grammar_questions q ON q.id = a.grammar_question_id
		WHERE a.user_id = $1 AND q.grammar_topic_id = $2
		ORDER BY a.created_at DESC
		LIMIT $3`, userID, topicID, practiceWindow)
	if err != nil {
		return MasteryResult{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var a AnswerSignal
		var qType string
		if err := rows.Scan(&a.Score, &a.Difficulty, &qType, &a.AgeDays); err != nil {
			return MasteryResult{}, err
		}
		a.Produced = producedTypes[qType]
		if qType == TypeFreeWriting {
			// Free writing is the learner using the grammar in their own sentences: that is
			// application evidence, not just another exercise.
			s.Applications = append(s.Applications, ApplicationSignal{Score: a.Score, AgeDays: a.AgeDays})
		}
		s.Answers = append(s.Answers, a)
	}
	if err := rows.Err(); err != nil {
		return MasteryResult{}, err
	}

	// Evidence from real practice elsewhere: a mistake on this topic while speaking or
	// writing is application evidence too — negative evidence.
	appRows, err := m.pool.Query(ctx, `
		SELECT EXTRACT(EPOCH FROM (now() - created_at)) / 86400
		FROM mistakes
		WHERE user_id = $1 AND grammar_topic_id = $2
		  AND source_type IN ('speaking_session', 'writing_submission')
		ORDER BY created_at DESC
		LIMIT 20`, userID, topicID)
	if err != nil {
		return MasteryResult{}, err
	}
	defer appRows.Close()
	for appRows.Next() {
		var ageDays float64
		if err := appRows.Scan(&ageDays); err != nil {
			return MasteryResult{}, err
		}
		s.Applications = append(s.Applications, ApplicationSignal{Score: 0, AgeDays: ageDays})
	}
	if err := appRows.Err(); err != nil {
		return MasteryResult{}, err
	}

	result := ComputeMastery(s)
	_, err = m.pool.Exec(ctx, `
		INSERT INTO user_grammar_progress
			(user_id, grammar_topic_id, mastery, understanding, practice, application, state, mastered_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 = 'mastered' THEN now() END)
		ON CONFLICT (user_id, grammar_topic_id) DO UPDATE SET
			mastery = EXCLUDED.mastery,
			understanding = EXCLUDED.understanding,
			practice = EXCLUDED.practice,
			application = EXCLUDED.application,
			state = EXCLUDED.state,
			-- Keep the first time they reached mastery, not the most recent recomputation.
			mastered_at = COALESCE(user_grammar_progress.mastered_at,
			                       CASE WHEN EXCLUDED.state = 'mastered' THEN now() END)`,
		userID, topicID, result.Mastery, result.Understanding, result.Practice, result.Application, result.State)
	return result, err
}

// producedTypes are the question types where the learner writes the form themselves rather
// than recognising it among options.
var producedTypes = map[string]bool{
	TypeFillBlank:       true,
	TypeErrorCorrection: true,
	TypeTransformation:  true,
	TypeShortAnswer:     true,
	TypeFreeWriting:     true,
	TypeOrdering:        true,
}

func daysSince(t *time.Time) float64 {
	if t == nil {
		return 0
	}
	return time.Since(*t).Hours() / 24
}

// markOpened records that a learner has opened a topic — the first understanding signal.
func (m *Module) markOpened(ctx context.Context, userID, topicID uuid.UUID) error {
	_, err := m.pool.Exec(ctx, `
		INSERT INTO user_grammar_progress (user_id, grammar_topic_id, state, opened_at, understanding)
		VALUES ($1, $2, 'learning', now(), 25)
		ON CONFLICT (user_id, grammar_topic_id) DO UPDATE SET
			opened_at = COALESCE(user_grammar_progress.opened_at, now()),
			state = CASE WHEN user_grammar_progress.state = 'not_started' THEN 'learning'
			             ELSE user_grammar_progress.state END,
			understanding = GREATEST(user_grammar_progress.understanding, 25)`, userID, topicID)
	return err
}

// engagementColumns are the per-learner understanding signals markEngagement may set.
// The column name reaches SQL by identifier, so it is checked against this list rather
// than interpolated from a caller's string.
var engagementColumns = map[string]string{
	"explained_at":     `explained_at = COALESCE(user_grammar_progress.explained_at, now())`,
	"visual_viewed_at": `visual_viewed_at = COALESCE(user_grammar_progress.visual_viewed_at, now())`,
}

// markEngagement records the first time a learner read an AI explanation or looked at a
// visual for a topic. Mastery is recomputed from these, never nudged by them directly.
func (m *Module) markEngagement(ctx context.Context, userID, topicID uuid.UUID, column string) error {
	clause, ok := engagementColumns[column]
	if !ok {
		return fmt.Errorf("unknown grammar engagement signal %q", column)
	}
	if _, err := m.pool.Exec(ctx, `
		INSERT INTO user_grammar_progress (user_id, grammar_topic_id, state, opened_at, `+column+`)
		VALUES ($1, $2, 'learning', now(), now())
		ON CONFLICT (user_id, grammar_topic_id) DO UPDATE SET
			opened_at = COALESCE(user_grammar_progress.opened_at, now()),
			state = CASE WHEN user_grammar_progress.state = 'not_started' THEN 'learning'
			             ELSE user_grammar_progress.state END,
			`+clause, userID, topicID); err != nil {
		return err
	}
	_, err := m.recomputeMastery(ctx, userID, topicID)
	return err
}
