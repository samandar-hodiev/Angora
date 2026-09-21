package admin

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
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
	QuestionCount int `json:"question_count"`
	/** The revision learners are currently reading. */
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"created_at"`
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
	/** Why this edit was made. Stored with the revision it produces. */
	Note *string `json:"note" binding:"omitempty,max=300"`
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
		       ci.published_at, ci.updated_at, ci.body, ci.tags, ci.created_at, ci.version,
		       (SELECT count(*) FROM assessment_items ai WHERE ai.stimulus_id = ci.id)
		FROM content_items ci
		LEFT JOIN skills s ON s.id = ci.skill_id
		LEFT JOIN levels l ON l.id = ci.level_id
		LEFT JOIN topics t ON t.id = ci.topic_id
		WHERE ci.id = $1`, id).
		Scan(&d.ID, &d.Type, &d.Title, &d.Skill, &d.Level, &d.Topic, &d.Exam, &d.Difficulty, &d.Status,
			&d.PublishedAt, &d.UpdatedAt, &d.Body, &d.Tags, &d.CreatedAt, &d.Version, &d.QuestionCount)
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

	// Version 1 exists from the moment the item does, so history never begins halfway.
	if _, err := m.pool.Exec(c.Request.Context(), `
		INSERT INTO content_item_versions (content_item_id, version, title, body, difficulty, tags, status, schema_version, note, created_by)
		SELECT id, version, title, body, difficulty, tags, status, schema_version, 'Created', $2
		FROM content_items WHERE id = $1`, id, principal.UserID); err != nil {
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

// updateContent edits an item and records what it now says.
//
// Only the text learners read is versioned — title, body, difficulty, tags. Moving an item
// to a different skill or level is reclassification, not revision: it changes who is shown
// the item, not what they read, and a history full of "moved to B2" entries would bury the
// edits that matter. A save that changes nothing produces no revision.
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

	note := ""
	if in.Note != nil {
		note = *in.Note
	}
	ctx := c.Request.Context()
	revised := false
	err = database.WithTx(ctx, m.pool, func(tx pgx.Tx) error {
		var current ContentDetail
		if err := tx.QueryRow(ctx, `
			SELECT title, body, difficulty, tags, version FROM content_items WHERE id = $1 FOR UPDATE`, id).
			Scan(&current.Title, &current.Body, &current.Difficulty, &current.Tags, &current.Version); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return apperr.NotFound("Content")
			}
			return err
		}
		revised = contentChanged(current, in)

		if _, err := tx.Exec(ctx, `
			UPDATE content_items ci SET
				title      = COALESCE($2, ci.title),
				type       = COALESCE($3, ci.type),
				skill_id   = COALESCE((SELECT id FROM skills WHERE code = $4), ci.skill_id),
				level_id   = COALESCE((SELECT id FROM levels WHERE code = upper($5)), ci.level_id),
				topic_id   = COALESCE((SELECT id FROM topics WHERE slug = $6), ci.topic_id),
				exam       = COALESCE($7, ci.exam),
				difficulty = COALESCE($8, ci.difficulty),
				tags       = COALESCE($9, ci.tags),
				body       = COALESCE($10, ci.body),
				version    = ci.version + $11
			WHERE ci.id = $1`,
			id, in.Title, in.Type, in.Skill, in.Level, in.Topic, in.Exam, in.Difficulty, in.Tags, in.Body,
			boolToInt(revised)); err != nil {
			return err
		}
		if !revised {
			return nil
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO content_item_versions (content_item_id, version, title, body, difficulty, tags, status, schema_version, note, created_by)
			SELECT id, version, title, body, difficulty, tags, status, schema_version, $2, $3
			FROM content_items WHERE id = $1`, id, note, principal.UserID)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	m.audit.Record(ctx, audit.Entry{
		ActorID: &principal.UserID, Action: ActionContentUpdated, EntityType: "content_item",
		EntityID: id.String(), Metadata: map[string]any{"new_revision": revised},
		IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})

	d, err := m.loadContent(c, id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, d)
}

// contentChanged reports whether an edit touches anything a learner would notice.
func contentChanged(current ContentDetail, in ContentInput) bool {
	if in.Title != nil && *in.Title != current.Title {
		return true
	}
	if in.Difficulty != nil && *in.Difficulty != current.Difficulty {
		return true
	}
	if in.Body != nil && !bytes.Equal(normalizeJSON(*in.Body), normalizeJSON(current.Body)) {
		return true
	}
	if in.Tags != nil && !slices.Equal(*in.Tags, current.Tags) {
		return true
	}
	return false
}

// normalizeJSON compares bodies by value rather than by byte, so whitespace or key order
// from a different client does not look like an edit.
func normalizeJSON(raw json.RawMessage) []byte {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return raw
	}
	out, err := json.Marshal(v)
	if err != nil {
		return raw
	}
	return out
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
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
	// The history has to be able to answer "which revision did we publish?", so the
	// current revision carries the status the item now has.
	if _, err := m.pool.Exec(c.Request.Context(), `
		UPDATE content_item_versions v SET status = $2
		FROM content_items ci
		WHERE ci.id = $1 AND v.content_item_id = ci.id AND v.version = ci.version`, id, in.Status); err != nil {
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

// ---- revisions -------------------------------------------------------------------------

const ActionContentRestored = "content.restored"

type ContentVersion struct {
	Version    int       `json:"version"`
	Title      string    `json:"title"`
	Difficulty int       `json:"difficulty"`
	Tags       []string  `json:"tags"`
	Status     string    `json:"status"`
	Note       string    `json:"note"`
	AuthorName *string   `json:"author"`
	IsCurrent  bool      `json:"is_current"`
	CreatedAt  time.Time `json:"created_at"`
}

type ContentVersionDetail struct {
	ContentVersion
	Body json.RawMessage `json:"body"`
}

// contentVersions lists what an item used to say. The body is left out: a history list is
// read to choose a revision, and shipping every old passage to render a list of dates is
// a lot of bytes for a question nobody asked.
func (m *Module) contentVersions(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid content id"))
		return
	}
	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT v.version, v.title, v.difficulty, v.tags, v.status, v.note, u.email, v.created_at,
		       v.version = ci.version
		FROM content_item_versions v
		JOIN content_items ci ON ci.id = v.content_item_id
		LEFT JOIN users u ON u.id = v.created_by
		WHERE v.content_item_id = $1
		ORDER BY v.version DESC LIMIT 50`, id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []ContentVersion{}
	for rows.Next() {
		var v ContentVersion
		if err := rows.Scan(&v.Version, &v.Title, &v.Difficulty, &v.Tags, &v.Status, &v.Note,
			&v.AuthorName, &v.CreatedAt, &v.IsCurrent); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, v)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, list)
}

func (m *Module) contentVersion(c *gin.Context) {
	id, version, err := contentVersionParams(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var v ContentVersionDetail
	err = m.pool.QueryRow(c.Request.Context(), `
		SELECT v.version, v.title, v.difficulty, v.tags, v.status, v.note, u.email, v.created_at,
		       v.version = ci.version, v.body
		FROM content_item_versions v
		JOIN content_items ci ON ci.id = v.content_item_id
		LEFT JOIN users u ON u.id = v.created_by
		WHERE v.content_item_id = $1 AND v.version = $2`, id, version).
		Scan(&v.Version, &v.Title, &v.Difficulty, &v.Tags, &v.Status, &v.Note, &v.AuthorName,
			&v.CreatedAt, &v.IsCurrent, &v.Body)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.NotFound("Revision"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, v)
}

// restoreContentVersion brings an old revision back as a new one.
//
// The history is never rewound: restoring version 3 produces version 8 with version 3's
// text. Anyone reading the history afterwards can see that a restore happened and what it
// replaced, which is the whole reason for keeping a history.
func (m *Module) restoreContentVersion(c *gin.Context) {
	principal, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	id, version, err := contentVersionParams(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	ctx := c.Request.Context()

	err = database.WithTx(ctx, m.pool, func(tx pgx.Tx) error {
		var current int
		if err := tx.QueryRow(ctx, `SELECT version FROM content_items WHERE id = $1 FOR UPDATE`, id).Scan(&current); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return apperr.NotFound("Content")
			}
			return err
		}
		if current == version {
			return apperr.Conflict("That revision is already the current one")
		}
		tag, err := tx.Exec(ctx, `
			UPDATE content_items ci SET
				title = v.title, body = v.body, difficulty = v.difficulty, tags = v.tags,
				version = ci.version + 1
			FROM content_item_versions v
			WHERE ci.id = $1 AND v.content_item_id = $1 AND v.version = $2`, id, version)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return apperr.NotFound("Revision")
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO content_item_versions (content_item_id, version, title, body, difficulty, tags, status, schema_version, note, created_by)
			SELECT id, version, title, body, difficulty, tags, status, schema_version, $2, $3::uuid
			FROM content_items WHERE id = $1`, id, fmt.Sprintf("Restored from version %d", version), principal.UserID)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	m.audit.Record(ctx, audit.Entry{
		ActorID: &principal.UserID, Action: ActionContentRestored, EntityType: "content_item",
		EntityID: id.String(), Metadata: map[string]any{"restored_from": version},
		IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})

	d, err := m.loadContent(c, id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, d)
}

func contentVersionParams(c *gin.Context) (uuid.UUID, int, error) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return uuid.Nil, 0, apperr.BadRequest("Invalid content id")
	}
	version, err := strconv.Atoi(c.Param("version"))
	if err != nil || version < 1 {
		return uuid.Nil, 0, apperr.BadRequest("Invalid revision number")
	}
	return id, version, nil
}
