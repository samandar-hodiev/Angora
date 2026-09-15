// Package progress serves the learner's progress overview and learning history.
//
// Everything is computed from PostgreSQL (skill_progress, streaks, practice tables), so
// web and mobile show identical numbers. Writers of progress (practice modules, the
// personalization engine) arrive in later phases; this package owns the read model.
package progress

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

type SkillProgress struct {
	Code            string     `json:"code"`
	Name            string     `json:"name"`
	Score           float64    `json:"score"`
	XP              int        `json:"xp"`
	Sessions        int        `json:"sessions"`
	EstimatedLevel  *string    `json:"estimated_level"`
	LastPracticedAt *time.Time `json:"last_practiced_at"`
}

type Streak struct {
	CurrentDays      int        `json:"current_days"`
	LongestDays      int        `json:"longest_days"`
	LastActivityDate *time.Time `json:"last_activity_date"`
}

type Overview struct {
	CurrentLevel     *string         `json:"current_level"`
	TargetLevel      *string         `json:"target_level"`
	DailyGoalMinutes int             `json:"daily_goal_minutes"`
	OverallScore     *float64        `json:"overall_score"`
	Streak           Streak          `json:"streak"`
	Skills           []SkillProgress `json:"skills"`
}

type HistoryItem struct {
	Kind      string    `json:"kind"` // speaking | writing | reading | listening
	ID        uuid.UUID `json:"id"`
	Title     string    `json:"title"`
	Mode      string    `json:"mode"`
	Status    string    `json:"status"`
	Score     *float64  `json:"score"`
	CreatedAt time.Time `json:"created_at"`
}

type Module struct {
	pool *pgxpool.Pool
}

func NewModule(pool *pgxpool.Pool) *Module { return &Module{pool: pool} }

func (m *Module) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("", authz.RequirePermission(authz.PermLearningPractice))
	g.GET("/progress", m.handleOverview)
	g.GET("/history", m.handleHistory)
}

func (m *Module) handleOverview(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	overview, err := m.Overview(c.Request.Context(), p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, overview)
}

func (m *Module) Overview(ctx context.Context, userID uuid.UUID) (Overview, error) {
	var o Overview
	err := m.pool.QueryRow(ctx, `
		SELECT cl.code, tl.code, p.daily_goal_minutes,
		       COALESCE(st.current_days, 0), COALESCE(st.longest_days, 0), st.last_activity_date
		FROM profiles p
		LEFT JOIN levels cl ON cl.id = p.current_level_id
		LEFT JOIN levels tl ON tl.id = p.target_level_id
		LEFT JOIN streaks st ON st.user_id = p.user_id
		WHERE p.user_id = $1`, userID,
	).Scan(&o.CurrentLevel, &o.TargetLevel, &o.DailyGoalMinutes,
		&o.Streak.CurrentDays, &o.Streak.LongestDays, &o.Streak.LastActivityDate)
	if database.IsNotFound(err) {
		return Overview{}, apperr.NotFound("Profile")
	}
	if err != nil {
		return Overview{}, err
	}

	rows, err := m.pool.Query(ctx, `
		SELECT s.code, s.name, COALESCE(sp.score, 0)::float8, COALESCE(sp.xp, 0),
		       COALESCE(sp.sessions_count, 0), l.code, sp.last_practiced_at
		FROM skills s
		LEFT JOIN skill_progress sp ON sp.skill_id = s.id AND sp.user_id = $1
		LEFT JOIN levels l ON l.id = sp.estimated_level_id
		WHERE s.is_active
		ORDER BY s.sort_order`, userID)
	if err != nil {
		return Overview{}, err
	}
	defer rows.Close()

	o.Skills = []SkillProgress{}
	var total float64
	var practiced int
	for rows.Next() {
		var s SkillProgress
		if err := rows.Scan(&s.Code, &s.Name, &s.Score, &s.XP, &s.Sessions, &s.EstimatedLevel, &s.LastPracticedAt); err != nil {
			return Overview{}, err
		}
		if s.Sessions > 0 {
			total += s.Score
			practiced++
		}
		o.Skills = append(o.Skills, s)
	}
	if practiced > 0 {
		avg := total / float64(practiced)
		o.OverallScore = &avg
	}
	return o, rows.Err()
}

func (m *Module) handleHistory(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	var page httpx.Pagination
	if err := httpx.BindQuery(c, &page); err != nil {
		httpx.Fail(c, err)
		return
	}
	page = page.Normalize()

	rows, err := m.pool.Query(c.Request.Context(), `
		WITH items AS (
			SELECT 'speaking' AS kind, s.id, COALESCE(ci.title, 'Speaking practice') AS title, s.mode, s.status,
			       s.overall_score::float8 AS score, s.created_at
			FROM speaking_sessions s LEFT JOIN content_items ci ON ci.id = s.content_item_id
			WHERE s.user_id = $1
			UNION ALL
			SELECT 'writing', w.id, COALESCE(ci.title, 'Writing practice'), w.mode, w.status,
			       w.overall_score::float8, w.created_at
			FROM writing_submissions w LEFT JOIN content_items ci ON ci.id = w.content_item_id
			WHERE w.user_id = $1
			UNION ALL
			SELECT 'reading', r.id, ci.title, r.mode, r.status, r.score::float8, r.created_at
			FROM reading_attempts r JOIN content_items ci ON ci.id = r.content_item_id
			WHERE r.user_id = $1
			UNION ALL
			SELECT 'listening', l.id, ci.title, l.mode, l.status, l.score::float8, l.created_at
			FROM listening_attempts l JOIN content_items ci ON ci.id = l.content_item_id
			WHERE l.user_id = $1
		)
		SELECT kind, id, title, mode, status, score, created_at, count(*) OVER ()
		FROM items
		ORDER BY created_at DESC
		OFFSET $2 LIMIT $3`, p.UserID, page.Offset(), page.PageSize)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	items := []HistoryItem{}
	var total int64
	for rows.Next() {
		var it HistoryItem
		if err := rows.Scan(&it.Kind, &it.ID, &it.Title, &it.Mode, &it.Status, &it.Score, &it.CreatedAt, &total); err != nil {
			httpx.Fail(c, err)
			return
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OKWithMeta(c, items, httpx.Meta{Page: page.Page, PageSize: page.PageSize, Total: total})
}
