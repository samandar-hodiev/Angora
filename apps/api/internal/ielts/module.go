package ielts

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// The IELTS mock exam.
//
// The exam does not mark anything itself. Each section is practised through the module that
// already owns that skill — reading and listening against their answer keys, writing and
// speaking through the AI evaluators — and the exam records the section result and converts
// it to a band. One scoring path per skill, not two.

const entitlementMockExam = "ielts.mock_exams"

// Entitlements is the slice of the subscriptions service this package needs.
type Entitlements interface {
	RequireFeature(ctx context.Context, userID uuid.UUID, key string) error
	ConsumeUsage(ctx context.Context, userID uuid.UUID, key string, amount int) error
}

type Module struct {
	pool  *pgxpool.Pool
	plans Entitlements
}

type Deps struct {
	Pool  *pgxpool.Pool
	Plans Entitlements
}

func NewModule(d Deps) *Module { return &Module{pool: d.Pool, plans: d.Plans} }

func (m *Module) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/ielts", authz.RequirePermission(authz.PermLearningPractice))
	g.GET("/exams", m.exams)
	g.GET("/exams/:slug", m.exam)
	g.POST("/exams/:slug/attempts", m.startAttempt)
	g.GET("/attempts", m.attempts)
	g.GET("/attempts/:id", m.attempt)
	g.POST("/attempts/:id/sections/:skill", m.submitSection)
	g.POST("/attempts/:id/complete", m.completeAttempt)
}

type ExamSection struct {
	Skill            Skill      `json:"skill"`
	ContentItemID    *uuid.UUID `json:"content_item_id"`
	Title            string     `json:"title,omitempty"`
	TimeLimitSeconds int        `json:"time_limit_seconds"`
}

type Exam struct {
	ID          uuid.UUID     `json:"id"`
	Slug        string        `json:"slug"`
	Title       string        `json:"title"`
	Description string        `json:"description"`
	Sections    []ExamSection `json:"sections"`
	Status      string        `json:"status"`
	/** Total time, so a learner can see what they are committing to before they start. */
	TotalMinutes int `json:"total_minutes"`
}

func (m *Module) exams(c *gin.Context) {
	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT id, slug, title, description, sections, status
		FROM ielts_exams WHERE status = 'published' ORDER BY title`)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []Exam{}
	for rows.Next() {
		var e Exam
		var raw []byte
		if err := rows.Scan(&e.ID, &e.Slug, &e.Title, &e.Description, &raw, &e.Status); err != nil {
			httpx.Fail(c, err)
			return
		}
		_ = json.Unmarshal(raw, &e.Sections)
		for _, section := range e.Sections {
			e.TotalMinutes += section.TimeLimitSeconds / 60
		}
		list = append(list, e)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, list)
}

func (m *Module) loadExam(ctx context.Context, slug string) (Exam, error) {
	var e Exam
	var raw []byte
	err := m.pool.QueryRow(ctx, `
		SELECT id, slug, title, description, sections, status
		FROM ielts_exams WHERE slug = $1 AND status = 'published'`, slug).
		Scan(&e.ID, &e.Slug, &e.Title, &e.Description, &raw, &e.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return e, apperr.NotFound("Exam")
	}
	if err != nil {
		return e, err
	}
	_ = json.Unmarshal(raw, &e.Sections)
	for _, section := range e.Sections {
		e.TotalMinutes += section.TimeLimitSeconds / 60
	}
	return e, nil
}

func (m *Module) exam(c *gin.Context) {
	e, err := m.loadExam(c.Request.Context(), c.Param("slug"))
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, e)
}

// SectionResult is what one sat section contributed.
type SectionResult struct {
	Correct     int        `json:"correct,omitempty"`
	Total       int        `json:"total,omitempty"`
	RubricScore float64    `json:"rubric_score,omitempty"`
	Band        float64    `json:"band"`
	SubmittedAt time.Time  `json:"submitted_at"`
	SourceID    *uuid.UUID `json:"source_id,omitempty"`
}

type Attempt struct {
	ID          uuid.UUID               `json:"id"`
	ExamID      uuid.UUID               `json:"exam_id"`
	ExamSlug    string                  `json:"exam_slug"`
	Status      string                  `json:"status"`
	Sections    map[Skill]SectionResult `json:"sections"`
	OverallBand *float64                `json:"overall_band"`
	StartedAt   time.Time               `json:"started_at"`
	CompletedAt *time.Time              `json:"completed_at"`
}

// startAttempt opens a sitting. A mock exam is metered: it is the most expensive thing a
// learner can do, and the plan says how many they get.
func (m *Module) startAttempt(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	ctx := c.Request.Context()

	exam, err := m.loadExam(ctx, c.Param("slug"))
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if len(exam.Sections) == 0 {
		httpx.Fail(c, apperr.Conflict("This exam has no sections yet"))
		return
	}

	if m.plans != nil {
		if err := m.plans.RequireFeature(ctx, p.UserID, entitlementMockExam); err != nil {
			httpx.Fail(c, err)
			return
		}
		if err := m.plans.ConsumeUsage(ctx, p.UserID, entitlementMockExam, 1); err != nil {
			httpx.Fail(c, err)
			return
		}
	}

	// One open sitting at a time: the unique index enforces it, and a learner who already
	// has one should be sent back to it rather than told off.
	var existing uuid.UUID
	err = m.pool.QueryRow(ctx,
		`SELECT id FROM ielts_attempts WHERE user_id = $1 AND status = 'in_progress'`, p.UserID).Scan(&existing)
	if err == nil {
		m.respondWithAttempt(c, existing, p.UserID)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, err)
		return
	}

	var id uuid.UUID
	if err := m.pool.QueryRow(ctx, `
		INSERT INTO ielts_attempts (user_id, exam_id) VALUES ($1, $2) RETURNING id`,
		p.UserID, exam.ID).Scan(&id); err != nil {
		httpx.Fail(c, err)
		return
	}
	m.respondWithAttempt(c, id, p.UserID)
}

type sectionInput struct {
	/** Objective sections report what the practice module already marked. */
	Correct int `json:"correct" binding:"omitempty,min=0"`
	Total   int `json:"total" binding:"omitempty,min=0"`
	/** Productive sections report the evaluator's rubric score out of 100. */
	RubricScore float64    `json:"rubric_score" binding:"omitempty,min=0,max=100"`
	SourceID    *uuid.UUID `json:"source_id"`
}

// submitSection records one finished section and converts it to a band.
//
// The exam trusts the module that marked the work — reading and listening send their raw
// score, writing and speaking their rubric score — because those are the same paths a
// learner takes outside an exam, and having the exam re-mark anything would create a second
// answer to the same question.
func (m *Module) submitSection(c *gin.Context) {
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
	skill := Skill(c.Param("skill"))
	switch skill {
	case SkillListening, SkillReading, SkillWriting, SkillSpeaking:
	default:
		httpx.Fail(c, apperr.BadRequest("Unknown section"))
		return
	}

	var in sectionInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}

	result := SectionResult{SubmittedAt: time.Now().UTC(), SourceID: in.SourceID}
	if skill == SkillListening || skill == SkillReading {
		if in.Total <= 0 {
			httpx.Fail(c, apperr.Validation(map[string]any{"total": "A marked section reports how many questions it had"}))
			return
		}
		result.Correct, result.Total = in.Correct, in.Total
		result.Band = BandForRaw(skill, in.Correct, in.Total)
	} else {
		result.RubricScore = in.RubricScore
		result.Band = BandForRubric(in.RubricScore)
	}

	payload, err := json.Marshal(result)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	tag, err := m.pool.Exec(c.Request.Context(), `
		UPDATE ielts_attempts
		SET sections = sections || jsonb_build_object($3::text, $4::jsonb)
		WHERE id = $1 AND user_id = $2 AND status = 'in_progress'`,
		attemptID, p.UserID, string(skill), payload)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Fail(c, apperr.NotFound("Attempt"))
		return
	}
	m.respondWithAttempt(c, attemptID, p.UserID)
}

// completeAttempt closes the sitting and fixes the overall band. Like every other result in
// the platform, submitting twice returns the first answer rather than recomputing.
func (m *Module) completeAttempt(c *gin.Context) {
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
	ctx := c.Request.Context()

	var (
		status string
		raw    []byte
	)
	if err := m.pool.QueryRow(ctx, `
		SELECT status, sections FROM ielts_attempts WHERE id = $1 AND user_id = $2`,
		attemptID, p.UserID).Scan(&status, &raw); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Fail(c, apperr.NotFound("Attempt"))
			return
		}
		httpx.Fail(c, err)
		return
	}
	if status == "completed" {
		m.respondWithAttempt(c, attemptID, p.UserID)
		return
	}

	sections := map[Skill]SectionResult{}
	_ = json.Unmarshal(raw, &sections)
	if len(sections) == 0 {
		httpx.Fail(c, apperr.Conflict("Finish at least one section before submitting the exam"))
		return
	}
	bands := map[Skill]float64{}
	for skill, result := range sections {
		bands[skill] = result.Band
	}
	overall := Overall(bands)

	if _, err := m.pool.Exec(ctx, `
		UPDATE ielts_attempts SET status = 'completed', overall_band = $3, completed_at = now()
		WHERE id = $1 AND user_id = $2`, attemptID, p.UserID, overall); err != nil {
		httpx.Fail(c, err)
		return
	}
	m.respondWithAttempt(c, attemptID, p.UserID)
}

// attempts is the learner's own history: the bands page reads the latest completed sitting
// from here rather than keeping a separate copy of their scores.
func (m *Module) attempts(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT a.id, a.exam_id, e.slug, a.status, a.sections, a.overall_band::float8, a.started_at, a.completed_at
		FROM ielts_attempts a
		JOIN ielts_exams e ON e.id = a.exam_id
		WHERE a.user_id = $1
		ORDER BY a.created_at DESC
		LIMIT 20`, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []Attempt{}
	for rows.Next() {
		var a Attempt
		var raw []byte
		if err := rows.Scan(&a.ID, &a.ExamID, &a.ExamSlug, &a.Status, &raw, &a.OverallBand,
			&a.StartedAt, &a.CompletedAt); err != nil {
			httpx.Fail(c, err)
			return
		}
		a.Sections = map[Skill]SectionResult{}
		_ = json.Unmarshal(raw, &a.Sections)
		list = append(list, a)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, list)
}

func (m *Module) attempt(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid attempt id"))
		return
	}
	m.respondWithAttempt(c, id, p.UserID)
}

func (m *Module) respondWithAttempt(c *gin.Context, attemptID, userID uuid.UUID) {
	var (
		a   Attempt
		raw []byte
	)
	err := m.pool.QueryRow(c.Request.Context(), `
		SELECT a.id, a.exam_id, e.slug, a.status, a.sections, a.overall_band::float8, a.started_at, a.completed_at
		FROM ielts_attempts a
		JOIN ielts_exams e ON e.id = a.exam_id
		WHERE a.id = $1 AND a.user_id = $2`, attemptID, userID).
		Scan(&a.ID, &a.ExamID, &a.ExamSlug, &a.Status, &raw, &a.OverallBand, &a.StartedAt, &a.CompletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.NotFound("Attempt"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	a.Sections = map[Skill]SectionResult{}
	_ = json.Unmarshal(raw, &a.Sections)
	httpx.OK(c, a)
}
