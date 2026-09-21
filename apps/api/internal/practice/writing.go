package practice

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Writing practice.
//
// Writing is the opposite of reading: there is no answer key, so the evaluation is the AI's
// job and the deterministic parts are everything around it — who may submit, how long the
// text must be, what the budget allows, and what the result does to the learner's record.
//
// The evaluator is the same one placement uses. Reusing it means a learner's practice score
// and their placement score are produced by the same rubric and the same prompt version, so
// the two are comparable; a second evaluator would silently make them not.

// WritingEvaluator is the slice of the AI layer this package needs.
type WritingEvaluator interface {
	EvaluateWriting(ctx context.Context, in ai.WritingAssessmentInput) (*ai.WritingAssessment, ai.EvaluationMeta, error)
}

// Usage meters the learner's AI budget. Consumption happens before the provider is called and
// is refunded when the call fails, exactly as it does for grammar.
type Usage interface {
	ConsumeUsage(ctx context.Context, userID uuid.UUID, key string, amount int) error
	ReleaseUsage(ctx context.Context, userID uuid.UUID, key string, amount int) error
}

const (
	entitlementWritingPractice = "writing.practice"
	entitlementWritingChecks   = "writing.evaluations"

	minWritingWords = 20
	maxWritingWords = 1000
)

type writingInput struct {
	/** Optional: the writing task this answers, so the prompt and word target come from content. */
	TaskID *uuid.UUID `json:"task_id"`
	/** Used when no task is given — a learner writing something of their own. */
	Prompt string `json:"prompt" binding:"omitempty,max=1000"`
	Text   string `json:"text" binding:"required,min=1"`
}

type WritingFeedback struct {
	TaskResponse float64 `json:"task_response"`
	Grammar      float64 `json:"grammar"`
	Vocabulary   float64 `json:"vocabulary"`
	Coherence    float64 `json:"coherence"`
	/** An AI estimate of the CEFR level this piece shows — not an exam result. */
	CEFREstimate string                 `json:"cefr_estimate"`
	Confidence   float64                `json:"confidence"`
	Mistakes     []ai.AssessmentMistake `json:"mistakes"`
}

type WritingSubmission struct {
	ID          uuid.UUID        `json:"id"`
	TaskID      *uuid.UUID       `json:"task_id"`
	Prompt      string           `json:"prompt"`
	Text        string           `json:"text"`
	WordCount   int              `json:"word_count"`
	Status      string           `json:"status"`
	Score       *float64         `json:"overall_score"`
	Feedback    *WritingFeedback `json:"feedback,omitempty"`
	SubmittedAt *time.Time       `json:"submitted_at"`
	CompletedAt *time.Time       `json:"completed_at"`
	CreatedAt   time.Time        `json:"created_at"`
}

// countWords is the definition the whole product uses for "how long is this": runs of
// non-space separated by space. Punctuation does not make a word.
func countWords(text string) int {
	count := 0
	inWord := false
	for _, r := range text {
		if unicode.IsSpace(r) {
			inWord = false
			continue
		}
		if !inWord {
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				count++
				inWord = true
			}
		}
	}
	return count
}

func (m *Module) registerWritingRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/writing", authz.RequirePermission(authz.PermLearningPractice))
	g.GET("/tasks", m.writingTasks)
	g.POST("/submissions", m.submitWriting)
	g.GET("/submissions", m.listWritingSubmissions)
	g.GET("/submissions/:id", m.writingSubmission)
}

type WritingTask struct {
	ID         uuid.UUID       `json:"id"`
	Title      string          `json:"title"`
	Level      *string         `json:"level"`
	Difficulty int             `json:"difficulty"`
	Body       json.RawMessage `json:"body"`
}

func (m *Module) writingTasks(c *gin.Context) {
	var page httpx.Pagination
	if err := httpx.BindQuery(c, &page); err != nil {
		httpx.Fail(c, err)
		return
	}
	page = page.Normalize()

	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT ci.id, ci.title, l.code, ci.difficulty, ci.body, count(*) OVER ()
		FROM content_items ci
		JOIN skills s ON s.id = ci.skill_id
		LEFT JOIN levels l ON l.id = ci.level_id
		WHERE ci.status = 'published' AND s.code = 'writing'
		ORDER BY l.code NULLS LAST, ci.difficulty, ci.title
		OFFSET $1 LIMIT $2`, page.Offset(), page.PageSize)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []WritingTask{}
	var total int64
	for rows.Next() {
		var t WritingTask
		if err := rows.Scan(&t.ID, &t.Title, &t.Level, &t.Difficulty, &t.Body, &total); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, t)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OKWithMeta(c, list, httpx.Meta{Page: page.Page, PageSize: page.PageSize, Total: total})
}

// submitWriting is the whole check in one request: validate, charge, evaluate, record.
//
// It is synchronous because the learner is waiting for the feedback and there is nothing
// useful to show them in the meantime. If evaluation grows slower than a request should be,
// this becomes a job and the submission starts in 'analyzing' — the status column is already
// there for that.
func (m *Module) submitWriting(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var in writingInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}

	words := countWords(in.Text)
	if words < minWritingWords {
		httpx.Fail(c, apperr.Validation(map[string]any{
			"text": "Write at least " + itoa(minWritingWords) + " words so the feedback can say something useful",
		}))
		return
	}
	if words > maxWritingWords {
		httpx.Fail(c, apperr.Validation(map[string]any{"text": "This is longer than a practice task; split it up"}))
		return
	}

	ctx := c.Request.Context()
	if m.plans != nil {
		if err := m.plans.RequireFeature(ctx, p.UserID, entitlementWritingPractice); err != nil {
			httpx.Fail(c, err)
			return
		}
	}

	prompt := strings.TrimSpace(in.Prompt)
	level := "B1"
	if in.TaskID != nil {
		var body []byte
		var taskLevel *string
		err := m.pool.QueryRow(ctx, `
			SELECT ci.body, l.code FROM content_items ci
			JOIN skills s ON s.id = ci.skill_id
			LEFT JOIN levels l ON l.id = ci.level_id
			WHERE ci.id = $1 AND ci.status = 'published' AND s.code = 'writing'`, *in.TaskID).
			Scan(&body, &taskLevel)
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Fail(c, apperr.NotFound("Writing task"))
			return
		}
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		var task struct {
			Prompt string `json:"prompt"`
		}
		_ = json.Unmarshal(body, &task)
		if task.Prompt != "" {
			prompt = task.Prompt
		}
		if taskLevel != nil {
			level = *taskLevel
		}
	}
	if prompt == "" {
		prompt = "Free writing"
	}

	// The learner's own level, when they have one, so the rubric judges them against where
	// they are rather than a fixed target.
	var learnerLevel *string
	_ = m.pool.QueryRow(ctx, `
		SELECT l.code FROM profiles pr JOIN levels l ON l.id = pr.current_level_id WHERE pr.user_id = $1`,
		p.UserID).Scan(&learnerLevel)
	if learnerLevel != nil {
		level = *learnerLevel
	}

	var submissionID uuid.UUID
	if err := m.pool.QueryRow(ctx, `
		INSERT INTO writing_submissions (user_id, content_item_id, status, text, word_count, submitted_at, client_platform)
		VALUES ($1, $2, 'analyzing', $3, $4, now(), $5)
		RETURNING id`, p.UserID, in.TaskID, in.Text, words, httpx.ClientPlatform(c)).Scan(&submissionID); err != nil {
		httpx.Fail(c, err)
		return
	}

	if m.evaluator == nil {
		m.failSubmission(ctx, submissionID)
		httpx.Fail(c, apperr.NotImplemented("AI writing feedback"))
		return
	}

	// Charge before the provider call, refund if it fails: the learner must not pay for
	// feedback they never received.
	if m.usage != nil {
		if err := m.usage.ConsumeUsage(ctx, p.UserID, entitlementWritingChecks, 1); err != nil {
			m.failSubmission(ctx, submissionID)
			httpx.Fail(c, err)
			return
		}
	}

	// An unparseable level must not stop a learner writing: fall back to the middle of the
	// scale rather than refusing the submission they have already paid for.
	target, err := cefr.Parse(level)
	if err != nil {
		target = cefr.MustParse("B1")
	}
	assessment, meta, err := m.evaluator.EvaluateWriting(ctx, ai.WritingAssessmentInput{
		UserID: p.UserID, TaskPrompt: prompt, TargetLevel: target,
		MinWords: minWritingWords, Text: in.Text, WordCount: words,
	})
	if err != nil || assessment == nil {
		if m.usage != nil {
			_ = m.usage.ReleaseUsage(ctx, p.UserID, entitlementWritingChecks, 1)
		}
		m.failSubmission(ctx, submissionID)
		httpx.Fail(c, apperr.New(apperr.CodeUnavailable, "Writing feedback is temporarily unavailable"))
		return
	}

	overall := (assessment.TaskResponse + assessment.Grammar + assessment.Vocabulary + assessment.Coherence) / 4
	if err := m.recordWritingResult(ctx, p.UserID, submissionID, assessment, meta, overall); err != nil {
		httpx.Fail(c, err)
		return
	}

	if m.track != nil {
		m.track.Track(ctx, analytics.Server("writing_practice_completed", p.UserID, map[string]any{
			"submission_id": submissionID.String(), "words": words, "score": overall,
		}))
	}
	m.respondWithSubmission(c, submissionID, p.UserID)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	digits := ""
	for n > 0 {
		digits = string(rune('0'+n%10)) + digits
		n /= 10
	}
	return digits
}

func (m *Module) failSubmission(ctx context.Context, id uuid.UUID) {
	_, _ = m.pool.Exec(ctx, `UPDATE writing_submissions SET status = 'failed' WHERE id = $1`, id)
}

// recordWritingResult stores the analysis, links it to the submission, and turns every
// mistake the evaluator found into the learner's mistake and weakness record — the same
// tables reading practice writes to, so the recommendation engine sees one learner, not two.
func (m *Module) recordWritingResult(
	ctx context.Context, userID, submissionID uuid.UUID,
	assessment *ai.WritingAssessment, meta ai.EvaluationMeta, overall float64,
) error {
	tx, err := m.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	payload, err := json.Marshal(assessment)
	if err != nil {
		return err
	}

	var analysisID uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO ai_analyses (user_id, subject_type, subject_id, analysis_type, status, result,
		                         overall_score, schema_version, model_version, prompt_version,
		                         rubric_version, analysis_version, provider, completed_at)
		VALUES ($1, 'writing_submission', $2, 'writing_evaluation', 'completed', $3, $4, $5, $6, $7, $8, $9, $10, now())
		RETURNING id`,
		userID, submissionID, payload, overall, meta.SchemaVersion, meta.ModelVersion,
		meta.PromptVersion, meta.RubricVersion, meta.AnalysisVersion, meta.Provider).Scan(&analysisID); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE writing_submissions
		SET status = 'completed', analysis_id = $2, overall_score = $3, completed_at = now()
		WHERE id = $1`, submissionID, analysisID, overall); err != nil {
		return err
	}

	for _, mistake := range assessment.Mistakes {
		if _, err := tx.Exec(ctx, `
			INSERT INTO mistakes (user_id, skill_id, category, source_type, source_id, analysis_id,
			                      original_text, corrected_text, explanation, severity)
			SELECT $1, s.id, $2, 'writing_submission', $3, $4, $5, $6, $7, $8
			FROM skills s WHERE s.code = 'writing'`,
			userID, mistake.Category, submissionID, analysisID, mistake.Original, mistake.Correction,
			mistake.Explanation, normalizeSeverity(mistake.Severity)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO weaknesses (user_id, skill_id, category, severity_score, evidence_count)
			SELECT $1, s.id, $2, 40, 1 FROM skills s WHERE s.code = 'writing'
			ON CONFLICT (user_id, category) DO UPDATE SET
				severity_score = LEAST(100, weaknesses.severity_score + 6),
				evidence_count = weaknesses.evidence_count + 1,
				last_detected_at = now(), status = 'active'`, userID, mistake.Category); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO skill_progress (user_id, skill_id, score, sessions_count, last_practiced_at)
		SELECT $1, s.id, $2, 1, now() FROM skills s WHERE s.code = 'writing'
		ON CONFLICT (user_id, skill_id) DO UPDATE SET
			score = round((skill_progress.score * 0.7 + EXCLUDED.score * 0.3)::numeric, 2),
			sessions_count = skill_progress.sessions_count + 1,
			last_practiced_at = now()`, userID, overall); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func normalizeSeverity(s string) string {
	switch strings.ToLower(s) {
	case "low", "medium", "high":
		return strings.ToLower(s)
	default:
		return "medium"
	}
}

func (m *Module) listWritingSubmissions(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var page httpx.Pagination
	if err := httpx.BindQuery(c, &page); err != nil {
		httpx.Fail(c, err)
		return
	}
	page = page.Normalize()

	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT ws.id, ws.content_item_id, coalesce(ci.title, ''), ws.text, ws.word_count, ws.status,
		       ws.overall_score::float8, ws.submitted_at, ws.completed_at, ws.created_at, count(*) OVER ()
		FROM writing_submissions ws
		LEFT JOIN content_items ci ON ci.id = ws.content_item_id
		WHERE ws.user_id = $1
		ORDER BY ws.created_at DESC
		OFFSET $2 LIMIT $3`, p.UserID, page.Offset(), page.PageSize)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []WritingSubmission{}
	var total int64
	for rows.Next() {
		var s WritingSubmission
		if err := rows.Scan(&s.ID, &s.TaskID, &s.Prompt, &s.Text, &s.WordCount, &s.Status, &s.Score,
			&s.SubmittedAt, &s.CompletedAt, &s.CreatedAt, &total); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, s)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OKWithMeta(c, list, httpx.Meta{Page: page.Page, PageSize: page.PageSize, Total: total})
}

func (m *Module) writingSubmission(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid submission id"))
		return
	}
	m.respondWithSubmission(c, id, p.UserID)
}

func (m *Module) respondWithSubmission(c *gin.Context, id, userID uuid.UUID) {
	var (
		s   WritingSubmission
		raw []byte
	)
	err := m.pool.QueryRow(c.Request.Context(), `
		SELECT ws.id, ws.content_item_id, coalesce(ci.title, ''), ws.text, ws.word_count, ws.status,
		       ws.overall_score::float8, ws.submitted_at, ws.completed_at, ws.created_at, a.result
		FROM writing_submissions ws
		LEFT JOIN content_items ci ON ci.id = ws.content_item_id
		LEFT JOIN ai_analyses a ON a.id = ws.analysis_id
		WHERE ws.id = $1 AND ws.user_id = $2`, id, userID).
		Scan(&s.ID, &s.TaskID, &s.Prompt, &s.Text, &s.WordCount, &s.Status, &s.Score,
			&s.SubmittedAt, &s.CompletedAt, &s.CreatedAt, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.NotFound("Submission"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if len(raw) > 0 {
		var feedback WritingFeedback
		if json.Unmarshal(raw, &feedback) == nil {
			s.Feedback = &feedback
		}
	}
	httpx.OK(c, s)
}
