package admin

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Irregular verbs, as the owner manages them.
//
// The table started as a curated list (163 verbs, published). The owner can add a verb by
// hand, have the AI suggest more — every suggestion checked to really be irregular and not
// already in the table — edit any of them, and publish. Learners see published verbs only.

// IrregularVerbWriter suggests irregular verbs. The content author implements it.
type IrregularVerbWriter interface {
	WriteIrregularVerbs(ctx context.Context, count int, exclude []string, minLevel, maxLevel string) ([]ai.IrregularVerbDraft, error)
}

// AdminVerb is one irregular verb as the console lists and edits it.
type AdminVerb struct {
	ID             uuid.UUID         `json:"id"`
	Base           string            `json:"base"`
	Past           string            `json:"past"`
	PastParticiple string            `json:"past_participle"`
	Pattern        string            `json:"pattern"`
	Level          string            `json:"level"`
	Uz             string            `json:"uz"`
	Ru             string            `json:"ru"`
	Note           string            `json:"note"`
	Examples       map[string]string `json:"examples"`
	Status         string            `json:"status"`
	Source         string            `json:"source"`
	/** How many learners have practised it. */
	Learners int `json:"learners"`
}

const adminVerbColumns = `v.id, v.base, v.past, v.past_participle, v.pattern, v.level_code, v.uz, v.ru, v.note, v.examples,
	v.status, v.source, (SELECT count(*) FROM user_irregular_verbs u WHERE u.verb_id = v.id)::int`

func scanAdminVerb(row pgx.Row) (AdminVerb, error) {
	var v AdminVerb
	err := row.Scan(&v.ID, &v.Base, &v.Past, &v.PastParticiple, &v.Pattern, &v.Level, &v.Uz, &v.Ru, &v.Note, &v.Examples,
		&v.Status, &v.Source, &v.Learners)
	if v.Examples == nil {
		v.Examples = map[string]string{}
	}
	return v, err
}

type adminVerbQuery struct {
	Search  string `form:"q" binding:"omitempty,max=40"`
	Level   string `form:"level" binding:"omitempty,oneof=A1 A2 B1 B2 C1 C2"`
	Pattern string `form:"pattern" binding:"omitempty,oneof=AAA ABB ABA ABC"`
	Status  string `form:"status" binding:"omitempty,oneof=draft published archived"`
}

type adminVerbPage struct {
	Items   []AdminVerb `json:"items"`
	Summary struct {
		Total     int `json:"total"`
		Draft     int `json:"draft"`
		Published int `json:"published"`
	} `json:"summary"`
}

// GET /admin/irregular-verbs
func (m *Module) irregularVerbList(c *gin.Context) {
	var q adminVerbQuery
	if err := httpx.BindQuery(c, &q); err != nil {
		httpx.Fail(c, err)
		return
	}
	ctx := c.Request.Context()
	rows, err := m.pool.Query(ctx, `SELECT `+adminVerbColumns+` FROM irregular_verbs v
		WHERE ($1 = '' OR v.base ILIKE $1 || '%' OR v.past ILIKE '%' || $1 || '%' OR v.past_participle ILIKE '%' || $1 || '%'
		       OR v.uz ILIKE '%' || $1 || '%' OR v.ru ILIKE '%' || $1 || '%')
		  AND ($2 = '' OR v.level_code = $2) AND ($3 = '' OR v.pattern = $3)
		  AND (CASE WHEN $4 = '' THEN v.status <> 'archived' ELSE v.status = $4 END)
		ORDER BY (v.status = 'draft') DESC, array_position(ARRAY['A1','A2','B1','B2','C1','C2'], v.level_code), v.base`,
		strings.TrimSpace(q.Search), q.Level, q.Pattern, q.Status)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()
	out := adminVerbPage{Items: []AdminVerb{}}
	for rows.Next() {
		v, err := scanAdminVerb(rows)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		out.Items = append(out.Items, v)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	if err := m.pool.QueryRow(ctx, `SELECT count(*)::int, count(*) FILTER (WHERE status = 'draft')::int,
		count(*) FILTER (WHERE status = 'published')::int FROM irregular_verbs WHERE status <> 'archived'`).
		Scan(&out.Summary.Total, &out.Summary.Draft, &out.Summary.Published); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, out)
}

type verbInput struct {
	Base           string            `json:"base" binding:"required,max=40"`
	Past           string            `json:"past" binding:"required,max=60"`
	PastParticiple string            `json:"past_participle" binding:"required,max=60"`
	Level          string            `json:"level" binding:"required,oneof=A1 A2 B1 B2 C1 C2"`
	Uz             string            `json:"uz" binding:"max=120"`
	Ru             string            `json:"ru" binding:"max=120"`
	Note           string            `json:"note" binding:"max=400"`
	Examples       map[string]string `json:"examples"`
}

func (in *verbInput) clean() error {
	in.Base = strings.ToLower(strings.TrimSpace(in.Base))
	in.Past = strings.Join(ai.VerbFormsOf(in.Past), " / ")
	in.PastParticiple = strings.Join(ai.VerbFormsOf(in.PastParticiple), " / ")
	in.Uz, in.Ru, in.Note = strings.TrimSpace(in.Uz), strings.TrimSpace(in.Ru), strings.TrimSpace(in.Note)
	if in.Base == "" || in.Past == "" || in.PastParticiple == "" {
		return apperr.Validation(map[string]any{"fields": map[string]any{"base": "all three forms are needed"}})
	}
	if !ai.IsIrregular(in.Base, in.Past, in.PastParticiple) {
		return apperr.Validation(map[string]any{"fields": map[string]any{
			"past": "this is a regular verb: its past forms are just -ed",
		}})
	}
	examples := map[string]string{}
	for _, k := range []string{"base", "past", "participle"} {
		if t := strings.TrimSpace(in.Examples[k]); t != "" {
			examples[k] = t
		}
	}
	in.Examples = examples
	return nil
}

func duplicateVerb(err error) error {
	if err != nil && strings.Contains(err.Error(), "irregular_verbs_base_key") {
		return apperr.Conflict("This verb is already in the table")
	}
	return err
}

// POST /admin/irregular-verbs — add a verb by hand, as a draft.
func (m *Module) createIrregularVerb(c *gin.Context) {
	var in verbInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	if err := in.clean(); err != nil {
		httpx.Fail(c, err)
		return
	}
	examples, _ := json.Marshal(in.Examples)
	var id uuid.UUID
	err := m.pool.QueryRow(c.Request.Context(), `
		INSERT INTO irregular_verbs (base, past, past_participle, pattern, level_code, uz, ru, note, examples, status, source)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', 'curated') RETURNING id`,
		in.Base, in.Past, in.PastParticiple, ai.VerbPattern(in.Base, in.Past, in.PastParticiple), in.Level,
		in.Uz, in.Ru, in.Note, examples).Scan(&id)
	if err != nil {
		httpx.Fail(c, duplicateVerb(err))
		return
	}
	m.respondVerb(c, id)
}

// PATCH /admin/irregular-verbs/:id — edit a verb. Examples left empty keep the ones it has.
func (m *Module) updateIrregularVerb(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid verb id"))
		return
	}
	var in verbInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	if err := in.clean(); err != nil {
		httpx.Fail(c, err)
		return
	}
	var examples []byte
	if len(in.Examples) > 0 {
		examples, _ = json.Marshal(in.Examples)
	}
	tag, err := m.pool.Exec(c.Request.Context(), `
		UPDATE irregular_verbs SET base = $2, past = $3, past_participle = $4, pattern = $5, level_code = $6,
		       uz = $7, ru = $8, note = $9, examples = COALESCE($10::jsonb, examples), source = 'curated'
		WHERE id = $1`, id, in.Base, in.Past, in.PastParticiple, ai.VerbPattern(in.Base, in.Past, in.PastParticiple),
		in.Level, in.Uz, in.Ru, in.Note, examples)
	if err != nil {
		httpx.Fail(c, duplicateVerb(err))
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Fail(c, apperr.NotFound("Verb"))
		return
	}
	m.respondVerb(c, id)
}

// POST /admin/irregular-verbs/:id/status
func (m *Module) setIrregularVerbStatus(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid verb id"))
		return
	}
	var in wordStatusInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	tag, err := m.pool.Exec(c.Request.Context(), `UPDATE irregular_verbs SET status = $2 WHERE id = $1`, id, in.Status)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Fail(c, apperr.NotFound("Verb"))
		return
	}
	m.respondVerb(c, id)
}

type publishVerbsInput struct {
	IDs []uuid.UUID `json:"ids" binding:"omitempty,max=500"`
}

// POST /admin/irregular-verbs/publish — publish drafts: the ones given, or every draft.
func (m *Module) publishIrregularVerbs(c *gin.Context) {
	var in publishVerbsInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	tag, err := m.pool.Exec(c.Request.Context(), `
		UPDATE irregular_verbs SET status = 'published'
		WHERE status = 'draft' AND ($1::uuid[] IS NULL OR cardinality($1::uuid[]) = 0 OR id = ANY ($1))`, in.IDs)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, map[string]int64{"published": tag.RowsAffected()})
}

type generateVerbsInput struct {
	Count    int    `json:"count" binding:"omitempty,min=5,max=40"`
	MinLevel string `json:"min_level" binding:"omitempty,oneof=A1 A2 B1 B2 C1 C2"`
	MaxLevel string `json:"max_level" binding:"omitempty,oneof=A1 A2 B1 B2 C1 C2"`
}

// POST /admin/irregular-verbs/generate — the AI suggests verbs not yet in the table; each is
// checked to be irregular and stored as a draft. Small enough to run inside the request.
func (m *Module) generateIrregularVerbs(c *gin.Context) {
	writer, ok := m.author.(IrregularVerbWriter)
	if !ok {
		httpx.Fail(c, apperr.New(apperr.CodeUnavailable, "AI content generation is not configured"))
		return
	}
	var in generateVerbsInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	if in.Count == 0 {
		in.Count = 15
	}
	ctx := c.Request.Context()
	var existing []string
	if err := m.pool.QueryRow(ctx, `SELECT COALESCE(array_agg(base ORDER BY base), '{}') FROM irregular_verbs`).Scan(&existing); err != nil {
		httpx.Fail(c, err)
		return
	}
	drafts, err := writer.WriteIrregularVerbs(ctx, in.Count, existing, in.MinLevel, in.MaxLevel)
	if err != nil {
		httpx.Fail(c, apperr.Wrap(err, apperr.CodeUnavailable, "AI generation failed. Please try again."))
		return
	}
	added := 0
	for _, d := range drafts {
		if !inRange(d.Level, in.MinLevel, in.MaxLevel) || levelRank(d.Level) < 0 {
			continue
		}
		examples, _ := json.Marshal(d.Examples)
		tag, err := m.pool.Exec(ctx, `
			INSERT INTO irregular_verbs (base, past, past_participle, pattern, level_code, uz, ru, note, examples, status, source)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', 'ai') ON CONFLICT (base) DO NOTHING`,
			d.Base, d.Past, d.Participle, ai.VerbPattern(d.Base, d.Past, d.Participle), d.Level, d.Uz, d.Ru, d.Note, examples)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		added += int(tag.RowsAffected())
	}
	if added == 0 {
		httpx.Fail(c, apperr.New(apperr.CodeUnavailable, "No new irregular verbs came back — the table may already hold the common ones."))
		return
	}
	httpx.OK(c, map[string]int{"added": added, "requested": in.Count})
}

func (m *Module) respondVerb(c *gin.Context, id uuid.UUID) {
	v, err := scanAdminVerb(m.pool.QueryRow(c.Request.Context(), `SELECT `+adminVerbColumns+` FROM irregular_verbs v WHERE v.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.NotFound("Verb"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, v)
}
