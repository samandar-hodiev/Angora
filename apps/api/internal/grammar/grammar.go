// Package grammar serves grammar topics with the learner's mastery.
//
// Exercises (content_items of type grammar_exercise) and mastery updates arrive in
// Phase 5. Grammar mistakes map to topics through the mistake category taxonomy.
package grammar

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

type Topic struct {
	Slug            string     `json:"slug"`
	Name            string     `json:"name"`
	Description     string     `json:"description"`
	Level           *string    `json:"level"`
	Mastery         float64    `json:"mastery"`
	Attempts        int        `json:"attempts"`
	LastPracticedAt *time.Time `json:"last_practiced_at"`
}

type Module struct {
	pool *pgxpool.Pool
}

func NewModule(pool *pgxpool.Pool) *Module { return &Module{pool: pool} }

func (m *Module) RegisterRoutes(v1 *gin.RouterGroup) {
	v1.GET("/grammar/topics", authz.RequirePermission(authz.PermLearningPractice), m.topics)
}

func (m *Module) topics(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT g.slug, g.name, g.description, l.code, COALESCE(up.mastery, 0)::float8,
		       COALESCE(up.attempts, 0), up.last_practiced_at
		FROM grammar_topics g
		LEFT JOIN levels l ON l.id = g.level_id
		LEFT JOIN user_grammar_progress up ON up.grammar_topic_id = g.id AND up.user_id = $1
		WHERE g.status = 'published'
		ORDER BY l.rank NULLS LAST, g.sort_order, g.name`, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	topics := []Topic{}
	for rows.Next() {
		var t Topic
		if err := rows.Scan(&t.Slug, &t.Name, &t.Description, &t.Level, &t.Mastery, &t.Attempts, &t.LastPracticedAt); err != nil {
			httpx.Fail(c, err)
			return
		}
		topics = append(topics, t)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, topics)
}
