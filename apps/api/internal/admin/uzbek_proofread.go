package admin

import (
	"context"
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/jobs"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Uzbek spelling, checked.
//
// Every Uzbek string the lexicon stores goes through ai.ProofreadUzbek: generated entries as
// they are written, and the whole library on demand from the console.

// UzbekProofreader corrects Uzbek spelling. The content author implements it.
type UzbekProofreader interface {
	ProofreadUzbek(ctx context.Context, items []ai.UzbekText) (map[string]string, error)
}

// proofreadWords corrects the Uzbek of a batch of generated entries in place. Best-effort: a
// failed check leaves the text as written rather than losing the batch.
func (m *Module) proofreadWords(ctx context.Context, words []checkedWord) {
	p, ok := m.author.(UzbekProofreader)
	if !ok {
		return
	}
	var items []ai.UzbekText
	for i, w := range words {
		for _, field := range []string{"uz", "def_uz"} {
			if t := w.Translations[field]; t != "" {
				items = append(items, ai.UzbekText{Key: fmt.Sprintf("%d:%s", i, field), Text: t})
			}
		}
	}
	fixed, err := p.ProofreadUzbek(ctx, items)
	if err != nil {
		return
	}
	for i := range words {
		for _, field := range []string{"uz", "def_uz"} {
			if t, ok := fixed[fmt.Sprintf("%d:%s", i, field)]; ok {
				words[i].Translations[field] = t
			}
		}
	}
}

// proofreadVerbs corrects the Uzbek of suggested irregular verbs in place.
func (m *Module) proofreadVerbs(ctx context.Context, verbs []ai.IrregularVerbDraft) {
	p, ok := m.author.(UzbekProofreader)
	if !ok {
		return
	}
	var items []ai.UzbekText
	for i, v := range verbs {
		if v.Uz != "" {
			items = append(items, ai.UzbekText{Key: fmt.Sprintf("%d:uz", i), Text: v.Uz})
		}
		if v.Note != "" {
			items = append(items, ai.UzbekText{Key: fmt.Sprintf("%d:note", i), Text: v.Note})
		}
	}
	fixed, err := p.ProofreadUzbek(ctx, items)
	if err != nil {
		return
	}
	for i := range verbs {
		if t, ok := fixed[fmt.Sprintf("%d:uz", i)]; ok {
			verbs[i].Uz = t
		}
		if t, ok := fixed[fmt.Sprintf("%d:note", i)]; ok {
			verbs[i].Note = t
		}
	}
}

// Correction is one Uzbek string the proofreader changed.
type Correction struct {
	Where  string `json:"where"`
	Before string `json:"before"`
	After  string `json:"after"`
}

// proofreadBatch is how many strings one proofreading call checks.
const proofreadBatch = 40

// JobLexiconProofread is the job type a library-wide proofreading runs as: a few hundred
// strings in batches is minutes, not a request.
const JobLexiconProofread = "lexicon.proofread"

// POST /admin/lexicon/proofread — queue a check of the Uzbek of every entry and irregular
// verb. The job stores the corrections and reports what changed (GET /jobs/:id).
func (m *Module) proofreadLexicon(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if _, ok := m.author.(UzbekProofreader); !ok {
		httpx.Fail(c, apperr.New(apperr.CodeUnavailable, "AI is not configured"))
		return
	}
	if m.jobs == nil {
		result, err := m.runProofread(c.Request.Context())
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		httpx.OK(c, result)
		return
	}
	job, err := jobs.New(JobLexiconProofread, &p.UserID, map[string]any{})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	job.MaxAttempts = 1
	if err := m.jobs.Enqueue(c.Request.Context(), job); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.Accepted(c, map[string]any{"job_id": job.ID})
}

// HandleProofreadJob is the worker side of a library-wide proofreading.
func (m *Module) HandleProofreadJob(ctx context.Context, _ *jobs.Job) (map[string]any, error) {
	result, err := m.runProofread(ctx)
	if err != nil {
		return nil, jobs.Permanent("proofread_failed", err)
	}
	return result, nil
}

// runProofread checks the Uzbek of every entry and irregular verb and stores the corrections.
func (m *Module) runProofread(ctx context.Context) (map[string]any, error) {
	p, ok := m.author.(UzbekProofreader)
	if !ok {
		return nil, apperr.New(apperr.CodeUnavailable, "AI is not configured")
	}
	type target struct {
		table, id, field, label, text string
	}
	var targets []target
	read := func(table, sql string) error {
		rows, err := m.pool.Query(ctx, sql)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			t := target{table: table}
			if err := rows.Scan(&t.id, &t.label, &t.field, &t.text); err != nil {
				return err
			}
			targets = append(targets, t)
		}
		return rows.Err()
	}
	if err := read("vocabulary", `
		SELECT v.id::text, v.term, f.key, f.value
		FROM vocabulary v, jsonb_each_text(v.translations) f
		WHERE v.status <> 'archived' AND f.key IN ('uz', 'def_uz') AND f.value <> ''`); err != nil {
		return nil, err
	}
	if err := read("irregular_verbs", `
		SELECT id::text, base, 'uz', uz FROM irregular_verbs WHERE status <> 'archived' AND uz <> ''
		UNION ALL
		SELECT id::text, base, 'note', note FROM irregular_verbs WHERE status <> 'archived' AND note <> ''`); err != nil {
		return nil, err
	}

	out := []Correction{}
	unchecked := 0
	for start := 0; start < len(targets); start += proofreadBatch {
		batch := targets[start:min(start+proofreadBatch, len(targets))]
		items := make([]ai.UzbekText, len(batch))
		for i, t := range batch {
			items[i] = ai.UzbekText{Key: fmt.Sprint(i), Text: t.text}
		}
		fixed, err := p.ProofreadUzbek(ctx, items)
		if err != nil {
			unchecked += len(batch)
			continue
		}
		for i, t := range batch {
			after, ok := fixed[fmt.Sprint(i)]
			if !ok {
				continue
			}
			id, _ := uuid.Parse(t.id)
			var err error
			switch {
			case t.table == "vocabulary":
				_, err = m.pool.Exec(ctx, `UPDATE vocabulary SET translations = jsonb_set(translations, ARRAY[$2::text], to_jsonb($3::text)) WHERE id = $1`, id, t.field, after)
			case t.field == "uz":
				_, err = m.pool.Exec(ctx, `UPDATE irregular_verbs SET uz = $2 WHERE id = $1`, id, after)
			default:
				_, err = m.pool.Exec(ctx, `UPDATE irregular_verbs SET note = $2 WHERE id = $1`, id, after)
			}
			if err != nil {
				return nil, err
			}
			out = append(out, Correction{Where: t.label + " · " + t.field, Before: t.text, After: after})
		}
	}
	return map[string]any{"checked": len(targets), "corrected": out, "unchecked": unchecked}, nil
}
