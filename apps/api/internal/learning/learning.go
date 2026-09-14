// Package learning serves the learning catalogue: skills, levels and content items.
//
// It is read-only for learners today. Content is authored in the database (and later an
// admin panel / CMS); clients never embed learning content. Skill modules (speaking,
// writing, ...) build practice flows on top of the content served here.
package learning

import (
	"context"
	"encoding/json"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/cache"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

type Skill struct {
	ID          uuid.UUID `json:"id"`
	Code        string    `json:"code"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	SortOrder   int       `json:"sort_order"`
}

type Level struct {
	ID          uuid.UUID `json:"id"`
	Code        string    `json:"code"`
	Name        string    `json:"name"`
	Rank        int       `json:"rank"`
	Description string    `json:"description"`
}

type ContentSummary struct {
	ID          uuid.UUID  `json:"id"`
	Type        string     `json:"type"`
	Title       string     `json:"title"`
	Skill       *string    `json:"skill"`
	Level       *string    `json:"level"`
	Topic       *string    `json:"topic"`
	Exam        *string    `json:"exam"`
	Difficulty  int        `json:"difficulty"`
	Tags        []string   `json:"tags"`
	PublishedAt *time.Time `json:"published_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type ContentItem struct {
	ContentSummary
	SchemaVersion int             `json:"schema_version"`
	Body          json.RawMessage `json:"body"`
}

type ContentFilter struct {
	httpx.Pagination
	Type  string `form:"type" binding:"omitempty,max=64"`
	Skill string `form:"skill" binding:"omitempty,max=64"`
	Level string `form:"level" binding:"omitempty,max=8"`
	Exam  string `form:"exam" binding:"omitempty,max=32"`
	Tag   string `form:"tag" binding:"omitempty,max=64"`
}

const referenceCacheTTL = 10 * time.Minute

type Module struct {
	pool  *pgxpool.Pool
	redis *redis.Client
}

func NewModule(pool *pgxpool.Pool, redisClient *redis.Client) *Module {
	return &Module{pool: pool, redis: redisClient}
}

func (m *Module) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/learning")
	// Reference data is public: onboarding needs it before an account exists.
	g.GET("/skills", m.listSkills)
	g.GET("/levels", m.listLevels)

	content := g.Group("/content", authz.RequirePermission(authz.PermContentRead))
	content.GET("", m.listContent)
	content.GET("/:id", m.getContent)
}

func (m *Module) listSkills(c *gin.Context) {
	skills, err := cache.GetOrLoad(c.Request.Context(), m.redis, cache.Key("learning", "skills", "v1"),
		referenceCacheTTL, m.Skills)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, skills)
}

func (m *Module) listLevels(c *gin.Context) {
	levels, err := cache.GetOrLoad(c.Request.Context(), m.redis, cache.Key("learning", "levels", "v1"),
		referenceCacheTTL, m.Levels)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, levels)
}

func (m *Module) Skills(ctx context.Context) ([]Skill, error) {
	rows, err := m.pool.Query(ctx,
		`SELECT id, code, name, description, sort_order FROM skills WHERE is_active ORDER BY sort_order, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Skill{}
	for rows.Next() {
		var s Skill
		if err := rows.Scan(&s.ID, &s.Code, &s.Name, &s.Description, &s.SortOrder); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (m *Module) Levels(ctx context.Context) ([]Level, error) {
	rows, err := m.pool.Query(ctx, `SELECT id, code, name, rank, description FROM levels ORDER BY rank`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Level{}
	for rows.Next() {
		var l Level
		if err := rows.Scan(&l.ID, &l.Code, &l.Name, &l.Rank, &l.Description); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

const contentSelect = `
	SELECT ci.id, ci.type, ci.title, s.code, l.code, t.slug, ci.exam, ci.difficulty, ci.tags,
	       ci.published_at, ci.updated_at`

const contentFrom = `
	FROM content_items ci
	LEFT JOIN skills s ON s.id = ci.skill_id
	LEFT JOIN levels l ON l.id = ci.level_id
	LEFT JOIN topics t ON t.id = ci.topic_id
	WHERE ci.status = 'published'
	  AND ($1 = '' OR ci.type = $1)
	  AND ($2 = '' OR s.code = $2)
	  AND ($3 = '' OR l.code = upper($3))
	  AND ($4 = '' OR ci.exam = $4)
	  AND ($5 = '' OR $5 = ANY (ci.tags))`

func (m *Module) listContent(c *gin.Context) {
	var f ContentFilter
	if err := httpx.BindQuery(c, &f); err != nil {
		httpx.Fail(c, err)
		return
	}
	f.Pagination = f.Normalize()
	ctx := c.Request.Context()
	args := []any{f.Type, f.Skill, f.Level, f.Exam, f.Tag}

	var total int64
	if err := m.pool.QueryRow(ctx, `SELECT count(*) `+contentFrom, args...).Scan(&total); err != nil {
		httpx.Fail(c, err)
		return
	}
	rows, err := m.pool.Query(ctx,
		contentSelect+contentFrom+` ORDER BY ci.published_at DESC NULLS LAST, ci.id OFFSET $6 LIMIT $7`,
		append(args, f.Offset(), f.PageSize)...)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	items := []ContentSummary{}
	for rows.Next() {
		var s ContentSummary
		if err := rows.Scan(&s.ID, &s.Type, &s.Title, &s.Skill, &s.Level, &s.Topic, &s.Exam,
			&s.Difficulty, &s.Tags, &s.PublishedAt, &s.UpdatedAt); err != nil {
			httpx.Fail(c, err)
			return
		}
		items = append(items, s)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OKWithMeta(c, items, httpx.Meta{Page: f.Page, PageSize: f.PageSize, Total: total})
}

func (m *Module) getContent(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.NotFound("Content"))
		return
	}
	var item ContentItem
	s := &item.ContentSummary
	err = m.pool.QueryRow(c.Request.Context(), contentSelect+`, ci.schema_version, ci.body `+contentFrom+` AND ci.id = $6`,
		"", "", "", "", "", id,
	).Scan(&s.ID, &s.Type, &s.Title, &s.Skill, &s.Level, &s.Topic, &s.Exam, &s.Difficulty, &s.Tags,
		&s.PublishedAt, &s.UpdatedAt, &item.SchemaVersion, &item.Body)
	if database.IsNotFound(err) {
		httpx.Fail(c, apperr.NotFound("Content"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, item)
}
