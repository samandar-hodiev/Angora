package grammar

import (
	"context"
	"encoding/json"
	"errors"
	"math/rand/v2"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Practice modes.
const (
	ModeLearning = "learning" // feedback after every answer: this is how people learn
	ModeTest     = "test"     // feedback withheld until the end: this is how people are measured
)

const (
	defaultQuestionCount = 10
	maxQuestionCount     = 25
)

// Attempt is a practice run as the client sees it.
type Attempt struct {
	ID        uuid.UUID  `json:"id"`
	TopicSlug string     `json:"topic"`
	TopicName string     `json:"topic_name"`
	Mode      string     `json:"mode"`
	Status    string     `json:"status"`
	Total     int        `json:"total"`
	Answered  int        `json:"answered"`
	Questions []Question `json:"questions"`
	StartedAt time.Time  `json:"started_at"`
}

type startRequest struct {
	Mode  string `json:"mode" binding:"omitempty,oneof=learning test"`
	Limit int    `json:"limit" binding:"omitempty,min=3,max=25"`
	// Rule narrows the run to one target rule, which is how a coach recommendation like
	// "practise Past Simple negatives" turns into a session.
	Rule string `json:"rule" binding:"omitempty,max=64"`
}

// POST /grammar/topics/:slug/practice — start a run.
//
// Question selection is deliberate, not random: the rules this learner keeps getting wrong
// come first, then anything they have not seen, then the rest. Within that, difficulty is
// mixed so a session is neither demoralising nor trivial.
func (m *Module) startPractice(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	ctx := c.Request.Context()

	var req startRequest
	if err := bindOptionalJSON(c, &req); err != nil {
		httpx.Fail(c, err)
		return
	}
	if req.Mode == "" {
		req.Mode = ModeLearning
	}
	if req.Limit == 0 {
		req.Limit = defaultQuestionCount
	}
	if req.Limit > maxQuestionCount {
		req.Limit = maxQuestionCount
	}

	var topicID uuid.UUID
	var topicName, topicSlug string
	err := m.pool.QueryRow(ctx, `SELECT id, slug, name FROM grammar_topics WHERE slug = $1 AND status = 'published'`,
		c.Param("slug")).Scan(&topicID, &topicSlug, &topicName)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.NotFound("Grammar topic"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	questions, err := m.selectQuestions(ctx, p.UserID, topicID, req.Rule, req.Limit)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if len(questions) == 0 {
		httpx.Fail(c, apperr.New(apperr.CodeNotImplemented, "Practice for this topic is coming soon"))
		return
	}

	ids := make([]uuid.UUID, len(questions))
	for i, q := range questions {
		ids[i] = uuid.MustParse(q.ID)
	}

	var attempt Attempt
	err = m.pool.QueryRow(ctx, `
		INSERT INTO grammar_attempts (user_id, grammar_topic_id, mode, question_ids, total_count)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, started_at`, p.UserID, topicID, req.Mode, ids, len(questions)).
		Scan(&attempt.ID, &attempt.StartedAt)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	attempt.TopicSlug, attempt.TopicName = topicSlug, topicName
	attempt.Mode, attempt.Status, attempt.Total = req.Mode, "in_progress", len(questions)
	attempt.Questions = publicQuestions(questions, req.Mode)

	m.track(ctx, p.UserID, EventPracticeStarted, map[string]any{
		"topic": topicSlug, "mode": req.Mode, "questions": len(questions), "rule": req.Rule,
	})
	httpx.Created(c, attempt)
}

// selectQuestions picks the run. Ordering, weakest rules first:
//
//  1. rules this learner has recurring errors on
//  2. questions they have never answered
//  3. questions they got wrong before
//  4. everything else
//
// Ties break randomly so two runs on the same topic are not the same run.
func (m *Module) selectQuestions(ctx context.Context, userID, topicID uuid.UUID, rule string, limit int) ([]Question, error) {
	rows, err := m.pool.Query(ctx, `
		SELECT q.id, q.type, l.code, q.difficulty::float8, q.prompt, q.payload, q.explanation,
		       q.target_rule, q.tags, q.answer
		FROM grammar_questions q
		LEFT JOIN levels l ON l.id = q.level_id
		LEFT JOIN grammar_user_errors e
		       ON e.user_id = $1 AND e.grammar_topic_id = q.grammar_topic_id AND e.target_rule = q.target_rule
		LEFT JOIN LATERAL (
		    SELECT bool_and(a.is_correct) AS all_correct, count(*) AS seen
		    FROM grammar_answers a
		    WHERE a.user_id = $1 AND a.grammar_question_id = q.id
		) hist ON true
		WHERE q.grammar_topic_id = $2 AND q.status = 'published'
		  AND ($3 = '' OR q.target_rule = $3)
		ORDER BY COALESCE(e.severity_score, 0) DESC,
		         (hist.seen IS NULL OR hist.seen = 0) DESC,
		         COALESCE(hist.all_correct, false) ASC,
		         random()
		LIMIT $4`, userID, topicID, rule, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Question{}
	for rows.Next() {
		var (
			q          Question
			id         uuid.UUID
			payloadRaw []byte
			answerRaw  []byte
		)
		if err := rows.Scan(&id, &q.Type, &q.Level, &q.Difficulty, &q.Prompt, &payloadRaw,
			&q.Explanation, &q.TargetRule, &q.Tags, &answerRaw); err != nil {
			return nil, err
		}
		q.ID = id.String()
		if err := json.Unmarshal(payloadRaw, &q.Payload); err != nil {
			m.log.Error("grammar question payload is not readable", "question", q.ID, "error", err.Error())
			continue
		}
		if q.answer, err = parseAnswer(answerRaw); err != nil {
			m.log.Error("grammar question answer is not readable", "question", q.ID, "error", err.Error())
			continue
		}
		if q.Type == TypeOrdering {
			shuffleSegments(q.Payload.Segments)
		}
		out = append(out, q)
	}
	return out, rows.Err()
}

// shuffleSegments randomises an ordering question's segments. Stored order is the answer,
// so handing it to the client unshuffled would hand over the answer.
func shuffleSegments(segments []string) {
	rand.Shuffle(len(segments), func(i, j int) { segments[i], segments[j] = segments[j], segments[i] })
}

// publicQuestion is what leaves the server: the marking key and, in test mode, the
// explanation are stripped. Question.answer is unexported so it cannot leak by accident,
// and the explanation is removed here.
func publicQuestions(questions []Question, mode string) []Question {
	if mode != ModeTest {
		return questions
	}
	out := make([]Question, len(questions))
	for i, q := range questions {
		q.Explanation = ""
		out[i] = q
	}
	return out
}

type answerRequest struct {
	QuestionID string   `json:"question_id" binding:"required,uuid"`
	Response   Response `json:"response"`
	ResponseMs int      `json:"response_ms" binding:"omitempty,min=0,max=3600000"`
}

// Feedback is what the learner gets back after an answer. In test mode only `recorded` is
// true and the rest is empty until the run is completed.
type Feedback struct {
	Recorded bool `json:"recorded"`
	// Correct and Score are pointers so that "not marked yet" (test mode, where the answer
	// is stored but nothing is revealed until the end) is null rather than false. With a
	// plain bool, a withheld result and a wrong answer would look identical to the client.
	Correct     *bool    `json:"correct"`
	Score       *float64 `json:"score"`
	Expected    string   `json:"expected,omitempty"`
	Explanation string   `json:"explanation,omitempty"`
	Rule        string   `json:"rule,omitempty"`
	// Corrections are returned for free writing: what the learner wrote and what it should be.
	Corrections []WritingCorrection `json:"corrections,omitempty"`
	// AIUnavailable says the answer was stored but could not be analysed right now.
	AIUnavailable bool `json:"ai_unavailable,omitempty"`
}

// POST /grammar/attempts/:id/answers
func (m *Module) submitAnswer(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	ctx := c.Request.Context()

	var req answerRequest
	if err := httpx.BindJSON(c, &req); err != nil {
		httpx.Fail(c, err)
		return
	}
	questionID, err := uuid.Parse(req.QuestionID)
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("question_id must be a valid UUID"))
		return
	}

	attempt, err := m.loadAttempt(ctx, p.UserID, c.Param("id"))
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if attempt.Status != "in_progress" {
		httpx.Fail(c, apperr.Conflict("This practice run has already been completed"))
		return
	}
	if !attempt.includes(questionID) {
		httpx.Fail(c, apperr.BadRequest("That question is not part of this practice run"))
		return
	}

	question, err := m.loadQuestion(ctx, questionID, attempt.TopicID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	mark := Score(question, req.Response)
	feedback := Feedback{Recorded: true}
	var analysisID *uuid.UUID
	var corrections []WritingCorrection
	// Held back rather than written onto the response: in test mode nothing about the
	// answer may be revealed, and that includes what the analysis said about it.
	var aiSummary string

	if mark.NeedsAI {
		// The only question type an AI model sees. Everything else was already decided.
		result, aiErr := m.analyzeFreeWriting(ctx, p.UserID, question, req.Response.Text)
		switch {
		case aiErr != nil:
			// The answer is kept either way: a provider outage must not cost the learner
			// their work. It is scored as unmarked rather than wrong.
			m.log.Warn("grammar free-writing analysis failed", "question", question.ID, "error", aiErr.Error())
			feedback.AIUnavailable = true
		default:
			mark.Correct = result.TargetUsedCorrectly
			mark.Score = result.Score
			corrections = result.Corrections
			analysisID = result.AnalysisID
			aiSummary = result.Summary
		}
	}

	response, err := json.Marshal(req.Response)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	feedbackJSON, err := json.Marshal(map[string]any{"expected": mark.Expected, "corrections": corrections})
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	// One row per question per attempt: re-answering corrects the record rather than
	// appending a second one, so accuracy per rule stays honest.
	_, err = m.pool.Exec(ctx, `
		INSERT INTO grammar_answers
			(attempt_id, user_id, grammar_question_id, response, is_correct, score,
			 question_type, target_rule, difficulty, feedback, analysis_id, response_ms)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		ON CONFLICT (attempt_id, grammar_question_id) DO UPDATE SET
			response = EXCLUDED.response, is_correct = EXCLUDED.is_correct, score = EXCLUDED.score,
			feedback = EXCLUDED.feedback, analysis_id = EXCLUDED.analysis_id,
			response_ms = EXCLUDED.response_ms, created_at = now()`,
		attempt.ID, p.UserID, questionID, response, mark.Correct, mark.Score,
		question.Type, question.TargetRule, question.Difficulty, feedbackJSON, analysisID, req.ResponseMs)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	if !mark.Correct {
		if err := m.recordError(ctx, p.UserID, attempt.TopicID, question, req.Response.Text, mark.Expected, "practice"); err != nil {
			m.log.Warn("grammar error not recorded", "question", question.ID, "error", err.Error())
		}
	}

	m.track(ctx, p.UserID, EventQuestionAnswered, map[string]any{
		"topic": attempt.TopicSlug, "type": question.Type, "rule": question.TargetRule, "correct": mark.Correct,
	})

	// Learning mode explains; test mode only acknowledges. This is the whole difference
	// between the two modes and it lives here.
	if attempt.Mode == ModeLearning {
		feedback.Correct = &mark.Correct
		feedback.Score = &mark.Score
		feedback.Expected = mark.Expected
		feedback.Rule = question.TargetRule
		feedback.Corrections = corrections
		feedback.Explanation = aiSummary
		if feedback.Explanation == "" {
			feedback.Explanation = question.Explanation
		}
	}
	httpx.OK(c, feedback)
}

// TypeAccuracy is accuracy for one question type, rule or difficulty band.
type TypeAccuracy struct {
	Key      string  `json:"key"`
	Label    string  `json:"label"`
	Correct  int     `json:"correct"`
	Total    int     `json:"total"`
	Accuracy float64 `json:"accuracy"`
}

// Result is the end-of-run report.
type Result struct {
	AttemptID uuid.UUID `json:"attempt_id"`
	TopicSlug string    `json:"topic"`
	TopicName string    `json:"topic_name"`
	Mode      string    `json:"mode"`
	Score     float64   `json:"score"`
	Correct   int       `json:"correct"`
	Total     int       `json:"total"`
	// Breakdowns answer "what exactly am I getting wrong?", which a single score cannot.
	ByRule       []TypeAccuracy `json:"by_rule"`
	ByType       []TypeAccuracy `json:"by_type"`
	ByDifficulty []TypeAccuracy `json:"by_difficulty"`
	Weaknesses   []string       `json:"weaknesses"`
	Mastery      MasteryResult  `json:"mastery"`
	// Review is the per-question outcome, released in test mode only once the run is over.
	Review []ReviewItem `json:"review"`
	Next   *NextStep    `json:"next"`
}

type ReviewItem struct {
	QuestionID  string   `json:"question_id"`
	Prompt      string   `json:"prompt"`
	Correct     bool     `json:"correct"`
	Expected    string   `json:"expected,omitempty"`
	Explanation string   `json:"explanation,omitempty"`
	Rule        string   `json:"rule,omitempty"`
	Response    Response `json:"response"`
}

// NextStep is the one thing worth doing next, chosen by the same rules the coach uses.
type NextStep struct {
	Kind   string `json:"kind"` // practice_rule | next_topic | apply_writing | apply_speaking
	Topic  string `json:"topic,omitempty"`
	Rule   string `json:"rule,omitempty"`
	Label  string `json:"label"`
	Reason string `json:"reason"`
}

// POST /grammar/attempts/:id/complete
func (m *Module) completeAttempt(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	ctx := c.Request.Context()

	attempt, err := m.loadAttempt(ctx, p.UserID, c.Param("id"))
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	result, err := m.buildResult(ctx, p.UserID, attempt)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	if attempt.Status == "in_progress" {
		if _, err := m.pool.Exec(ctx, `
			UPDATE grammar_attempts
			SET status = 'completed', correct_count = $2, score = $3, completed_at = now(),
			    time_spent_ms = COALESCE((SELECT sum(response_ms)::int FROM grammar_answers WHERE attempt_id = $1), 0)
			WHERE id = $1 AND user_id = $4`,
			attempt.ID, result.Correct, result.Score, p.UserID); err != nil {
			httpx.Fail(c, err)
			return
		}
		if _, err := m.pool.Exec(ctx, `
			INSERT INTO user_grammar_progress (user_id, grammar_topic_id, attempts, correct, last_practiced_at)
			VALUES ($1, $2, 1, $3, now())
			ON CONFLICT (user_id, grammar_topic_id) DO UPDATE SET
				attempts = user_grammar_progress.attempts + 1,
				correct = user_grammar_progress.correct + EXCLUDED.correct,
				last_practiced_at = now()`, p.UserID, attempt.TopicID, result.Correct); err != nil {
			httpx.Fail(c, err)
			return
		}
	}

	// Mastery is recomputed from the whole history rather than adjusted by this run.
	if result.Mastery, err = m.recomputeMastery(ctx, p.UserID, attempt.TopicID); err != nil {
		httpx.Fail(c, err)
		return
	}
	if err := m.syncWeaknesses(ctx, p.UserID, attempt.TopicID); err != nil {
		m.log.Warn("grammar weaknesses not synced", "topic", attempt.TopicSlug, "error", err.Error())
	}
	result.Next, err = m.nextStep(ctx, p.UserID, attempt.TopicID, result)
	if err != nil {
		m.log.Warn("grammar next step not chosen", "topic", attempt.TopicSlug, "error", err.Error())
	}

	m.track(ctx, p.UserID, EventPracticeCompleted, map[string]any{
		"topic": attempt.TopicSlug, "mode": attempt.Mode, "score": result.Score,
		"total": result.Total, "mastery": result.Mastery.Mastery,
	})
	if result.Mastery.State == StateMastered {
		m.track(ctx, p.UserID, EventTopicMastered, map[string]any{"topic": attempt.TopicSlug})
	}
	httpx.OK(c, result)
}

// GET /grammar/attempts/:id — re-read a run. Used to resume one and to reopen a result.
func (m *Module) attempt(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	ctx := c.Request.Context()

	attempt, err := m.loadAttempt(ctx, p.UserID, c.Param("id"))
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if attempt.Status != "in_progress" {
		result, err := m.buildResult(ctx, p.UserID, attempt)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		httpx.OK(c, result)
		return
	}

	questions, err := m.questionsOf(ctx, attempt.QuestionIDs)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var answered int
	if err := m.pool.QueryRow(ctx, `SELECT count(*)::int FROM grammar_answers WHERE attempt_id = $1`, attempt.ID).
		Scan(&answered); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, Attempt{
		ID: attempt.ID, TopicSlug: attempt.TopicSlug, TopicName: attempt.TopicName, Mode: attempt.Mode,
		Status: attempt.Status, Total: attempt.Total, Answered: answered,
		Questions: publicQuestions(questions, attempt.Mode), StartedAt: attempt.StartedAt,
	})
}

// attemptRow is the attempt as stored, including who owns it.
type attemptRow struct {
	ID          uuid.UUID
	TopicID     uuid.UUID
	TopicSlug   string
	TopicName   string
	Mode        string
	Status      string
	Total       int
	QuestionIDs []uuid.UUID
	StartedAt   time.Time
}

func (a attemptRow) includes(id uuid.UUID) bool {
	for _, q := range a.QuestionIDs {
		if q == id {
			return true
		}
	}
	return false
}

// loadAttempt is the only way this package reads an attempt, and it always filters by
// user_id. One learner can never see or change another learner's practice.
func (m *Module) loadAttempt(ctx context.Context, userID uuid.UUID, rawID string) (attemptRow, error) {
	id, err := uuid.Parse(rawID)
	if err != nil {
		return attemptRow{}, apperr.NotFound("Practice run")
	}
	var a attemptRow
	err = m.pool.QueryRow(ctx, `
		SELECT a.id, a.grammar_topic_id, t.slug, t.name, a.mode, a.status, a.total_count,
		       a.question_ids, a.started_at
		FROM grammar_attempts a
		JOIN grammar_topics t ON t.id = a.grammar_topic_id
		WHERE a.id = $1 AND a.user_id = $2`, id, userID).
		Scan(&a.ID, &a.TopicID, &a.TopicSlug, &a.TopicName, &a.Mode, &a.Status, &a.Total,
			&a.QuestionIDs, &a.StartedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		// Not "forbidden": whether someone else's attempt exists is not this caller's business.
		return attemptRow{}, apperr.NotFound("Practice run")
	}
	return a, err
}

func (m *Module) loadQuestion(ctx context.Context, questionID, topicID uuid.UUID) (Question, error) {
	var (
		q          Question
		payloadRaw []byte
		answerRaw  []byte
	)
	err := m.pool.QueryRow(ctx, `
		SELECT q.id, q.type, l.code, q.difficulty::float8, q.prompt, q.payload, q.explanation,
		       q.target_rule, q.tags, q.answer
		FROM grammar_questions q
		LEFT JOIN levels l ON l.id = q.level_id
		WHERE q.id = $1 AND q.grammar_topic_id = $2`, questionID, topicID).
		Scan(&questionID, &q.Type, &q.Level, &q.Difficulty, &q.Prompt, &payloadRaw, &q.Explanation,
			&q.TargetRule, &q.Tags, &answerRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		return q, apperr.NotFound("Question")
	}
	if err != nil {
		return q, err
	}
	q.ID = questionID.String()
	if err := json.Unmarshal(payloadRaw, &q.Payload); err != nil {
		return q, apperr.Wrap(err, apperr.CodeInternal, "Something went wrong")
	}
	q.answer, err = parseAnswer(answerRaw)
	return q, err
}

func (m *Module) questionsOf(ctx context.Context, ids []uuid.UUID) ([]Question, error) {
	rows, err := m.pool.Query(ctx, `
		SELECT q.id, q.type, l.code, q.difficulty::float8, q.prompt, q.payload, q.explanation,
		       q.target_rule, q.tags
		FROM grammar_questions q
		LEFT JOIN levels l ON l.id = q.level_id
		JOIN unnest($1::uuid[]) WITH ORDINALITY AS o(id, ord) ON o.id = q.id
		ORDER BY o.ord`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Question{}
	for rows.Next() {
		var (
			q          Question
			id         uuid.UUID
			payloadRaw []byte
		)
		if err := rows.Scan(&id, &q.Type, &q.Level, &q.Difficulty, &q.Prompt, &payloadRaw,
			&q.Explanation, &q.TargetRule, &q.Tags); err != nil {
			return nil, err
		}
		q.ID = id.String()
		if err := json.Unmarshal(payloadRaw, &q.Payload); err != nil {
			return nil, err
		}
		if q.Type == TypeOrdering {
			shuffleSegments(q.Payload.Segments)
		}
		out = append(out, q)
	}
	return out, rows.Err()
}

func bindOptionalJSON(c *gin.Context, dst any) error {
	if c.Request.Body == nil || c.Request.ContentLength == 0 {
		return nil
	}
	return httpx.BindJSON(c, dst)
}
