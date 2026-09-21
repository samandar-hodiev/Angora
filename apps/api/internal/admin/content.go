package admin

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Content management.
//
// The existing listing (see admin.go) answers "what exists"; this adds the editing side:
// opening one item, changing it, and moving it through draft → review → published. Publishing
// is the only state change with a consequence for learners, so it is the one that is checked
// rather than simply written.

const (
	ActionContentCreated       = "content.created"
	ActionContentUpdated       = "content.updated"
	ActionContentStatusChanged = "content.status_changed"
)

type ContentDetail struct {
	ContentRow
	Body json.RawMessage `json:"body"`
	Tags []string        `json:"tags"`
	/** Practice questions authored against this item in the question bank. */
	QuestionCount int       `json:"question_count"`
	CreatedAt     time.Time `json:"created_at"`
}

type ContentInput struct {
	Title      *string          `json:"title" binding:"omitempty,min=2,max=200"`
	Type       *string          `json:"type" binding:"omitempty,max=64"`
	Skill      *string          `json:"skill" binding:"omitempty,max=32"`
	Level      *string          `json:"level" binding:"omitempty,max=8"`
	Topic      *string          `json:"topic" binding:"omitempty,max=120"`
	Exam       *string          `json:"exam" binding:"omitempty,max=32"`
	Difficulty *int             `json:"difficulty" binding:"omitempty,min=1,max=10"`
	Tags       *[]string        `json:"tags"`
	Body       *json.RawMessage `json:"body"`
}

type ContentStatusInput struct {
	Status string `json:"status" binding:"required,oneof=draft review published archived"`
}

func (m *Module) contentItem(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid content id"))
		return
	}
	d, err := m.loadContent(c, id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, d)
}

func (m *Module) loadContent(c *gin.Context, id uuid.UUID) (ContentDetail, error) {
	var d ContentDetail
	err := m.pool.QueryRow(c.Request.Context(), `
		SELECT ci.id, ci.type, ci.title, s.code, l.code, t.slug, ci.exam, ci.difficulty, ci.status,
		       ci.published_at, ci.updated_at, ci.body, ci.tags, ci.created_at,
		       (SELECT count(*) FROM assessment_items ai WHERE ai.stimulus_id = ci.id)
		FROM content_items ci
		LEFT JOIN skills s ON s.id = ci.skill_id
		LEFT JOIN levels l ON l.id = ci.level_id
		LEFT JOIN topics t ON t.id = ci.topic_id
		WHERE ci.id = $1`, id).
		Scan(&d.ID, &d.Type, &d.Title, &d.Skill, &d.Level, &d.Topic, &d.Exam, &d.Difficulty, &d.Status,
			&d.PublishedAt, &d.UpdatedAt, &d.Body, &d.Tags, &d.CreatedAt, &d.QuestionCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, apperr.NotFound("Content")
	}
	return d, err
}

func (m *Module) createContent(c *gin.Context) {
	principal, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var in ContentInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	missing := map[string]any{}
	if in.Title == nil {
		missing["title"] = "Required"
	}
	if in.Type == nil {
		missing["type"] = "Required"
	}
	if len(missing) > 0 {
		httpx.Fail(c, apperr.Validation(missing))
		return
	}

	body := json.RawMessage(`{}`)
	if in.Body != nil {
		body = *in.Body
	}
	tags := []string{}
	if in.Tags != nil {
		tags = *in.Tags
	}

	var id uuid.UUID
	if err := m.pool.QueryRow(c.Request.Context(), `
		INSERT INTO content_items (type, title, skill_id, level_id, topic_id, exam, difficulty, tags, status, body, created_by)
		VALUES ($1, $2,
		        (SELECT id FROM skills WHERE code = $3),
		        (SELECT id FROM levels WHERE code = upper($4)),
		        (SELECT id FROM topics WHERE slug = $5),
		        $6, $7, $8, 'draft', $9, $10)
		RETURNING id`,
		*in.Type, *in.Title, in.Skill, in.Level, in.Topic, in.Exam, intOr(in.Difficulty, 5), tags, body,
		principal.UserID).Scan(&id); err != nil {
		httpx.Fail(c, err)
		return
	}

	m.audit.Record(c.Request.Context(), audit.Entry{
		ActorID: &principal.UserID, Action: ActionContentCreated, EntityType: "content_item",
		EntityID: id.String(), Metadata: map[string]any{"title": *in.Title, "type": *in.Type},
		IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})

	d, err := m.loadContent(c, id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.Created(c, d)
}

func (m *Module) updateContent(c *gin.Context) {
	principal, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid content id"))
		return
	}
	var in ContentInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}

	tag, err := m.pool.Exec(c.Request.Context(), `
		UPDATE content_items ci SET
			title      = COALESCE($2, ci.title),
			type       = COALESCE($3, ci.type),
			skill_id   = COALESCE((SELECT id FROM skills WHERE code = $4), ci.skill_id),
			level_id   = COALESCE((SELECT id FROM levels WHERE code = upper($5)), ci.level_id),
			topic_id   = COALESCE((SELECT id FROM topics WHERE slug = $6), ci.topic_id),
			exam       = COALESCE($7, ci.exam),
			difficulty = COALESCE($8, ci.difficulty),
			tags       = COALESCE($9, ci.tags),
			body       = COALESCE($10, ci.body)
		WHERE ci.id = $1`,
		id, in.Title, in.Type, in.Skill, in.Level, in.Topic, in.Exam, in.Difficulty, in.Tags, in.Body)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Fail(c, apperr.NotFound("Content"))
		return
	}

	m.audit.Record(c.Request.Context(), audit.Entry{
		ActorID: &principal.UserID, Action: ActionContentUpdated, EntityType: "content_item",
		EntityID: id.String(), IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})

	d, err := m.loadContent(c, id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, d)
}

// setContentStatus moves an item through the workflow.
//
// Publishing a reading or listening set with no published questions would put a dead end in
// front of learners — the practice API filters those out, so the item would simply never
// appear. Saying so here is more useful than publishing into silence.
func (m *Module) setContentStatus(c *gin.Context) {
	principal, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid content id"))
		return
	}
	var in ContentStatusInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}

	current, err := m.loadContent(c, id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	if in.Status == "published" && current.Skill != nil && (*current.Skill == "reading" || *current.Skill == "listening") {
		var published int
		if err := m.pool.QueryRow(c.Request.Context(), `
			SELECT count(*) FROM assessment_items
			WHERE stimulus_id = $1 AND status = 'published'`, id).Scan(&published); err != nil {
			httpx.Fail(c, err)
			return
		}
		if published == 0 {
			httpx.Fail(c, apperr.Conflict(
				"Publish at least one question for this set first — learners are only offered sets they can answer"))
			return
		}
	}

	if _, err := m.pool.Exec(c.Request.Context(), `
		UPDATE content_items
		SET status = $2,
		    published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, now()) ELSE published_at END
		WHERE id = $1`, id, in.Status); err != nil {
		httpx.Fail(c, err)
		return
	}

	m.audit.Record(c.Request.Context(), audit.Entry{
		ActorID: &principal.UserID, Action: ActionContentStatusChanged, EntityType: "content_item",
		EntityID: id.String(),
		Metadata: map[string]any{"title": current.Title, "from": current.Status, "to": in.Status},
		IP:       c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})

	d, err := m.loadContent(c, id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, d)
}

// contentTaxonomy is what the editor's selects need: the skills, levels and topics that
// exist, so the console never offers a value the database will reject.
func (m *Module) contentTaxonomy(c *gin.Context) {
	ctx := c.Request.Context()
	type option struct {
		Code string `json:"code"`
		Name string `json:"name"`
	}
	out := map[string][]option{"skills": {}, "levels": {}, "topics": {}}

	for key, query := range map[string]string{
		"skills": `SELECT code, name FROM skills ORDER BY sort_order`,
		"levels": `SELECT code, name FROM levels ORDER BY rank`,
		"topics": `SELECT slug, name FROM topics ORDER BY name`,
	} {
		rows, err := m.pool.Query(ctx, query)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		for rows.Next() {
			var o option
			if err := rows.Scan(&o.Code, &o.Name); err != nil {
				rows.Close()
				httpx.Fail(c, err)
				return
			}
			out[key] = append(out[key], o)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			httpx.Fail(c, err)
			return
		}
	}
	httpx.OK(c, out)
}
