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
	/** The word explained per CEFR level: {"A1": {"definition", "examples"}, …}. */
	LevelContent map[string]ai.LevelText `json:"level_content"`
	Status       string                  `json:"status"`
	Source       string                  `json:"source"`
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
	/** Drafts per level, so each level's section can say what waits in it. */
	DraftsByLevel map[string]int `json:"drafts_by_level"`
}

type vocabularyPage struct {
	Items   []Word            `json:"items"`
	Summary VocabularySummary `json:"summary"`
}

const wordColumns = `
	v.id, v.term, v.part_of_speech, v.definition, v.examples, v.pronunciation_ipa, l.code, v.tags,
	v.translations, v.level_content, v.status, v.source,
	(SELECT count(*) FROM user_vocabulary uv WHERE uv.vocabulary_id = v.id)::int, v.updated_at`

func scanWord(row pgx.Row) (Word, error) {
	var w Word
	var examples, translations, content []byte
	if err := row.Scan(&w.ID, &w.Term, &w.PartOfSpeech, &w.Definition, &examples, &w.PronunciationIPA, &w.Level,
		&w.Tags, &translations, &content, &w.Status, &w.Source, &w.Learners, &w.UpdatedAt); err != nil {
		return w, err
	}
	_ = json.Unmarshal(examples, &w.Examples)
	_ = json.Unmarshal(translations, &w.Translations)
	_ = json.Unmarshal(content, &w.LevelContent)
	// Words written before levels existed have one explanation, at their own level.
	if len(w.LevelContent) == 0 && w.Definition != "" {
		code := "B1"
		if w.Level != nil {
			code = *w.Level
		}
		w.LevelContent = map[string]ai.LevelText{code: {Definition: w.Definition, Examples: w.Examples}}
	}
	if w.Examples == nil {
		w.Examples = []string{}
	}
	if w.Tags == nil {
		w.Tags = []string{}
	}
	if w.Translations == nil {
		w.Translations = map[string]string{}
	}
	if w.LevelContent == nil {
		w.LevelContent = map[string]ai.LevelText{}
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
	s := VocabularySummary{ByLevel: map[string]int{}, DraftsByLevel: map[string]int{}}
	if err := m.pool.QueryRow(ctx, `
		SELECT count(*)::int, count(*) FILTER (WHERE status = 'published')::int
		FROM vocabulary WHERE status <> 'archived'`).Scan(&s.Total, &s.Published); err != nil {
		return s, err
	}
	s.Draft = s.Total - s.Published
	// A word counts under its own level — how hard the word itself is — once. Counting it under
	// every level it is explained for put one run of 100 words in all six levels, as if 600
	// had been written.
	rows, err := m.pool.Query(ctx, `
		SELECT l.code, v.status, count(*)::int
		FROM vocabulary v JOIN levels l ON l.id = v.level_id
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
		s.ByLevel[level] += n
		if status != "published" {
			s.DraftsByLevel[level] += n
		}
	}
	return s, rows.Err()
}

type wordInput struct {
	Term         string `json:"term" binding:"required,min=1,max=80"`
	PartOfSpeech string `json:"part_of_speech" binding:"required,max=30"`
	/** The explanation per level. A word needs at least one. */
	LevelContent     map[string]ai.LevelText `json:"level_content" binding:"required,min=1,max=6"`
	PronunciationIPA string                  `json:"pronunciation_ipa" binding:"omitempty,max=80"`
	Level            string                  `json:"level" binding:"required,oneof=A1 A2 B1 B2 C1 C2"`
	Tags             []string                `json:"tags" binding:"omitempty,max=6,dive,max=40"`
	Translations     map[string]string       `json:"translations"`
}

func (in wordInput) clean() (ai.GeneratedWord, error) {
	content := map[string]ai.LevelText{}
	for code, t := range in.LevelContent {
		code = strings.ToUpper(strings.TrimSpace(code))
		if _, err := cefr.Parse(code); err != nil {
			continue
		}
		if len(t.Definition) > 400 || len(t.Examples) > 5 {
			return ai.GeneratedWord{}, apperr.Validation(map[string]any{
				"fields": map[string]any{"level_content": "each level takes one definition (up to 400 characters) and up to 5 examples"},
			})
		}
		content[code] = t
	}
	w := ai.GeneratedWord{
		Term: in.Term, PartOfSpeech: strings.ToLower(strings.TrimSpace(in.PartOfSpeech)), Level: in.Level,
		PronunciationIPA: strings.TrimSpace(in.PronunciationIPA), Tags: in.Tags,
		Translations: map[string]string{}, LevelContent: content,
	}
	for _, lang := range []string{"uz", "ru", "ru_pron"} {
		if t := strings.TrimSpace(in.Translations[lang]); t != "" {
			w.Translations[lang] = t
		}
	}
	kept := ai.UsableWords([]ai.GeneratedWord{w}, nil)
	if len(kept) == 0 {
		return w, apperr.Validation(map[string]any{
			"fields": map[string]any{
				"part_of_speech": "must be one of: " + strings.Join(ai.PartsOfSpeech, ", "),
				"level_content":  "explain the word for at least one level",
			},
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
	content, _ := json.Marshal(w.LevelContent)
	ctx := c.Request.Context()
	var id uuid.UUID
	err = m.pool.QueryRow(ctx, `
		INSERT INTO vocabulary (term, part_of_speech, definition, examples, pronunciation_ipa, level_id, tags,
		                        translations, level_content, status, source, created_by)
		VALUES ($1, $2, $3, $4, $5, (SELECT id FROM levels WHERE code = $6), $7, $8, $9, 'draft', 'curated', $10)
		RETURNING id`, w.Term, w.PartOfSpeech, w.Definition, examples, w.PronunciationIPA, w.Level,
		orEmptyStrings(w.Tags), translations, content, p.UserID).Scan(&id)
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
	content, _ := json.Marshal(w.LevelContent)
	tag, err := m.pool.Exec(c.Request.Context(), `
		UPDATE vocabulary SET term = $2, part_of_speech = $3, definition = $4, examples = $5, pronunciation_ipa = $6,
		       level_id = (SELECT id FROM levels WHERE code = $7), tags = $8, translations = $9, level_content = $10,
		       source = 'curated'
		WHERE id = $1`, id, w.Term, w.PartOfSpeech, w.Definition, examples, w.PronunciationIPA, w.Level,
		orEmptyStrings(w.Tags), translations, content)
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
	/** How many new words, in all. */
	Count int `json:"count"`
	/** The levels each word is explained for. */
	Levels []string  `json:"levels"`
	Theme  string    `json:"theme"`
	Actor  uuid.UUID `json:"actor"`
}

type generateWordsInput struct {
	/** How many new words to write. Each is explained for every level in Levels. */
	Count  int      `json:"count" binding:"omitempty,min=10,max=100"`
	Levels []string `json:"levels" binding:"required,min=1,max=6,dive,oneof=A1 A2 B1 B2 C1 C2"`
	Theme  string   `json:"theme" binding:"omitempty,max=80"`
}

// POST /admin/vocabulary/generate — write new words, each explained for every level asked
// for, as drafts. Never a word already in the library.
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
	plan := vocabularyPlan{Count: in.Count, Levels: in.Levels, Theme: strings.TrimSpace(in.Theme), Actor: p.UserID}
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

// vocabularyThemes spread the batches of one run when no theme was asked for, so parallel
// batches do not all reach for the same handful of common words.
var vocabularyThemes = []string{
	"daily life and home", "work and study", "travel and places", "feelings and personality",
	"health and the body", "food and shopping", "technology and media", "nature and the environment",
	"society and people", "time, change and abstract ideas",
}

// vocabularyWaves bounds how many rounds a run takes to reach its count: words that come back
// already in the library are skipped, and the next round asks for the shortfall.
const vocabularyWaves = 8

// runVocabularyGeneration writes plan.Count new words in batches, a few batches at a time.
// Every batch is told every word already in the library and every word written earlier in
// this run, and the unique index catches anything that slips through, so no word is stored
// twice. A round that comes back short is topped up by the next.
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
	target := min(max(plan.Count, 1), 100)
	actor := plan.Actor
	added, skipped, failedBatches, batchIndex := 0, 0, 0, 0

	// Words are saved the moment their batch comes back, not when the whole run ends, so the
	// console can show the count climbing while the rest are still being written. The mutex
	// keeps the count, the skip list and the target straight across the batches.
	var mu sync.Mutex
	seen := map[string]bool{}
	for _, t := range exclude {
		seen[t] = true
	}
	store := func(words []ai.GeneratedWord, requestID *uuid.UUID) error {
		mu.Lock()
		defer mu.Unlock()
		for _, w := range words {
			if added >= target {
				return nil
			}
			key := strings.ToLower(w.Term)
			if seen[key] {
				skipped++
				continue
			}
			stored, err := m.storeGeneratedWord(ctx, w, requestID, actor)
			if err != nil {
				return err
			}
			seen[key] = true
			if stored {
				added++
			} else {
				skipped++
			}
		}
		return nil
	}

	for wave := 0; wave < vocabularyWaves; wave++ {
		mu.Lock()
		want := target - added
		known := make([]string, 0, len(seen))
		for t := range seen {
			known = append(known, t)
		}
		mu.Unlock()
		if want <= 0 {
			break
		}
		batches := (want + ai.VocabularyBatch - 1) / ai.VocabularyBatch
		sem := make(chan struct{}, translationConcurrency)
		var wg sync.WaitGroup
		var storeErr error
		for i := 0; i < batches; i++ {
			// A couple over what is still needed: a word can come back already in the library
			// or missing a level, and is then dropped; the target cuts off any surplus.
			count := min(ai.VocabularyBatch, want-i*ai.VocabularyBatch) + 2
			theme := plan.Theme
			if theme == "" {
				theme = vocabularyThemes[(batchIndex+i)%len(vocabularyThemes)]
			}
			wg.Add(1)
			go func(count int, theme string) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()
				words, meta, err := writer.WriteVocabulary(ctx, ai.VocabularyRequest{
					Count: count, Levels: levels, Theme: theme, Exclude: known, ActorID: &actor,
				})
				if err != nil {
					mu.Lock()
					failedBatches++
					mu.Unlock()
					return
				}
				var requestID *uuid.UUID
				if meta != nil && meta.AIRequestID != uuid.Nil {
					requestID = &meta.AIRequestID
				}
				if err := store(words, requestID); err != nil {
					mu.Lock()
					storeErr = err
					mu.Unlock()
				}
			}(count, theme)
		}
		wg.Wait()
		batchIndex += batches
		if storeErr != nil {
			return nil, storeErr
		}
	}
	if added == 0 {
		return nil, apperr.New(apperr.CodeUnavailable, "AI vocabulary generation failed. Please try again.")
	}
	return map[string]any{"added": added, "requested": target, "skipped_duplicates": skipped, "failed_batches": failedBatches}, nil
}

// storeGeneratedWord saves one word as a draft. It reports false when the word was already in
// the library — the same term and part of speech — and nothing was written.
func (m *Module) storeGeneratedWord(ctx context.Context, w ai.GeneratedWord, requestID *uuid.UUID, actor uuid.UUID) (bool, error) {
	examples, _ := json.Marshal(orEmptyStrings(w.Examples))
	translations, _ := json.Marshal(w.Translations)
	content, _ := json.Marshal(w.LevelContent)
	u := w.Usage
	tag, err := m.pool.Exec(ctx, `
		INSERT INTO vocabulary (term, part_of_speech, definition, examples, pronunciation_ipa, level_id, tags,
		                        translations, level_content, status, source, ai_request_id, created_by,
		                        usage_note, register, collocations, synonyms, antonyms, word_family, common_mistake,
		                        enriched_at)
		VALUES ($1, $2, $3, $4, $5, (SELECT id FROM levels WHERE code = $6), $7, $8, $9, 'draft', 'ai', $10, $11,
		        $12, $13, $14, $15, $16, $17, $18, CASE WHEN $19 THEN now() END)
		ON CONFLICT (lower(term), part_of_speech) DO NOTHING`,
		w.Term, w.PartOfSpeech, w.Definition, examples, w.PronunciationIPA, w.Level,
		orEmptyStrings(w.Tags), translations, content, requestID, actor,
		u.UsageNote, u.Register, orEmptyStrings(u.Collocations), orEmptyStrings(u.Synonyms), orEmptyStrings(u.Antonyms),
		orEmptyStrings(u.WordFamily), u.CommonMistake, !u.Empty())
	if err != nil {
		return false, fmt.Errorf("store word %q: %w", w.Term, err)
	}
	return tag.RowsAffected() > 0, nil
}

// existingTerms is every word in the library, so a generation does not write one again.
// Capped: past a few thousand, the prompt would cost more than the duplicates it prevents,
// and the unique index catches the rest.
func (m *Module) existingTerms(ctx context.Context) ([]string, error) {
	rows, err := m.pool.Query(ctx, `SELECT DISTINCT lower(term) FROM vocabulary ORDER BY 1 LIMIT 3000`)
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
