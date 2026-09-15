// Package recommendations serves personalised next steps and the active learning plan.
//
// Recommendations start rule-based (weaknesses + level + goals) and are later augmented by
// ai.Recommender; each records its source (rule | ai | teacher) so clients can explain
// "why am I seeing this".
package recommendations

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

type ContentRef struct {
	ID    uuid.UUID `json:"id"`
	Type  string    `json:"type"`
	Title string    `json:"title"`
	Skill *string   `json:"skill"`
}

type Recommendation struct {
	ID        uuid.UUID   `json:"id"`
	Type      string      `json:"type"`
	Reason    string      `json:"reason"`
	Priority  int         `json:"priority"`
	Source    string      `json:"source"`
	Content   *ContentRef `json:"content"`
	CreatedAt time.Time   `json:"created_at"`
	ExpiresAt *time.Time  `json:"expires_at"`
}

type LearningPlan struct {
	ID          uuid.UUID      `json:"id"`
	Goal        string         `json:"goal"`
	TargetLevel *string        `json:"target_level"`
	StartsOn    time.Time      `json:"starts_on"`
	EndsOn      *time.Time     `json:"ends_on"`
	Plan        map[string]any `json:"plan"`
	GeneratedBy string         `json:"generated_by"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

type Module struct {
	pool *pgxpool.Pool
}

func NewModule(pool *pgxpool.Pool) *Module { return &Module{pool: pool} }

func (m *Module) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("", authz.RequirePermission(authz.PermLearningPractice))
	g.GET("/recommendations", m.list)
	g.GET("/learning-plan", m.plan)
}

func (m *Module) list(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT r.id, r.type, r.reason, r.priority, r.source, r.created_at, r.expires_at,
		       ci.id, ci.type, ci.title, s.code
		FROM recommendations r
		LEFT JOIN content_items ci ON ci.id = r.content_item_id
		LEFT JOIN skills s ON s.id = ci.skill_id
		WHERE r.user_id = $1 AND r.status = 'pending' AND (r.expires_at IS NULL OR r.expires_at > now())
		ORDER BY r.priority DESC, r.created_at DESC
		LIMIT 20`, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []Recommendation{}
	for rows.Next() {
		var r Recommendation
		var contentID *uuid.UUID
		var contentType, contentTitle, skill *string
		if err := rows.Scan(&r.ID, &r.Type, &r.Reason, &r.Priority, &r.Source, &r.CreatedAt, &r.ExpiresAt,
			&contentID, &contentType, &contentTitle, &skill); err != nil {
			httpx.Fail(c, err)
			return
		}
		if contentID != nil {
			r.Content = &ContentRef{ID: *contentID, Type: deref(contentType), Title: deref(contentTitle), Skill: skill}
		}
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, list)
}

func (m *Module) plan(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	var lp LearningPlan
	err := m.pool.QueryRow(c.Request.Context(), `
		SELECT lp.id, lp.goal, l.code, lp.starts_on, lp.ends_on, lp.plan, lp.generated_by, lp.updated_at
		FROM learning_plans lp
		LEFT JOIN levels l ON l.id = lp.target_level_id
		WHERE lp.user_id = $1 AND lp.status = 'active'`, p.UserID,
	).Scan(&lp.ID, &lp.Goal, &lp.TargetLevel, &lp.StartsOn, &lp.EndsOn, &lp.Plan, &lp.GeneratedBy, &lp.UpdatedAt)
	if database.IsNotFound(err) {
		httpx.OK(c, gin.H{"plan": nil})
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, gin.H{"plan": lp})
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
