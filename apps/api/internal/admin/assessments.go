package admin

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Assessment configuration and outcomes for the owner console.
//
// A config is the shape of a test: which skills, in what order, with what time limits and how
// many items per difficulty band. Configs are versioned and exactly one version of a kind is
// active at a time (enforced by assessment_configs_one_active). Every assessment stores a
// snapshot of the config it ran under, so activating a new version never changes a result that
// has already been recorded.

const (
	ActionConfigCreated   = "assessment_config.created"
	ActionConfigActivated = "assessment_config.activated"
)

type AssessmentConfigRow struct {
	ID        uuid.UUID       `json:"id"`
	Kind      string          `json:"kind"`
	Version   int             `json:"version"`
	Status    string          `json:"status"`
	Config    json.RawMessage `json:"config"`
	Attempts  int64           `json:"attempts"`
	CreatedAt time.Time       `json:"created_at"`
}

type AssessmentConfigInput struct {
	Kind   string          `json:"kind" binding:"required,max=32"`
	Config json.RawMessage `json:"config" binding:"required"`
}

// configShape is the minimum the learner service relies on when it builds sections.
type configShape struct {
	GraceSeconds int `json:"grace_seconds"`
	Sections     []struct {
		Skill            string         `json:"skill"`
		TimeLimitSeconds int            `json:"time_limit_seconds"`
		Items            map[string]int `json:"items"`
	} `json:"sections"`
}

var configSkills = map[string]bool{"reading": true, "listening": true, "writing": true, "speaking": true}

// validateConfig rejects a config that would produce an unusable test. The learner service
// trusts this JSON at runtime, so it is checked here rather than when a learner is waiting.
func validateConfig(raw json.RawMessage) error {
	var shape configShape
	if err := json.Unmarshal(raw, &shape); err != nil {
		return apperr.Validation(map[string]any{"config": "Must be a JSON object"})
	}
	if len(shape.Sections) == 0 {
		return apperr.Validation(map[string]any{"config.sections": "A test needs at least one section"})
	}
	seen := map[string]bool{}
	for i, s := range shape.Sections {
		field := "config.sections." + strconv.Itoa(i)
		if !configSkills[s.Skill] {
			return apperr.Validation(map[string]any{field + ".skill": "Must be reading, listening, writing or speaking"})
		}
		if seen[s.Skill] {
			return apperr.Validation(map[string]any{field + ".skill": "Each skill may appear only once"})
		}
		seen[s.Skill] = true
		if s.TimeLimitSeconds <= 0 {
			return apperr.Validation(map[string]any{field + ".time_limit_seconds": "Must be greater than zero"})
		}
		total := 0
		for _, n := range s.Items {
			if n < 0 {
				return apperr.Validation(map[string]any{field + ".items": "Item counts cannot be negative"})
			}
			total += n
		}
		if total == 0 {
			return apperr.Validation(map[string]any{field + ".items": "A section needs at least one item"})
		}
	}
	return nil
}

func (m *Module) assessmentConfigs(c *gin.Context) {
	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT ac.id, ac.kind, ac.version, ac.status, ac.config, ac.created_at,
		       (SELECT count(*) FROM assessments a WHERE a.config_id = ac.id)
		FROM assessment_configs ac
		ORDER BY ac.kind, ac.version DESC`)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []AssessmentConfigRow{}
	for rows.Next() {
		var r AssessmentConfigRow
		if err := rows.Scan(&r.ID, &r.Kind, &r.Version, &r.Status, &r.Config, &r.CreatedAt, &r.Attempts); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, list)
}

// createAssessmentConfig always writes a new draft version rather than editing an existing
// one: a config that has been used to run assessments must stay exactly as it was.
func (m *Module) createAssessmentConfig(c *gin.Context) {
	principal, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var in AssessmentConfigInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	if err := validateConfig(in.Config); err != nil {
		httpx.Fail(c, err)
		return
	}

	var row AssessmentConfigRow
	err = m.pool.QueryRow(c.Request.Context(), `
		INSERT INTO assessment_configs (kind, version, status, config)
		VALUES ($1, (SELECT coalesce(max(version), 0) + 1 FROM assessment_configs WHERE kind = $1), 'draft', $2)
		RETURNING id, kind, version, status, config, created_at`, in.Kind, in.Config).
		Scan(&row.ID, &row.Kind, &row.Version, &row.Status, &row.Config, &row.CreatedAt)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	m.audit.Record(c.Request.Context(), audit.Entry{
		ActorID: &principal.UserID, Action: ActionConfigCreated, EntityType: "assessment_config",
		EntityID: row.ID.String(), Metadata: map[string]any{"kind": row.Kind, "version": row.Version},
		IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})
	httpx.Created(c, row)
}

// activateAssessmentConfig retires the live version and activates this one in a single
// transaction, because assessment_configs allows only one active version per kind and a
// learner must never find none.
func (m *Module) activateAssessmentConfig(c *gin.Context) {
	principal, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid config id"))
		return
	}

	ctx := c.Request.Context()
	tx, err := m.pool.Begin(ctx)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var kind string
	var version int
	var raw json.RawMessage
	err = tx.QueryRow(ctx, `SELECT kind, version, config FROM assessment_configs WHERE id = $1 FOR UPDATE`, id).
		Scan(&kind, &version, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.NotFound("Assessment config"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if err := validateConfig(raw); err != nil {
		httpx.Fail(c, err)
		return
	}

	if _, err := tx.Exec(ctx, `UPDATE assessment_configs SET status = 'retired' WHERE kind = $1 AND status = 'active'`, kind); err != nil {
		httpx.Fail(c, err)
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE assessment_configs SET status = 'active' WHERE id = $1`, id); err != nil {
		httpx.Fail(c, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httpx.Fail(c, err)
		return
	}

	m.audit.Record(ctx, audit.Entry{
		ActorID: &principal.UserID, Action: ActionConfigActivated, EntityType: "assessment_config",
		EntityID: id.String(), Metadata: map[string]any{"kind": kind, "version": version},
		IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})
	httpx.OK(c, gin.H{"id": id, "kind": kind, "version": version, "status": "active"})
}

// ---- Attempts and outcomes ----------------------------------------------------------------

type AttemptRow struct {
	ID          uuid.UUID  `json:"id"`
	UserID      uuid.UUID  `json:"user_id"`
	Email       string     `json:"email"`
	Kind        string     `json:"kind"`
	Source      string     `json:"source"`
	Status      string     `json:"status"`
	StartLevel  string     `json:"start_level"`
	OverallCEFR *string    `json:"overall_cefr"`
	Score       *float64   `json:"overall_score"`
	Confidence  *float64   `json:"confidence"`
	StartedAt   time.Time  `json:"started_at"`
	CompletedAt *time.Time `json:"completed_at"`
}

type AttemptFilter struct {
	httpx.Pagination
	Kind   string `form:"kind" binding:"omitempty,max=32"`
	Status string `form:"status" binding:"omitempty,oneof=in_progress processing completed failed abandoned"`
	Level  string `form:"level" binding:"omitempty,max=8"`
	Days   int    `form:"days" binding:"omitempty,min=1,max=365"`
}

func (m *Module) assessmentAttempts(c *gin.Context) {
	var f AttemptFilter
	if err := httpx.BindQuery(c, &f); err != nil {
		httpx.Fail(c, err)
		return
	}
	f.Pagination = f.Normalize()
	if f.Days == 0 {
		f.Days = 90
	}
	since := time.Now().AddDate(0, 0, -f.Days)

	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT a.id, a.user_id, u.email, a.kind, a.source, a.status, l.code,
		       r.overall_cefr::text, r.overall_score, r.confidence, a.started_at, a.completed_at,
		       count(*) OVER ()
		FROM assessments a
		JOIN users u ON u.id = a.user_id
		JOIN levels l ON l.id = a.start_level_id
		LEFT JOIN assessment_results r ON r.assessment_id = a.id
		WHERE a.created_at >= $1
		  AND ($2 = '' OR a.kind = $2)
		  AND ($3 = '' OR a.status = $3)
		  AND ($4 = '' OR r.overall_cefr::text = upper($4))
		ORDER BY a.created_at DESC
		OFFSET $5 LIMIT $6`, since, f.Kind, f.Status, f.Level, f.Offset(), f.PageSize)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []AttemptRow{}
	var total int64
	for rows.Next() {
		var r AttemptRow
		if err := rows.Scan(&r.ID, &r.UserID, &r.Email, &r.Kind, &r.Source, &r.Status, &r.StartLevel,
			&r.OverallCEFR, &r.Score, &r.Confidence, &r.StartedAt, &r.CompletedAt, &total); err != nil {
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

type SkillOutcome struct {
	Skill      string  `json:"skill"`
	AvgScore   float64 `json:"avg_score"`
	Results    int64   `json:"results"`
	Confidence float64 `json:"avg_confidence"`
}

type AssessmentStats struct {
	Days              int              `json:"days"`
	Started           int64            `json:"started"`
	Completed         int64            `json:"completed"`
	Abandoned         int64            `json:"abandoned"`
	Failed            int64            `json:"failed"`
	InProgress        int64            `json:"in_progress"`
	CompletionRate    float64          `json:"completion_rate"`
	MedianMinutes     *float64         `json:"median_minutes"`
	LevelDistribution []QuestionBucket `json:"level_distribution"`
	BySkill           []SkillOutcome   `json:"by_skill"`
}

// assessmentStats answers "is placement working?": how many learners finish, how long it
// takes them, and where the results land. Every number is counted from the tables — nothing
// here is estimated.
func (m *Module) assessmentStats(c *gin.Context) {
	days := 90
	if v := c.Query("days"); v != "" {
		var parsed int
		if _, err := fmt.Sscanf(v, "%d", &parsed); err == nil && parsed >= 1 && parsed <= 365 {
			days = parsed
		}
	}
	since := time.Now().AddDate(0, 0, -days)
	ctx := c.Request.Context()
	stats := AssessmentStats{Days: days, LevelDistribution: []QuestionBucket{}, BySkill: []SkillOutcome{}}

	err := m.pool.QueryRow(ctx, `
		SELECT count(*),
		       count(*) FILTER (WHERE status = 'completed'),
		       count(*) FILTER (WHERE status = 'abandoned'),
		       count(*) FILTER (WHERE status = 'failed'),
		       count(*) FILTER (WHERE status IN ('in_progress', 'processing')),
		       percentile_cont(0.5) WITHIN GROUP (
		           ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) / 60.0)
		           FILTER (WHERE status = 'completed' AND completed_at IS NOT NULL)
		FROM assessments WHERE created_at >= $1`, since).
		Scan(&stats.Started, &stats.Completed, &stats.Abandoned, &stats.Failed, &stats.InProgress, &stats.MedianMinutes)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if stats.Started > 0 {
		stats.CompletionRate = float64(stats.Completed) / float64(stats.Started) * 100
	}

	levels, err := m.pool.Query(ctx, `
		SELECT r.overall_cefr::text, count(*)
		FROM assessment_results r
		WHERE r.created_at >= $1
		GROUP BY r.overall_cefr ORDER BY r.overall_cefr`, since)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer levels.Close()
	for levels.Next() {
		var b QuestionBucket
		if err := levels.Scan(&b.Key, &b.Count); err != nil {
			httpx.Fail(c, err)
			return
		}
		stats.LevelDistribution = append(stats.LevelDistribution, b)
	}
	if err := levels.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}

	skills, err := m.pool.Query(ctx, `
		SELECT sr.skill, avg(sr.score)::float8, count(*), avg(sr.confidence)::float8
		FROM assessment_skill_results sr
		WHERE sr.created_at >= $1
		GROUP BY sr.skill ORDER BY sr.skill`, since)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer skills.Close()
	for skills.Next() {
		var s SkillOutcome
		if err := skills.Scan(&s.Skill, &s.AvgScore, &s.Results, &s.Confidence); err != nil {
			httpx.Fail(c, err)
			return
		}
		stats.BySkill = append(stats.BySkill, s)
	}
	if err := skills.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}

	httpx.OK(c, stats)
}
