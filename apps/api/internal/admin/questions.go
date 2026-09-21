package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// The question bank: owner-facing management of assessment_items.
//
// The table already backs placement: the learner service selects published items by
// kind/skill/level/difficulty and scores objective answers against answer_key. This file adds
// the authoring side over the same rows — there is no second question store, so an item the
// owner publishes here is the item a learner meets, and an answer key edited here changes how
// answers are marked from the next attempt onwards.
//
// answer_key never leaves the server for learners; it is returned here because the caller
// holds assessments:manage.

const (
	ActionItemCreated       = "assessment_item.created"
	ActionItemUpdated       = "assessment_item.updated"
	ActionItemStatusChanged = "assessment_item.status_changed"
)

// objectiveTypes are marked deterministically from answer_key; the rest are AI-evaluated
// tasks and carry no key (mirrors the CHECK constraint on assessment_items).
var objectiveTypes = map[string]bool{
	"multiple_choice":       true,
	"true_false_not_given":  true,
	"vocabulary_in_context": true,
}

var itemTypes = map[string]bool{
	"multiple_choice":       true,
	"true_false_not_given":  true,
	"vocabulary_in_context": true,
	"writing_task":          true,
	"speaking_task":         true,
}

var itemStatuses = map[string]bool{"draft": true, "review": true, "published": true, "archived": true}

type QuestionRow struct {
	ID          uuid.UUID  `json:"id"`
	Slug        string     `json:"slug"`
	Kind        string     `json:"kind"`
	Skill       string     `json:"skill"`
	Level       string     `json:"level"`
	Difficulty  int        `json:"difficulty"`
	Topic       string     `json:"topic"`
	ItemType    string     `json:"item_type"`
	StimulusID  *uuid.UUID `json:"stimulus_id"`
	Stimulus    *string    `json:"stimulus_title"`
	Position    int        `json:"position"`
	Prompt      string     `json:"prompt"`
	Status      string     `json:"status"`
	Version     int        `json:"version"`
	OptionCount int        `json:"option_count"`
	PublishedAt *time.Time `json:"published_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// QuestionDetail is the authoring view: everything the owner edits, including the answer key.
type QuestionDetail struct {
	QuestionRow
	Options     json.RawMessage `json:"options"`
	AnswerKey   json.RawMessage `json:"answer_key"`
	Explanation string          `json:"explanation"`
	Settings    json.RawMessage `json:"settings"`
	CreatedAt   time.Time       `json:"created_at"`
}

type QuestionFilter struct {
	httpx.Pagination
	Kind          string `form:"kind" binding:"omitempty,max=32"`
	Skill         string `form:"skill" binding:"omitempty,oneof=reading listening writing speaking"`
	Level         string `form:"level" binding:"omitempty,max=8"`
	Status        string `form:"status" binding:"omitempty,oneof=draft review published archived"`
	ItemType      string `form:"item_type" binding:"omitempty,max=32"`
	Topic         string `form:"topic" binding:"omitempty,max=120"`
	DifficultyMin int    `form:"difficulty_min" binding:"omitempty,min=1,max=10"`
	DifficultyMax int    `form:"difficulty_max" binding:"omitempty,min=1,max=10"`
	Search        string `form:"search" binding:"omitempty,max=120"`
	Sort          string `form:"sort" binding:"omitempty,oneof=updated slug difficulty"`
}

// QuestionInput is the create/update body. Pointers mark "not supplied" on PATCH.
type QuestionInput struct {
	Slug        *string          `json:"slug" binding:"omitempty,min=3,max=120"`
	Kind        *string          `json:"kind" binding:"omitempty,max=32"`
	Skill       *string          `json:"skill" binding:"omitempty,oneof=reading listening writing speaking"`
	Level       *string          `json:"level" binding:"omitempty,max=8"`
	Difficulty  *int             `json:"difficulty" binding:"omitempty,min=1,max=10"`
	Topic       *string          `json:"topic" binding:"omitempty,max=120"`
	ItemType    *string          `json:"item_type" binding:"omitempty,max=32"`
	StimulusID  *uuid.UUID       `json:"stimulus_id"`
	Position    *int             `json:"position" binding:"omitempty,min=0,max=999"`
	Prompt      *string          `json:"prompt" binding:"omitempty,min=1,max=4000"`
	Options     *json.RawMessage `json:"options"`
	AnswerKey   *json.RawMessage `json:"answer_key"`
	Explanation *string          `json:"explanation" binding:"omitempty,max=4000"`
	Settings    *json.RawMessage `json:"settings"`
}

type QuestionStatusInput struct {
	Status string `json:"status" binding:"required,oneof=draft review published archived"`
}

type QuestionOption struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// QuestionStats is the bank at a glance: what exists, and where the gaps are.
type QuestionStats struct {
	Total    int64            `json:"total"`
	ByStatus []QuestionBucket `json:"by_status"`
	BySkill  []QuestionBucket `json:"by_skill"`
	ByLevel  []QuestionBucket `json:"by_level"`
	ByType   []QuestionBucket `json:"by_type"`
	/** Published items per skill × level: an empty cell is a level a placement test cannot fill. */
	Coverage []QuestionCoverage `json:"coverage"`
}

type QuestionBucket struct {
	Key   string `json:"key"`
	Count int64  `json:"count"`
}

type QuestionCoverage struct {
	Skill     string `json:"skill"`
	Level     string `json:"level"`
	Published int64  `json:"published"`
	Draft     int64  `json:"draft"`
}

// ---- Validation ------------------------------------------------------------------------

// validateQuestion enforces the rules the database cannot express on its own: an objective
// item must be answerable (a key that names a real option), and a task must not carry a key.
// Returned errors are field-addressed so the console can mark the offending input.
func validateQuestion(itemType string, options json.RawMessage, answerKey json.RawMessage) error {
	if !itemTypes[itemType] {
		return apperr.Validation(map[string]any{"item_type": "Unknown question type"})
	}

	var opts []QuestionOption
	if len(options) > 0 {
		if err := json.Unmarshal(options, &opts); err != nil {
			return apperr.Validation(map[string]any{"options": "Must be a list of {id, text} objects"})
		}
	}

	if !objectiveTypes[itemType] {
		if len(answerKey) > 0 && string(answerKey) != "null" {
			return apperr.Validation(map[string]any{"answer_key": "Tasks are evaluated by AI and must not carry an answer key"})
		}
		return nil
	}

	if len(opts) < 2 {
		return apperr.Validation(map[string]any{"options": "An objective question needs at least two options"})
	}
	seen := map[string]bool{}
	for i, o := range opts {
		if strings.TrimSpace(o.ID) == "" || strings.TrimSpace(o.Text) == "" {
			return apperr.Validation(map[string]any{"options": fmt.Sprintf("Option %d needs both an id and text", i+1)})
		}
		if seen[o.ID] {
			return apperr.Validation(map[string]any{"options": "Option ids must be unique"})
		}
		seen[o.ID] = true
	}

	if len(answerKey) == 0 || string(answerKey) == "null" {
		return apperr.Validation(map[string]any{"answer_key": "An objective question needs an answer key"})
	}
	var key struct {
		OptionID string `json:"option_id"`
	}
	if err := json.Unmarshal(answerKey, &key); err != nil || key.OptionID == "" {
		return apperr.Validation(map[string]any{"answer_key": `Must be {"option_id": "..."}`})
	}
	if !seen[key.OptionID] {
		return apperr.Validation(map[string]any{"answer_key": "The answer key must name one of the options"})
	}
	return nil
}

// publishable reports whether an item may go live. Publishing an unanswerable item would
// silently mis-mark every learner who meets it, so the same validation guards the transition.
func publishable(d QuestionDetail) error {
	if strings.TrimSpace(d.Prompt) == "" {
		return apperr.Validation(map[string]any{"prompt": "A published question needs a prompt"})
	}
	return validateQuestion(d.ItemType, d.Options, d.AnswerKey)
}

// ---- Handlers --------------------------------------------------------------------------

func (m *Module) questions(c *gin.Context) {
	var f QuestionFilter
	if err := httpx.BindQuery(c, &f); err != nil {
		httpx.Fail(c, err)
		return
	}
	f.Pagination = f.Normalize()
	if f.DifficultyMax == 0 {
		f.DifficultyMax = 10
	}
	if f.DifficultyMin == 0 {
		f.DifficultyMin = 1
	}

	order := "ai.updated_at DESC"
	switch f.Sort {
	case "slug":
		order = "ai.slug ASC"
	case "difficulty":
		order = "ai.difficulty ASC, ai.slug ASC"
	}

	rows, err := m.pool.Query(c.Request.Context(), fmt.Sprintf(`
		SELECT ai.id, ai.slug, ai.kind, ai.skill, l.code, ai.difficulty, ai.topic, ai.item_type,
		       ai.stimulus_id, ci.title, ai.position, ai.prompt, ai.status, ai.version,
		       jsonb_array_length(ai.options), ai.published_at, ai.updated_at, count(*) OVER ()
		FROM assessment_items ai
		JOIN levels l ON l.id = ai.level_id
		LEFT JOIN content_items ci ON ci.id = ai.stimulus_id
		WHERE ($1 = '' OR ai.kind = $1)
		  AND ($2 = '' OR ai.skill = $2)
		  AND ($3 = '' OR l.code = upper($3))
		  AND ($4 = '' OR ai.status = $4)
		  AND ($5 = '' OR ai.item_type = $5)
		  AND ($6 = '' OR ai.topic ILIKE '%%' || $6 || '%%')
		  AND ai.difficulty BETWEEN $7 AND $8
		  AND ($9 = '' OR ai.prompt ILIKE '%%' || $9 || '%%' OR ai.slug ILIKE '%%' || $9 || '%%')
		ORDER BY %s
		OFFSET $10 LIMIT $11`, order),
		f.Kind, f.Skill, f.Level, f.Status, f.ItemType, f.Topic, f.DifficultyMin, f.DifficultyMax,
		f.Search, f.Offset(), f.PageSize)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []QuestionRow{}
	var total int64
	for rows.Next() {
		var r QuestionRow
		if err := rows.Scan(&r.ID, &r.Slug, &r.Kind, &r.Skill, &r.Level, &r.Difficulty, &r.Topic, &r.ItemType,
			&r.StimulusID, &r.Stimulus, &r.Position, &r.Prompt, &r.Status, &r.Version, &r.OptionCount,
			&r.PublishedAt, &r.UpdatedAt, &total); err != nil {
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

func (m *Module) question(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid question id"))
		return
	}
	d, err := m.loadQuestion(c.Request.Context(), id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, d)
}

func (m *Module) loadQuestion(ctx context.Context, id uuid.UUID) (QuestionDetail, error) {
	var d QuestionDetail
	err := m.pool.QueryRow(ctx, `
		SELECT ai.id, ai.slug, ai.kind, ai.skill, l.code, ai.difficulty, ai.topic, ai.item_type,
		       ai.stimulus_id, ci.title, ai.position, ai.prompt, ai.status, ai.version,
		       jsonb_array_length(ai.options), ai.published_at, ai.updated_at,
		       ai.options, ai.answer_key, ai.explanation, ai.settings, ai.created_at
		FROM assessment_items ai
		JOIN levels l ON l.id = ai.level_id
		LEFT JOIN content_items ci ON ci.id = ai.stimulus_id
		WHERE ai.id = $1`, id).
		Scan(&d.ID, &d.Slug, &d.Kind, &d.Skill, &d.Level, &d.Difficulty, &d.Topic, &d.ItemType,
			&d.StimulusID, &d.Stimulus, &d.Position, &d.Prompt, &d.Status, &d.Version, &d.OptionCount,
			&d.PublishedAt, &d.UpdatedAt, &d.Options, &d.AnswerKey, &d.Explanation, &d.Settings, &d.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return QuestionDetail{}, apperr.NotFound("Question")
	}
	return d, err
}

func (m *Module) createQuestion(c *gin.Context) {
	principal, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var in QuestionInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}

	missing := map[string]any{}
	for field, supplied := range map[string]bool{
		"slug": in.Slug != nil, "skill": in.Skill != nil, "level": in.Level != nil,
		"item_type": in.ItemType != nil, "prompt": in.Prompt != nil,
	} {
		if !supplied {
			missing[field] = "Required"
		}
	}
	if len(missing) > 0 {
		httpx.Fail(c, apperr.Validation(missing))
		return
	}

	options := rawOr(in.Options, json.RawMessage(`[]`))
	settings := rawOr(in.Settings, json.RawMessage(`{}`))
	var answerKey any
	if in.AnswerKey != nil && string(*in.AnswerKey) != "null" {
		answerKey = *in.AnswerKey
	}
	if err := validateQuestion(*in.ItemType, options, rawOr(in.AnswerKey, nil)); err != nil {
		httpx.Fail(c, err)
		return
	}

	kind := "placement"
	if in.Kind != nil && *in.Kind != "" {
		kind = *in.Kind
	}

	var id uuid.UUID
	err = m.pool.QueryRow(c.Request.Context(), `
		INSERT INTO assessment_items (slug, kind, skill, level_id, difficulty, topic, item_type,
		                              stimulus_id, position, prompt, options, answer_key, explanation,
		                              settings, status, created_by)
		SELECT $1, $2, $3, l.id, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'draft', $14
		FROM levels l WHERE l.code = upper($15)
		RETURNING id`,
		*in.Slug, kind, *in.Skill, intOr(in.Difficulty, 5), strOr(in.Topic, ""), *in.ItemType,
		in.StimulusID, intOr(in.Position, 0), *in.Prompt, options, answerKey, strOr(in.Explanation, ""),
		settings, principal.UserID, *in.Level).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.Validation(map[string]any{"level": "Unknown CEFR level"}))
		return
	}
	if err != nil {
		httpx.Fail(c, translateItemError(err))
		return
	}

	m.audit.Record(c.Request.Context(), audit.Entry{
		ActorID: &principal.UserID, Action: ActionItemCreated, EntityType: "assessment_item",
		EntityID: id.String(), Metadata: map[string]any{"slug": *in.Slug, "skill": *in.Skill, "level": *in.Level},
		IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})

	d, err := m.loadQuestion(c.Request.Context(), id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.Created(c, d)
}

func (m *Module) updateQuestion(c *gin.Context) {
	principal, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid question id"))
		return
	}
	var in QuestionInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}

	current, err := m.loadQuestion(c.Request.Context(), id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	// Validate the merged item, not the patch: a key edited on its own still has to name a
	// real option in the options that are already stored.
	merged := current
	if in.ItemType != nil {
		merged.ItemType = *in.ItemType
	}
	if in.Options != nil {
		merged.Options = *in.Options
	}
	if in.AnswerKey != nil {
		merged.AnswerKey = *in.AnswerKey
	}
	if err := validateQuestion(merged.ItemType, merged.Options, merged.AnswerKey); err != nil {
		httpx.Fail(c, err)
		return
	}

	var answerKey any
	if len(merged.AnswerKey) > 0 && string(merged.AnswerKey) != "null" {
		answerKey = merged.AnswerKey
	}

	// A published item that changes bumps its version: results already recorded stay
	// reproducible because answers store the version they were marked against.
	tag, err := m.pool.Exec(c.Request.Context(), `
		UPDATE assessment_items ai SET
			slug        = COALESCE($2, ai.slug),
			kind        = COALESCE($3, ai.kind),
			skill       = COALESCE($4, ai.skill),
			level_id    = COALESCE((SELECT id FROM levels WHERE code = upper($5)), ai.level_id),
			difficulty  = COALESCE($6, ai.difficulty),
			topic       = COALESCE($7, ai.topic),
			item_type   = $8,
			stimulus_id = COALESCE($9, ai.stimulus_id),
			position    = COALESCE($10, ai.position),
			prompt      = COALESCE($11, ai.prompt),
			options     = $12,
			answer_key  = $13,
			explanation = COALESCE($14, ai.explanation),
			settings    = COALESCE($15, ai.settings),
			version     = ai.version + CASE WHEN ai.status = 'published' THEN 1 ELSE 0 END
		WHERE ai.id = $1`,
		id, in.Slug, in.Kind, in.Skill, in.Level, in.Difficulty, in.Topic, merged.ItemType,
		in.StimulusID, in.Position, in.Prompt, merged.Options, answerKey, in.Explanation, in.Settings)
	if err != nil {
		httpx.Fail(c, translateItemError(err))
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Fail(c, apperr.NotFound("Question"))
		return
	}

	m.audit.Record(c.Request.Context(), audit.Entry{
		ActorID: &principal.UserID, Action: ActionItemUpdated, EntityType: "assessment_item",
		EntityID: id.String(), Metadata: map[string]any{"slug": current.Slug, "was_published": current.Status == "published"},
		IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})

	d, err := m.loadQuestion(c.Request.Context(), id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, d)
}

func (m *Module) setQuestionStatus(c *gin.Context) {
	principal, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid question id"))
		return
	}
	var in QuestionStatusInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	if !itemStatuses[in.Status] {
		httpx.Fail(c, apperr.Validation(map[string]any{"status": "Unknown status"}))
		return
	}

	current, err := m.loadQuestion(c.Request.Context(), id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if in.Status == "published" {
		if err := publishable(current); err != nil {
			httpx.Fail(c, err)
			return
		}
	}

	if _, err := m.pool.Exec(c.Request.Context(), `
		UPDATE assessment_items
		SET status = $2,
		    published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, now()) ELSE published_at END
		WHERE id = $1`, id, in.Status); err != nil {
		httpx.Fail(c, err)
		return
	}

	m.audit.Record(c.Request.Context(), audit.Entry{
		ActorID: &principal.UserID, Action: ActionItemStatusChanged, EntityType: "assessment_item",
		EntityID: id.String(),
		Metadata: map[string]any{"slug": current.Slug, "from": current.Status, "to": in.Status},
		IP:       c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})

	d, err := m.loadQuestion(c.Request.Context(), id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, d)
}

func (m *Module) questionStats(c *gin.Context) {
	ctx := c.Request.Context()
	stats := QuestionStats{ByStatus: []QuestionBucket{}, BySkill: []QuestionBucket{}, ByLevel: []QuestionBucket{},
		ByType: []QuestionBucket{}, Coverage: []QuestionCoverage{}}

	buckets := func(sql string) ([]QuestionBucket, error) {
		rows, err := m.pool.Query(ctx, sql)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		out := []QuestionBucket{}
		for rows.Next() {
			var b QuestionBucket
			if err := rows.Scan(&b.Key, &b.Count); err != nil {
				return nil, err
			}
			out = append(out, b)
		}
		return out, rows.Err()
	}

	var err error
	if stats.ByStatus, err = buckets(`SELECT status, count(*) FROM assessment_items GROUP BY status ORDER BY status`); err != nil {
		httpx.Fail(c, err)
		return
	}
	if stats.BySkill, err = buckets(`SELECT skill, count(*) FROM assessment_items GROUP BY skill ORDER BY skill`); err != nil {
		httpx.Fail(c, err)
		return
	}
	if stats.ByLevel, err = buckets(`
		SELECT l.code, count(*) FROM assessment_items ai JOIN levels l ON l.id = ai.level_id
		GROUP BY l.code ORDER BY l.code`); err != nil {
		httpx.Fail(c, err)
		return
	}
	if stats.ByType, err = buckets(`SELECT item_type, count(*) FROM assessment_items GROUP BY item_type ORDER BY item_type`); err != nil {
		httpx.Fail(c, err)
		return
	}
	for _, b := range stats.ByStatus {
		stats.Total += b.Count
	}

	rows, err := m.pool.Query(ctx, `
		SELECT ai.skill, l.code,
		       count(*) FILTER (WHERE ai.status = 'published'),
		       count(*) FILTER (WHERE ai.status <> 'published')
		FROM assessment_items ai
		JOIN levels l ON l.id = ai.level_id
		GROUP BY ai.skill, l.code, l.rank
		ORDER BY ai.skill, l.rank`)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var cov QuestionCoverage
		if err := rows.Scan(&cov.Skill, &cov.Level, &cov.Published, &cov.Draft); err != nil {
			httpx.Fail(c, err)
			return
		}
		stats.Coverage = append(stats.Coverage, cov)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, stats)
}

// ---- helpers ---------------------------------------------------------------------------

func rawOr(v *json.RawMessage, fallback json.RawMessage) json.RawMessage {
	if v == nil {
		return fallback
	}
	return *v
}

func intOr(v *int, fallback int) int {
	if v == nil {
		return fallback
	}
	return *v
}

func strOr(v *string, fallback string) string {
	if v == nil {
		return fallback
	}
	return *v
}

// translateItemError turns the table's own guarantees into messages the console can show.
func translateItemError(err error) error {
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		switch pg.Code {
		case "23505": // unique_violation
			return apperr.Conflict("A question with this slug already exists")
		case "23503": // foreign_key_violation
			return apperr.Validation(map[string]any{"stimulus_id": "Unknown passage or audio clip"})
		case "23514": // check_violation
			return apperr.Validation(map[string]any{"item_type": "This combination of type and answer key is not allowed"})
		}
	}
	return err
}
