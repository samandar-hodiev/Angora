// Package mistakes serves a learner's mistakes, recurring patterns and weaknesses.
//
// Mistakes are extracted from validated AI analyses and exercises (writers arrive with
// Phase 2+). Categories use a dotted taxonomy, e.g. grammar.tense.present_perfect; the
// first segment is the group shown to learners (grammar, vocabulary, pronunciation).
package mistakes

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

type Mistake struct {
	ID          uuid.UUID `json:"id"`
	Category    string    `json:"category"`
	Group       string    `json:"group"`
	Skill       *string   `json:"skill"`
	Original    string    `json:"original"`
	Correction  string    `json:"correction"`
	Explanation string    `json:"explanation"`
	Severity    string    `json:"severity"`
	SourceType  string    `json:"source_type"`
	CreatedAt   time.Time `json:"created_at"`
}

type GroupCount struct {
	Group string `json:"group"`
	Count int    `json:"count"`
}

// Pattern is the same correction appearing repeatedly.
type Pattern struct {
	Category    string    `json:"category"`
	Correction  string    `json:"correction"`
	Example     string    `json:"example"`
	Explanation string    `json:"explanation"`
	Occurrences int       `json:"occurrences"`
	LastSeenAt  time.Time `json:"last_seen_at"`
}

type Weakness struct {
	Category       string    `json:"category"`
	Skill          *string   `json:"skill"`
	SeverityScore  float64   `json:"severity_score"`
	EvidenceCount  int       `json:"evidence_count"`
	Status         string    `json:"status"`
	LastDetectedAt time.Time `json:"last_detected_at"`
}

type Summary struct {
	Total      int          `json:"total"`
	Groups     []GroupCount `json:"groups"`
	Patterns   []Pattern    `json:"patterns"`
	Weaknesses []Weakness   `json:"weaknesses"`
}

type Filter struct {
	httpx.Pagination
	Group string `form:"group" binding:"omitempty,max=32"`
}

type Module struct {
	pool *pgxpool.Pool
}

func NewModule(pool *pgxpool.Pool) *Module { return &Module{pool: pool} }

func (m *Module) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/mistakes", authz.RequirePermission(authz.PermLearningPractice))
	g.GET("", m.list)
	g.GET("/summary", m.summary)
}

func (m *Module) list(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	var f Filter
	if err := httpx.BindQuery(c, &f); err != nil {
		httpx.Fail(c, err)
		return
	}
	f.Pagination = f.Normalize()

	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT m.id, m.category, split_part(m.category, '.', 1), s.code, m.original_text, m.corrected_text,
		       m.explanation, m.severity, m.source_type, m.created_at, count(*) OVER ()
		FROM mistakes m
		LEFT JOIN skills s ON s.id = m.skill_id
		WHERE m.user_id = $1 AND ($2 = '' OR split_part(m.category, '.', 1) = $2)
		ORDER BY m.created_at DESC
		OFFSET $3 LIMIT $4`, p.UserID, f.Group, f.Offset(), f.PageSize)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []Mistake{}
	var total int64
	for rows.Next() {
		var mk Mistake
		if err := rows.Scan(&mk.ID, &mk.Category, &mk.Group, &mk.Skill, &mk.Original, &mk.Correction,
			&mk.Explanation, &mk.Severity, &mk.SourceType, &mk.CreatedAt, &total); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, mk)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OKWithMeta(c, list, httpx.Meta{Page: f.Page, PageSize: f.PageSize, Total: total})
}

func (m *Module) summary(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	ctx := c.Request.Context()
	s := Summary{Groups: []GroupCount{}, Patterns: []Pattern{}, Weaknesses: []Weakness{}}

	groups, err := m.pool.Query(ctx, `
		SELECT split_part(category, '.', 1), count(*)::int
		FROM mistakes WHERE user_id = $1
		GROUP BY 1 ORDER BY 2 DESC`, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	for groups.Next() {
		var g GroupCount
		if err := groups.Scan(&g.Group, &g.Count); err != nil {
			groups.Close()
			httpx.Fail(c, err)
			return
		}
		s.Total += g.Count
		s.Groups = append(s.Groups, g)
	}
	groups.Close()

	patterns, err := m.pool.Query(ctx, `
		SELECT category, corrected_text,
		       (array_agg(original_text ORDER BY created_at DESC))[1],
		       (array_agg(explanation ORDER BY created_at DESC))[1],
		       count(*)::int, max(created_at)
		FROM mistakes WHERE user_id = $1
		GROUP BY category, corrected_text
		HAVING count(*) > 1
		ORDER BY count(*) DESC, max(created_at) DESC
		LIMIT 10`, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	for patterns.Next() {
		var pt Pattern
		if err := patterns.Scan(&pt.Category, &pt.Correction, &pt.Example, &pt.Explanation, &pt.Occurrences, &pt.LastSeenAt); err != nil {
			patterns.Close()
			httpx.Fail(c, err)
			return
		}
		s.Patterns = append(s.Patterns, pt)
	}
	patterns.Close()

	weaknesses, err := m.pool.Query(ctx, `
		SELECT w.category, s.code, w.severity_score::float8, w.evidence_count, w.status, w.last_detected_at
		FROM weaknesses w
		LEFT JOIN skills s ON s.id = w.skill_id
		WHERE w.user_id = $1 AND w.status <> 'resolved'
		ORDER BY w.severity_score DESC
		LIMIT 10`, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer weaknesses.Close()
	for weaknesses.Next() {
		var w Weakness
		if err := weaknesses.Scan(&w.Category, &w.Skill, &w.SeverityScore, &w.EvidenceCount, &w.Status, &w.LastDetectedAt); err != nil {
			httpx.Fail(c, err)
			return
		}
		s.Weaknesses = append(s.Weaknesses, w)
	}
	if err := weaknesses.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, s)
}
