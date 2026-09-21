package practice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// The reading and listening practice API.
//
// A set is a published content_item (the passage or the clip) plus the questions authored
// against it in the question bank — the same assessment_items the owner console manages, so
// there is no second question store and no second answer key.
//
// The learner never receives an answer key. It is read server-side when the attempt is
// submitted, which is also the only moment a score exists.

type Skill string

const (
	SkillReading   Skill = "reading"
	SkillListening Skill = "listening"
)

// bankKind is how questions for this skill are tagged in assessment_items.
func (s Skill) bankKind() string { return string(s) + "_practice" }

// attemptTable is per skill: the two attempt tables are identical in shape but separate, so
// a learner's reading history and listening history never mix.
func (s Skill) attemptTable() string { return string(s) + "_attempts" }

// entitlement is the key the learner's plan must grant to practise this skill.
func (s Skill) entitlement() string { return string(s) + ".practice" }

// Entitlements is the slice of the subscriptions service this package needs.
type Entitlements interface {
	RequireFeature(ctx context.Context, userID uuid.UUID, key string) error
}

// Tracker records product analytics events. It is the analytics package's own interface, so
// practice emits the same events every other module does.
type Tracker interface {
	Track(ctx context.Context, e analytics.Event)
}

type Module struct {
	pool      *pgxpool.Pool
	plans     Entitlements
	usage     Usage
	evaluator WritingEvaluator
	speaker   SpeakingEvaluator
	store     Storage
	maxUpload int64
	track     Tracker
	// conversation drives the live coach's side of a spoken conversation. Optional.
	conversation Conversationalist
	// origins are the browser origins allowed to open a WebSocket session.
	origins []string
}

type Deps struct {
	Pool  *pgxpool.Pool
	Plans Entitlements
	// Usage meters AI budgets. Nil leaves AI practice unmetered, which is only ever the
	// case in tests that do not exercise limits.
	Usage Usage
	// Evaluator scores writing. Nil makes the writing endpoints report NOT_IMPLEMENTED
	// rather than pretending to have feedback.
	Evaluator WritingEvaluator
	// Speaker transcribes and scores speaking; Storage holds the audio. Both nil together
	// disables speaking practice rather than half-enabling it.
	Speaker        SpeakingEvaluator
	Storage        Storage
	MaxUploadBytes int64
	Tracker        Tracker
	// Conversation generates the live coach's follow-up questions. Nil falls back to a
	// fixed set of open questions rather than disabling the coach.
	Conversation Conversationalist
	// AllowedOrigins are the browser origins permitted to open a live session. WebSocket
	// upgrades are not covered by CORS, so this list is the only thing between a logged-in
	// learner and a session opened by somebody else's page.
	AllowedOrigins []string
}

func NewModule(d Deps) *Module {
	maxUpload := d.MaxUploadBytes
	if maxUpload <= 0 {
		maxUpload = 12 << 20
	}
	return &Module{pool: d.Pool, plans: d.Plans, usage: d.Usage, evaluator: d.Evaluator,
		speaker: d.Speaker, store: d.Storage, maxUpload: maxUpload, track: d.Tracker,
		conversation: d.Conversation, origins: d.AllowedOrigins}
}

func (m *Module) RegisterRoutes(v1 *gin.RouterGroup) {
	for _, skill := range []Skill{SkillReading, SkillListening} {
		g := v1.Group("/"+string(skill), authz.RequirePermission(authz.PermLearningPractice))
		g.GET("/sets", m.listSets(skill))
		g.GET("/sets/:id", m.set(skill))
		g.POST("/sets/:id/attempts", m.startAttempt(skill))
		g.POST("/attempts/:id/answers", m.saveAnswers(skill))
		g.POST("/attempts/:id/complete", m.completeAttempt(skill))
		g.GET("/attempts/:id", m.attempt(skill))
	}
	m.registerWritingRoutes(v1)
	m.registerSpeakingRoutes(v1)
}

// ---- Sets -------------------------------------------------------------------------------

type SetRow struct {
	ID            uuid.UUID `json:"id"`
	Title         string    `json:"title"`
	Level         *string   `json:"level"`
	Topic         *string   `json:"topic"`
	Difficulty    int       `json:"difficulty"`
	QuestionCount int       `json:"question_count"`
	/** Whether this learner has finished it before, and their best score if so. */
	Attempts  int      `json:"attempts"`
	BestScore *float64 `json:"best_score"`
}

type SetFilter struct {
	httpx.Pagination
	Level string `form:"level" binding:"omitempty,max=8"`
	Topic string `form:"topic" binding:"omitempty,max=120"`
}

func (m *Module) listSets(skill Skill) gin.HandlerFunc {
	return func(c *gin.Context) {
		p, err := authz.CurrentPrincipal(c)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		var f SetFilter
		if err := httpx.BindQuery(c, &f); err != nil {
			httpx.Fail(c, err)
			return
		}
		f.Pagination = f.Normalize()

		// Only sets that actually have published questions: a passage with no questions is
		// not practice, and offering it would be a dead end.
		rows, err := m.pool.Query(c.Request.Context(), fmt.Sprintf(`
			SELECT ci.id, ci.title, l.code, t.slug, ci.difficulty,
			       (SELECT count(*) FROM assessment_items ai
			         WHERE ai.stimulus_id = ci.id AND ai.kind = $1 AND ai.status = 'published'),
			       (SELECT count(*) FROM %[1]s a WHERE a.user_id = $2 AND a.content_item_id = ci.id AND a.status = 'completed'),
			       (SELECT max(a.score)::float8 FROM %[1]s a WHERE a.user_id = $2 AND a.content_item_id = ci.id AND a.status = 'completed'),
			       count(*) OVER ()
			FROM content_items ci
			JOIN skills s ON s.id = ci.skill_id
			LEFT JOIN levels l ON l.id = ci.level_id
			LEFT JOIN topics t ON t.id = ci.topic_id
			WHERE ci.status = 'published' AND s.code = $3
			  AND ($4 = '' OR l.code = upper($4))
			  AND ($5 = '' OR t.slug = $5)
			  AND EXISTS (SELECT 1 FROM assessment_items ai
			               WHERE ai.stimulus_id = ci.id AND ai.kind = $1 AND ai.status = 'published')
			ORDER BY l.code NULLS LAST, ci.difficulty, ci.title
			OFFSET $6 LIMIT $7`, skill.attemptTable()),
			skill.bankKind(), p.UserID, string(skill), f.Level, f.Topic, f.Offset(), f.PageSize)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		defer rows.Close()

		list := []SetRow{}
		var total int64
		for rows.Next() {
			var r SetRow
			if err := rows.Scan(&r.ID, &r.Title, &r.Level, &r.Topic, &r.Difficulty, &r.QuestionCount,
				&r.Attempts, &r.BestScore, &total); err != nil {
				httpx.Fail(c, err)
				return
			}
			list = append(list, r)
		}
		if err := rows.Err(); err != nil {
			httpx.Fail(c, err)
			return
		}
		httpx.OKWithMeta(c, list, httpx.Meta{Page: f.Page, PageSize: f.PageSize, Total: total})
	}
}

// LearnerQuestion is a question as the learner receives it: prompt and options, never the key.
type LearnerQuestion struct {
	ID       uuid.UUID       `json:"id"`
	Type     string          `json:"type"`
	Position int             `json:"position"`
	Prompt   string          `json:"prompt"`
	Options  json.RawMessage `json:"options"`
}

type SetDetail struct {
	ID         uuid.UUID `json:"id"`
	Title      string    `json:"title"`
	Level      *string   `json:"level"`
	Difficulty int       `json:"difficulty"`
	/** The passage, or the clip's metadata and playback url, as authored. */
	Body      json.RawMessage   `json:"body"`
	Questions []LearnerQuestion `json:"questions"`
}

func (m *Module) loadSet(ctx context.Context, skill Skill, id uuid.UUID) (SetDetail, error) {
	var d SetDetail
	err := m.pool.QueryRow(ctx, `
		SELECT ci.id, ci.title, l.code, ci.difficulty, ci.body
		FROM content_items ci
		JOIN skills s ON s.id = ci.skill_id
		LEFT JOIN levels l ON l.id = ci.level_id
		WHERE ci.id = $1 AND ci.status = 'published' AND s.code = $2`, id, string(skill)).
		Scan(&d.ID, &d.Title, &d.Level, &d.Difficulty, &d.Body)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, apperr.NotFound("Practice set")
	}
	if err != nil {
		return d, err
	}

	rows, err := m.pool.Query(ctx, `
		SELECT id, item_type, position, prompt, options
		FROM assessment_items
		WHERE stimulus_id = $1 AND kind = $2 AND status = 'published'
		ORDER BY position, created_at`, id, skill.bankKind())
	if err != nil {
		return d, err
	}
	defer rows.Close()
	d.Questions = []LearnerQuestion{}
	for rows.Next() {
		var q LearnerQuestion
		if err := rows.Scan(&q.ID, &q.Type, &q.Position, &q.Prompt, &q.Options); err != nil {
			return d, err
		}
		d.Questions = append(d.Questions, q)
	}
	return d, rows.Err()
}

func (m *Module) set(skill Skill) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil {
			httpx.Fail(c, apperr.BadRequest("Invalid set id"))
			return
		}
		d, err := m.loadSet(c.Request.Context(), skill, id)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		httpx.OK(c, d)
	}
}

// ---- Attempts ----------------------------------------------------------------------------

type AttemptResponse struct {
	ID        uuid.UUID  `json:"id"`
	SetID     uuid.UUID  `json:"set_id"`
	Status    string     `json:"status"`
	Correct   int        `json:"correct_count"`
	Total     int        `json:"total_count"`
	Score     *float64   `json:"score"`
	StartedAt time.Time  `json:"started_at"`
	Completed *time.Time `json:"completed_at"`
	/** Present once the attempt is complete; the learner's own answers are echoed back. */
	Marks []Mark `json:"marks,omitempty"`
}

func (m *Module) startAttempt(skill Skill) gin.HandlerFunc {
	return func(c *gin.Context) {
		p, err := authz.CurrentPrincipal(c)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		setID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			httpx.Fail(c, apperr.BadRequest("Invalid set id"))
			return
		}

		// The plan decides whether this learner may practise this skill at all.
		if m.plans != nil {
			if err := m.plans.RequireFeature(c.Request.Context(), p.UserID, skill.entitlement()); err != nil {
				httpx.Fail(c, err)
				return
			}
		}

		set, err := m.loadSet(c.Request.Context(), skill, setID)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		if len(set.Questions) == 0 {
			httpx.Fail(c, apperr.Conflict("This set has no published questions yet"))
			return
		}

		var out AttemptResponse
		err = m.pool.QueryRow(c.Request.Context(), fmt.Sprintf(`
			INSERT INTO %s (user_id, content_item_id, total_count)
			VALUES ($1, $2, $3)
			RETURNING id, content_item_id, status, correct_count, total_count, score, started_at, completed_at`,
			skill.attemptTable()), p.UserID, setID, len(set.Questions)).
			Scan(&out.ID, &out.SetID, &out.Status, &out.Correct, &out.Total, &out.Score, &out.StartedAt, &out.Completed)
		if err != nil {
			httpx.Fail(c, err)
			return
		}

		if m.track != nil {
			m.track.Track(c.Request.Context(), analytics.Server(string(skill)+"_practice_started", p.UserID,
				map[string]any{"set_id": setID.String(), "questions": len(set.Questions)}))
		}
		httpx.Created(c, out)
	}
}

type answersInput struct {
	Answers     map[string]Answer `json:"answers" binding:"required"`
	TimeSpentMs int               `json:"time_spent_ms" binding:"omitempty,min=0"`
}

// saveAnswers stores progress without marking anything. A learner who closes the tab keeps
// what they had; nothing is scored until they submit.
func (m *Module) saveAnswers(skill Skill) gin.HandlerFunc {
	return func(c *gin.Context) {
		p, err := authz.CurrentPrincipal(c)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		attemptID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			httpx.Fail(c, apperr.BadRequest("Invalid attempt id"))
			return
		}
		var in answersInput
		if err := httpx.BindJSON(c, &in); err != nil {
			httpx.Fail(c, err)
			return
		}
		payload, err := json.Marshal(in.Answers)
		if err != nil {
			httpx.Fail(c, err)
			return
		}

		tag, err := m.pool.Exec(c.Request.Context(), fmt.Sprintf(`
			UPDATE %s SET answers = $3, time_spent_ms = GREATEST(time_spent_ms, $4)
			WHERE id = $1 AND user_id = $2 AND status = 'in_progress'`, skill.attemptTable()),
			attemptID, p.UserID, payload, in.TimeSpentMs)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		if tag.RowsAffected() == 0 {
			httpx.Fail(c, apperr.NotFound("Attempt"))
			return
		}
		httpx.NoContent(c)
	}
}

// completeAttempt marks the attempt against the stored answer keys and records what it
// taught us about the learner. It is idempotent: submitting twice returns the first result
// rather than re-scoring, so a retried request cannot change a recorded score.
func (m *Module) completeAttempt(skill Skill) gin.HandlerFunc {
	return func(c *gin.Context) {
		p, err := authz.CurrentPrincipal(c)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		attemptID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			httpx.Fail(c, apperr.BadRequest("Invalid attempt id"))
			return
		}

		var in answersInput
		// Submitting the final answers with the request is allowed but optional.
		_ = c.ShouldBindJSON(&in)

		ctx := c.Request.Context()
		tx, err := m.pool.Begin(ctx)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()

		var (
			setID   uuid.UUID
			status  string
			stored  []byte
			started time.Time
		)
		err = tx.QueryRow(ctx, fmt.Sprintf(`
			SELECT content_item_id, status, answers, started_at FROM %s
			WHERE id = $1 AND user_id = $2 FOR UPDATE`, skill.attemptTable()), attemptID, p.UserID).
			Scan(&setID, &status, &stored, &started)
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Fail(c, apperr.NotFound("Attempt"))
			return
		}
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		if status == "completed" {
			_ = tx.Rollback(ctx)
			m.respondWithAttempt(c, skill, attemptID, p.UserID)
			return
		}

		answers := map[string]Answer{}
		if len(stored) > 0 {
			_ = json.Unmarshal(stored, &answers)
		}
		for id, answer := range in.Answers {
			answers[id] = answer
		}

		questions, err := m.questionsWithKeys(ctx, tx, skill, setID)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		result := Score(questions, answers)

		payload, err := json.Marshal(answers)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		if _, err := tx.Exec(ctx, fmt.Sprintf(`
			UPDATE %s SET status = 'completed', answers = $3, correct_count = $4, total_count = $5,
			              score = $6, completed_at = now(),
			              time_spent_ms = GREATEST(time_spent_ms, $7)
			WHERE id = $1 AND user_id = $2`, skill.attemptTable()),
			attemptID, p.UserID, payload, result.Correct, result.Total, result.Score, in.TimeSpentMs); err != nil {
			httpx.Fail(c, err)
			return
		}

		// Practice feeds the learner's record: their skill standing, and a mistake row for
		// each wrong answer so weakness detection has something to work from.
		if err := m.recordProgress(ctx, tx, skill, p.UserID, result); err != nil {
			httpx.Fail(c, err)
			return
		}
		if err := tx.Commit(ctx); err != nil {
			httpx.Fail(c, err)
			return
		}

		if m.track != nil {
			m.track.Track(ctx, analytics.Server(string(skill)+"_practice_completed", p.UserID, map[string]any{
				"set_id": setID.String(), "score": result.Score, "correct": result.Correct, "total": result.Total,
			}))
		}
		m.respondWithAttempt(c, skill, attemptID, p.UserID)
	}
}

func (m *Module) questionsWithKeys(ctx context.Context, tx pgx.Tx, skill Skill, setID uuid.UUID) ([]Question, error) {
	rows, err := tx.Query(ctx, `
		SELECT id, answer_key, explanation, topic
		FROM assessment_items
		WHERE stimulus_id = $1 AND kind = $2 AND status = 'published'
		ORDER BY position, created_at`, setID, skill.bankKind())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	questions := []Question{}
	for rows.Next() {
		var (
			id      uuid.UUID
			raw     []byte
			explain string
			target  string
		)
		if err := rows.Scan(&id, &raw, &explain, &target); err != nil {
			return nil, err
		}
		var key Key
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &key)
		}
		questions = append(questions, Question{ID: id.String(), Key: key, Explanation: explain, Target: target})
	}
	return questions, rows.Err()
}

// recordProgress updates the learner's standing in this skill and records their mistakes.
// Both are what the recommendation engine reads, so practice that is not recorded here is
// practice the platform cannot learn from.
func (m *Module) recordProgress(ctx context.Context, tx pgx.Tx, skill Skill, userID uuid.UUID, result Result) error {
	if _, err := tx.Exec(ctx, `
		INSERT INTO skill_progress (user_id, skill_id, score, sessions_count, last_practiced_at)
		SELECT $1, s.id, $2, 1, now() FROM skills s WHERE s.code = $3
		ON CONFLICT (user_id, skill_id) DO UPDATE SET
			-- A rolling estimate rather than the latest score: one bad session should move
			-- the learner's standing, not redefine it.
			score = round((skill_progress.score * 0.7 + EXCLUDED.score * 0.3)::numeric, 2),
			sessions_count = skill_progress.sessions_count + 1,
			last_practiced_at = now()`,
		userID, result.Score, string(skill)); err != nil {
		return fmt.Errorf("skill progress: %w", err)
	}

	for _, mark := range result.Marks {
		if mark.Correct || !mark.Answered {
			continue
		}
		category := mark.Target
		if category == "" {
			category = string(skill) + ".comprehension"
		}
		questionID, err := uuid.Parse(mark.QuestionID)
		if err != nil {
			return fmt.Errorf("question id: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO mistakes (user_id, skill_id, category, source_type, source_id,
			                      original_text, corrected_text, explanation)
			SELECT $1, s.id, $2, $3, $4, $5, $6, $7 FROM skills s WHERE s.code = $8`,
			userID, category, string(skill)+"_practice", questionID,
			mark.Given.text(), mark.Expected.text(), mark.Explanation, string(skill)); err != nil {
			return fmt.Errorf("mistake: %w", err)
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO weaknesses (user_id, skill_id, category, severity_score, evidence_count)
			SELECT $1, s.id, $2, 40, 1 FROM skills s WHERE s.code = $3
			ON CONFLICT (user_id, category) DO UPDATE SET
				severity_score = LEAST(100, weaknesses.severity_score + 6),
				evidence_count = weaknesses.evidence_count + 1,
				last_detected_at = now(),
				status = 'active'`,
			userID, category, string(skill)); err != nil {
			return fmt.Errorf("weakness: %w", err)
		}
	}
	return nil
}

func (m *Module) attempt(skill Skill) gin.HandlerFunc {
	return func(c *gin.Context) {
		p, err := authz.CurrentPrincipal(c)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		attemptID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			httpx.Fail(c, apperr.BadRequest("Invalid attempt id"))
			return
		}
		m.respondWithAttempt(c, skill, attemptID, p.UserID)
	}
}

// respondWithAttempt returns the attempt, with marks once it is finished. Marks are computed
// from the stored answers rather than stored themselves: the answer key is the record, and a
// result can always be recomputed from it.
func (m *Module) respondWithAttempt(c *gin.Context, skill Skill, attemptID, userID uuid.UUID) {
	ctx := c.Request.Context()

	var (
		out    AttemptResponse
		setID  uuid.UUID
		stored []byte
	)
	err := m.pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT id, content_item_id, status, correct_count, total_count, score, started_at, completed_at, answers
		FROM %s WHERE id = $1 AND user_id = $2`, skill.attemptTable()), attemptID, userID).
		Scan(&out.ID, &setID, &out.Status, &out.Correct, &out.Total, &out.Score, &out.StartedAt, &out.Completed, &stored)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.NotFound("Attempt"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	out.SetID = setID

	if out.Status == "completed" {
		tx, err := m.pool.Begin(ctx)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		questions, err := m.questionsWithKeys(ctx, tx, skill, setID)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		answers := map[string]Answer{}
		if len(stored) > 0 {
			_ = json.Unmarshal(stored, &answers)
		}
		out.Marks = Score(questions, answers).Marks
	}
	httpx.OK(c, out)
}

// text renders an answer for the mistake log, which stores strings.
func (a Answer) text() string {
	if a.Text != "" {
		return a.Text
	}
	return a.OptionID
}

func (k Key) text() string {
	if k.Text != "" {
		return k.Text
	}
	return k.OptionID
}
