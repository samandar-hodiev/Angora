package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/jobs"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// The vocabulary library, as an owner manages it.
//
// Words are content like any other: written by hand or by the model, landing as drafts, and
// reaching learners when they are published. A generation writes a batch for each level asked
// for, never a word already in the library, and the owner reads the batch before publishing.

// JobVocabularyGenerate is the job type a queued vocabulary generation runs as.
const JobVocabularyGenerate = "vocabulary.generate"

// VocabularyWriter writes a level's words. The content author implements it.
type VocabularyWriter interface {
	WriteVocabulary(ctx context.Context, req ai.VocabularyRequest) ([]ai.GeneratedWord, *ai.EvaluationMeta, error)
}

// Word is one vocabulary entry as the console lists and edits it.
type Word struct {
	ID               uuid.UUID         `json:"id"`
	Term             string            `json:"term"`
	PartOfSpeech     string            `json:"part_of_speech"`
	Definition       string            `json:"definition"`
	Examples         []string          `json:"examples"`
	PronunciationIPA string            `json:"pronunciation_ipa"`
	Level            *string           `json:"level"`
	Tags             []string          `json:"tags"`
	Translations     map[string]string `json:"translations"`
	Status           string            `json:"status"`
	Source           string            `json:"source"`
	/** How many learners have it in their deck. */
	Learners  int       `json:"learners"`
	UpdatedAt time.Time `json:"updated_at"`
}

// VocabularySummary is the library at a glance: how much there is, and how much waits.
type VocabularySummary struct {
	Total     int            `json:"total"`
	Draft     int            `json:"draft"`
	Published int            `json:"published"`
	ByLevel   map[string]int `json:"by_level"`
}

type vocabularyPage struct {
	Items   []Word            `json:"items"`
	Summary VocabularySummary `json:"summary"`
}

const wordColumns = `
	v.id, v.term, v.part_of_speech, v.definition, v.examples, v.pronunciation_ipa, l.code, v.tags,
	v.translations, v.status, v.source,
	(SELECT count(*) FROM user_vocabulary uv WHERE uv.vocabulary_id = v.id)::int, v.updated_at`

func scanWord(row pgx.Row) (Word, error) {
	var w Word
	var examples, translations []byte
	if err := row.Scan(&w.ID, &w.Term, &w.PartOfSpeech, &w.Definition, &examples, &w.PronunciationIPA, &w.Level,
		&w.Tags, &translations, &w.Status, &w.Source, &w.Learners, &w.UpdatedAt); err != nil {
		return w, err
	}
	_ = json.Unmarshal(examples, &w.Examples)
	_ = json.Unmarshal(translations, &w.Translations)
	if w.Examples == nil {
		w.Examples = []string{}
	}
	if w.Tags == nil {
		w.Tags = []string{}
	}
	if w.Translations == nil {
		w.Translations = map[string]string{}
	}
	return w, nil
}

type vocabularyQuery struct {
	Search string `form:"q" binding:"omitempty,max=100"`
	Level  string `form:"level" binding:"omitempty,oneof=A1 A2 B1 B2 C1 C2"`
	Status string `form:"status" binding:"omitempty,oneof=draft published archived"`
	httpx.Pagination
}

// GET /admin/vocabulary
func (m *Module) vocabularyList(c *gin.Context) {
	var q vocabularyQuery
	if err := httpx.BindQuery(c, &q); err != nil {
		httpx.Fail(c, err)
		return
	}
	q.Pagination = q.Pagination.Normalize()
	ctx := c.Request.Context()

	where := `WHERE ($1 = '' OR v.term ILIKE '%' || $1 || '%' OR v.definition ILIKE '%' || $1 || '%')
	            AND ($2 = '' OR l.code = $2)
	            AND (CASE WHEN $3 = '' THEN v.status <> 'archived' ELSE v.status = $3 END)`
	var total int64
	if err := m.pool.QueryRow(ctx, `SELECT count(*) FROM vocabulary v LEFT JOIN levels l ON l.id = v.level_id `+where,
		q.Search, q.Level, q.Status).Scan(&total); err != nil {
		httpx.Fail(c, err)
		return
	}
	rows, err := m.pool.Query(ctx, `SELECT `+wordColumns+` FROM vocabulary v LEFT JOIN levels l ON l.id = v.level_id `+where+`
		ORDER BY (v.status = 'draft') DESC, l.rank NULLS LAST, lower(v.term)
		OFFSET $4 LIMIT $5`, q.Search, q.Level, q.Status, q.Offset(), q.PageSize)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()
	out := vocabularyPage{Items: []Word{}}
	for rows.Next() {
		w, err := scanWord(rows)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		out.Items = append(out.Items, w)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	if out.Summary, err = m.vocabularySummary(ctx); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OKWithMeta(c, out, httpx.Meta{Page: q.Page, PageSize: q.PageSize, Total: total})
}

func (m *Module) vocabularySummary(ctx context.Context) (VocabularySummary, error) {
	s := VocabularySummary{ByLevel: map[string]int{}}
	rows, err := m.pool.Query(ctx, `
		SELECT COALESCE(l.code, ''), v.status, count(*)::int
		FROM vocabulary v LEFT JOIN levels l ON l.id = v.level_id
		WHERE v.status <> 'archived' GROUP BY 1, 2`)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	for rows.Next() {
		var level, status string
		var n int
		if err := rows.Scan(&level, &status, &n); err != nil {
			return s, err
		}
		s.Total += n
		switch status {
		case "published":
			s.Published += n
		default:
			s.Draft += n
		}
		if level != "" {
			s.ByLevel[level] += n
		}
	}
	return s, rows.Err()
}

type wordInput struct {
	Term             string            `json:"term" binding:"required,min=1,max=80"`
	PartOfSpeech     string            `json:"part_of_speech" binding:"required,max=30"`
	Definition       string            `json:"definition" binding:"required,min=2,max=400"`
	Examples         []string          `json:"examples" binding:"omitempty,max=5,dive,max=300"`
	PronunciationIPA string            `json:"pronunciation_ipa" binding:"omitempty,max=80"`
	Level            string            `json:"level" binding:"required,oneof=A1 A2 B1 B2 C1 C2"`
	Tags             []string          `json:"tags" binding:"omitempty,max=6,dive,max=40"`
	Translations     map[string]string `json:"translations"`
}

func (in wordInput) clean() (ai.GeneratedWord, error) {
	w := ai.GeneratedWord{
		Term: in.Term, PartOfSpeech: strings.ToLower(strings.TrimSpace(in.PartOfSpeech)), Definition: in.Definition,
		Examples: in.Examples, PronunciationIPA: strings.TrimSpace(in.PronunciationIPA), Tags: in.Tags,
		Translations: map[string]string{},
	}
	for _, lang := range []string{"uz", "ru"} {
		if t := strings.TrimSpace(in.Translations[lang]); t != "" {
			w.Translations[lang] = t
		}
	}
	kept := ai.UsableWords([]ai.GeneratedWord{w}, nil)
	if len(kept) == 0 {
		return w, apperr.Validation(map[string]any{
			"fields": map[string]any{"part_of_speech": "must be one of: " + strings.Join(ai.PartsOfSpeech, ", ")},
		})
	}
	return kept[0], nil
}

func duplicateWord(err error) error {
	if err != nil && strings.Contains(err.Error(), "vocabulary_term_pos_key") {
		return apperr.Conflict("This word is already in the library with that part of speech")
	}
	return err
}

// POST /admin/vocabulary — add a word by hand, as a draft.
func (m *Module) createWord(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var in wordInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	w, err := in.clean()
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	examples, _ := json.Marshal(orEmptyStrings(w.Examples))
	translations, _ := json.Marshal(w.Translations)
	ctx := c.Request.Context()
	var id uuid.UUID
	err = m.pool.QueryRow(ctx, `
		INSERT INTO vocabulary (term, part_of_speech, definition, examples, pronunciation_ipa, level_id, tags,
		                        translations, status, source, created_by)
		VALUES ($1, $2, $3, $4, $5, (SELECT id FROM levels WHERE code = $6), $7, $8, 'draft', 'curated', $9)
		RETURNING id`, w.Term, w.PartOfSpeech, w.Definition, examples, w.PronunciationIPA, in.Level,
		orEmptyStrings(w.Tags), translations, p.UserID).Scan(&id)
	if err != nil {
		httpx.Fail(c, duplicateWord(err))
		return
	}
	m.respondWord(c, id)
}

// PATCH /admin/vocabulary/:id — edit a word. A person touched it, so it is curated now.
func (m *Module) updateWord(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid word id"))
		return
	}
	var in wordInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	w, err := in.clean()
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	examples, _ := json.Marshal(orEmptyStrings(w.Examples))
	translations, _ := json.Marshal(w.Translations)
	tag, err := m.pool.Exec(c.Request.Context(), `
		UPDATE vocabulary SET term = $2, part_of_speech = $3, definition = $4, examples = $5, pronunciation_ipa = $6,
		       level_id = (SELECT id FROM levels WHERE code = $7), tags = $8, translations = $9, source = 'curated'
		WHERE id = $1`, id, w.Term, w.PartOfSpeech, w.Definition, examples, w.PronunciationIPA, in.Level,
		orEmptyStrings(w.Tags), translations)
	if err != nil {
		httpx.Fail(c, duplicateWord(err))
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Fail(c, apperr.NotFound("Word"))
		return
	}
	m.respondWord(c, id)
}

type wordStatusInput struct {
	Status string `json:"status" binding:"required,oneof=draft published archived"`
}

// POST /admin/vocabulary/:id/status — publish, unpublish or archive one word.
func (m *Module) setWordStatus(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid word id"))
		return
	}
	var in wordStatusInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	tag, err := m.pool.Exec(c.Request.Context(), `
		UPDATE vocabulary SET status = $2,
		       published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, now()) ELSE published_at END
		WHERE id = $1`, id, in.Status)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Fail(c, apperr.NotFound("Word"))
		return
	}
	m.respondWord(c, id)
}

type publishWordsInput struct {
	/** The words to publish. Empty publishes every draft, or every draft at Level. */
	IDs   []uuid.UUID `json:"ids" binding:"omitempty,max=500"`
	Level string      `json:"level" binding:"omitempty,oneof=A1 A2 B1 B2 C1 C2"`
}

// POST /admin/vocabulary/publish — publish drafts in one go.
func (m *Module) publishWords(c *gin.Context) {
	var in publishWordsInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	tag, err := m.pool.Exec(c.Request.Context(), `
		UPDATE vocabulary v SET status = 'published', published_at = COALESCE(v.published_at, now())
		WHERE v.status IN ('draft', 'review')
		  AND ($1::uuid[] IS NULL OR cardinality($1::uuid[]) = 0 OR v.id = ANY ($1))
		  AND ($2 = '' OR v.level_id = (SELECT id FROM levels WHERE code = $2))`, in.IDs, in.Level)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, map[string]int64{"published": tag.RowsAffected()})
}

func (m *Module) respondWord(c *gin.Context, id uuid.UUID) {
	w, err := scanWord(m.pool.QueryRow(c.Request.Context(),
		`SELECT `+wordColumns+` FROM vocabulary v LEFT JOIN levels l ON l.id = v.level_id WHERE v.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.NotFound("Word"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, w)
}

// ---- generation -----------------------------------------------------------------------

type vocabularyPlan struct {
	Levels []string  `json:"levels"`
	Count  int       `json:"count"`
	Theme  string    `json:"theme"`
	Actor  uuid.UUID `json:"actor"`
}

type generateWordsInput struct {
	Levels []string `json:"levels" binding:"required,min=1,max=6,dive,oneof=A1 A2 B1 B2 C1 C2"`
	/** Words per level. */
	Count int    `json:"count" binding:"omitempty,min=5,max=50"`
	Theme string `json:"theme" binding:"omitempty,max=80"`
}

// POST /admin/vocabulary/generate — write new words for each level, as drafts.
func (m *Module) generateVocabulary(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if _, ok := m.author.(VocabularyWriter); !ok {
		httpx.Fail(c, apperr.New(apperr.CodeUnavailable, "AI content generation is not configured"))
		return
	}
	var in generateWordsInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	if in.Count == 0 {
		in.Count = 20
	}
	plan := vocabularyPlan{Levels: in.Levels, Count: in.Count, Theme: strings.TrimSpace(in.Theme), Actor: p.UserID}
	ctx := c.Request.Context()
	if m.jobs != nil {
		job, err := jobs.New(JobVocabularyGenerate, &p.UserID, plan)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		job.MaxAttempts = 1
		if err := m.jobs.Enqueue(ctx, job); err != nil {
			httpx.Fail(c, err)
			return
		}
		httpx.Accepted(c, map[string]any{"job_id": job.ID, "levels": plan.Levels, "count": plan.Count})
		return
	}
	result, err := m.runVocabularyGeneration(ctx, plan)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, result)
}

// HandleVocabularyJob is the worker side of a queued vocabulary generation.
func (m *Module) HandleVocabularyJob(ctx context.Context, job *jobs.Job) (map[string]any, error) {
	var plan vocabularyPlan
	if err := json.Unmarshal(job.Payload, &plan); err != nil {
		return nil, jobs.Permanent("bad_payload", err)
	}
	result, err := m.runVocabularyGeneration(ctx, plan)
	if err != nil {
		return nil, jobs.Permanent("generation_failed", err)
	}
	return result, nil
}

// runVocabularyGeneration writes each level's batch, a few levels at a time, and stores what
// came back as drafts. A word that is already in the library is skipped, not duplicated.
func (m *Module) runVocabularyGeneration(ctx context.Context, plan vocabularyPlan) (map[string]any, error) {
	writer, ok := m.author.(VocabularyWriter)
	if !ok {
		return nil, apperr.New(apperr.CodeUnavailable, "AI content generation is not configured")
	}
	levels, err := parseLevels(plan.Levels)
	if err != nil {
		return nil, err
	}
	exclude, err := m.existingTerms(ctx)
	if err != nil {
		return nil, err
	}

	type batch struct {
		level cefr.Level
		words []ai.GeneratedWord
		meta  *ai.EvaluationMeta
	}
	batches := make([]batch, len(levels))
	sem := make(chan struct{}, translationConcurrency)
	var wg sync.WaitGroup
	actor := plan.Actor
	for i, level := range levels {
		wg.Add(1)
		go func(i int, level cefr.Level) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			words, meta, err := writer.WriteVocabulary(ctx, ai.VocabularyRequest{
				Level: level, Count: plan.Count, Theme: plan.Theme, Exclude: exclude, ActorID: &actor,
			})
			if err == nil {
				batches[i] = batch{level, words, meta}
			} else {
				batches[i] = batch{level: level}
			}
		}(i, level)
	}
	wg.Wait()

	added := map[string]int{}
	failed := []string{}
	for _, b := range batches {
		if b.words == nil {
			failed = append(failed, b.level.BaseCode())
			continue
		}
		var requestID *uuid.UUID
		if b.meta != nil && b.meta.AIRequestID != uuid.Nil {
			requestID = &b.meta.AIRequestID
		}
		for _, w := range b.words {
			examples, _ := json.Marshal(orEmptyStrings(w.Examples))
			translations, _ := json.Marshal(w.Translations)
			tag, err := m.pool.Exec(ctx, `
				INSERT INTO vocabulary (term, part_of_speech, definition, examples, pronunciation_ipa, level_id, tags,
				                        translations, status, source, ai_request_id, created_by)
				VALUES ($1, $2, $3, $4, $5, (SELECT id FROM levels WHERE code = $6), $7, $8, 'draft', 'ai', $9, $10)
				ON CONFLICT (lower(term), part_of_speech) DO NOTHING`,
				w.Term, w.PartOfSpeech, w.Definition, examples, w.PronunciationIPA, b.level.BaseCode(),
				orEmptyStrings(w.Tags), translations, requestID, actor)
			if err != nil {
				return nil, fmt.Errorf("store word %q: %w", w.Term, err)
			}
			added[b.level.BaseCode()] += int(tag.RowsAffected())
		}
	}
	if len(failed) == len(levels) {
		return nil, apperr.New(apperr.CodeUnavailable, "AI vocabulary generation failed. Please try again.")
	}
	return map[string]any{"added": added, "failed": failed}, nil
}

// existingTerms is every word in the library, so a generation does not write one again.
// Capped: past a few thousand, the prompt would cost more than the duplicates it prevents,
// and the unique index catches the rest.
func (m *Module) existingTerms(ctx context.Context) ([]string, error) {
	rows, err := m.pool.Query(ctx, `SELECT DISTINCT lower(term) FROM vocabulary ORDER BY 1 LIMIT 2000`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
