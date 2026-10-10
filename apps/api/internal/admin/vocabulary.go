package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
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

// VocabularyWriter writes a batch of entries. The content author implements it.
type VocabularyWriter interface {
	WriteVocabulary(ctx context.Context, req ai.VocabularyRequest) ([]ai.GeneratedWord, *ai.EvaluationMeta, error)
}

// LevelChecker gives a second, independent opinion on entries' levels. The content author
// implements it; without one, levels the word list does not know stay unverified.
type LevelChecker interface {
	CheckLevels(ctx context.Context, items []ai.LevelCheckItem) (map[string]string, error)
}

// LexiconReviewer is the second pair of eyes on generated entries: is each one really of the
// kind it was written as, fit to teach, and right in meaning and spelling in every language.
// The content author implements it.
type LexiconReviewer interface {
	ReviewLexicon(ctx context.Context, kind string, items []ai.LexiconReviewItem) (map[string]ai.LexiconReview, error)
}

// Word is one vocabulary entry as the console lists and edits it.
type Word struct {
	ID               uuid.UUID         `json:"id"`
	Term             string            `json:"term"`
	Kind             string            `json:"kind"`
	PartOfSpeech     string            `json:"part_of_speech"`
	Definition       string            `json:"definition"`
	Examples         []string          `json:"examples"`
	PronunciationIPA string            `json:"pronunciation_ipa"`
	Level            *string           `json:"level"`
	Tags             []string          `json:"tags"`
	Translations     map[string]string `json:"translations"`
	/** The word explained per CEFR level: {"A1": {"definition", "examples"}, …}. */
	LevelContent map[string]ai.LevelText `json:"level_content"`
	Senses       []ai.Sense              `json:"senses"`
	Register     string                  `json:"register"`
	/** list | ai_checked | ai | curated: where the level came from; ai is unverified. */
	LevelSource string `json:"level_source"`
	Status      string `json:"status"`
	Source      string `json:"source"`
	/** How many learners have it in their deck. */
	Learners  int       `json:"learners"`
	UpdatedAt time.Time `json:"updated_at"`
}

// VocabularySummary is the library at a glance: how much there is, and how much waits.
type VocabularySummary struct {
	/** Entries whose level nobody has confirmed yet. */
	Unverified int            `json:"unverified"`
	Total      int            `json:"total"`
	Draft      int            `json:"draft"`
	Published  int            `json:"published"`
	ByLevel    map[string]int `json:"by_level"`
	/** Drafts per level, so each level's section can say what waits in it. */
	DraftsByLevel map[string]int `json:"drafts_by_level"`
}

type vocabularyPage struct {
	Items   []Word            `json:"items"`
	Summary VocabularySummary `json:"summary"`
}

const wordColumns = `
	v.id, v.term, v.part_of_speech, v.definition, v.examples, v.pronunciation_ipa, l.code, v.tags,
	v.translations, v.level_content, v.status, v.source, v.kind, v.senses, v.register, v.level_source,
	(SELECT count(*) FROM user_vocabulary uv WHERE uv.vocabulary_id = v.id)::int, v.updated_at`

func scanWord(row pgx.Row) (Word, error) {
	var w Word
	var examples, translations, content, senses []byte
	if err := row.Scan(&w.ID, &w.Term, &w.PartOfSpeech, &w.Definition, &examples, &w.PronunciationIPA, &w.Level,
		&w.Tags, &translations, &content, &w.Status, &w.Source, &w.Kind, &senses, &w.Register, &w.LevelSource,
		&w.Learners, &w.UpdatedAt); err != nil {
		return w, err
	}
	_ = json.Unmarshal(senses, &w.Senses)
	if w.Senses == nil {
		w.Senses = []ai.Sense{}
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
	Kind   string `form:"kind" binding:"omitempty,oneof=word phrase collocation"`
	Topic  string `form:"topic" binding:"omitempty,max=40"`
	/** formal | informal | neutral …; or "unverified" in Check for entries whose level waits. */
	Register string `form:"register" binding:"omitempty,max=20"`
	Check    string `form:"check" binding:"omitempty,oneof=unverified"`
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
	            AND (CASE WHEN $3 = '' THEN v.status <> 'archived' ELSE v.status = $3 END)
	            AND ($4 = '' OR v.kind = $4)
	            AND ($5 = '' OR EXISTS (SELECT 1 FROM unnest(v.tags) t WHERE lower(t) = lower($5)))
	            AND ($6 = '' OR v.register = $6)
	            AND ($7 = '' OR v.level_source = 'ai')`
	args := []any{q.Search, q.Level, q.Status, q.Kind, q.Topic, q.Register, q.Check}
	var total int64
	if err := m.pool.QueryRow(ctx, `SELECT count(*) FROM vocabulary v LEFT JOIN levels l ON l.id = v.level_id `+where,
		args...).Scan(&total); err != nil {
		httpx.Fail(c, err)
		return
	}
	rows, err := m.pool.Query(ctx, `SELECT `+wordColumns+` FROM vocabulary v LEFT JOIN levels l ON l.id = v.level_id `+where+`
		ORDER BY (v.status = 'draft') DESC, l.rank NULLS LAST, lower(v.term)
		OFFSET $8 LIMIT $9`, append(args, q.Offset(), q.PageSize)...)
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
	if out.Summary, err = m.vocabularySummary(ctx, q.Kind); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OKWithMeta(c, out, httpx.Meta{Page: q.Page, PageSize: q.PageSize, Total: total})
}

// vocabularySummary counts the library, or one kind of entry in it.
func (m *Module) vocabularySummary(ctx context.Context, kind string) (VocabularySummary, error) {
	s := VocabularySummary{ByLevel: map[string]int{}, DraftsByLevel: map[string]int{}}
	if err := m.pool.QueryRow(ctx, `
		SELECT count(*)::int, count(*) FILTER (WHERE status = 'published')::int,
		       count(*) FILTER (WHERE level_source = 'ai')::int
		FROM vocabulary WHERE status <> 'archived' AND ($1 = '' OR kind = $1)`, kind).Scan(&s.Total, &s.Published, &s.Unverified); err != nil {
		return s, err
	}
	s.Draft = s.Total - s.Published
	// A word counts under its own level — how hard the word itself is — once. Counting it under
	// every level it is explained for put one run of 100 words in all six levels, as if 600
	// had been written.
	rows, err := m.pool.Query(ctx, `
		SELECT l.code, v.status, count(*)::int
		FROM vocabulary v JOIN levels l ON l.id = v.level_id
		WHERE v.status <> 'archived' AND ($1 = '' OR v.kind = $1) GROUP BY 1, 2`, kind)
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
	Register         string                  `json:"register" binding:"omitempty,max=20"`
	Senses           []ai.Sense              `json:"senses" binding:"omitempty,max=4"`
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
		Translations: map[string]string{}, LevelContent: content, Senses: in.Senses,
		Usage: ai.WordUsage{Register: in.Register},
	}
	for _, lang := range []string{"uz", "ru", "ru_pron", "def_uz", "def_ru"} {
		if t := strings.TrimSpace(in.Translations[lang]); t != "" {
			if lang == "uz" || lang == "def_uz" {
				t = ai.NormalizeUzbek(t)
			}
			w.Translations[lang] = t
		}
	}
	if kind := ai.KindOf(w.PartOfSpeech); !ai.FitsKind(w.Term, kind) {
		msg := "a " + kind + " has at least two words — a single word belongs in Vocabulary"
		if kind == ai.KindWord {
			msg = "Vocabulary holds single words — a combination belongs in Phrases or Collocations"
		}
		return w, apperr.Validation(map[string]any{"fields": map[string]any{"term": msg}})
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
	senses, _ := json.Marshal(w.Senses)
	ctx := c.Request.Context()
	var id uuid.UUID
	err = m.pool.QueryRow(ctx, `
		INSERT INTO vocabulary (term, part_of_speech, definition, examples, pronunciation_ipa, level_id, tags,
		                        translations, level_content, status, source, created_by, kind, senses, register, level_source)
		VALUES ($1, $2, $3, $4, $5, (SELECT id FROM levels WHERE code = $6), $7, $8, $9, 'draft', 'curated', $10,
		        $11, $12, $13, 'curated')
		RETURNING id`, w.Term, w.PartOfSpeech, w.Definition, examples, w.PronunciationIPA, w.Level,
		orEmptyStrings(w.Tags), translations, content, p.UserID, w.Kind, senses, w.Usage.Register).Scan(&id)
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
	// Senses and register are kept when the editor did not send them.
	var senses []byte
	if in.Senses != nil {
		senses, _ = json.Marshal(w.Senses)
	}
	// Saving is the owner's word on the level: from here it is curated, not the model's guess.
	tag, err := m.pool.Exec(c.Request.Context(), `
		UPDATE vocabulary SET term = $2, part_of_speech = $3, definition = $4, examples = $5, pronunciation_ipa = $6,
		       level_id = (SELECT id FROM levels WHERE code = $7), tags = $8,
		       -- Merged, not replaced: the form does not carry the Uzbek and Russian definitions.
		       translations = translations || $9, level_content = $10,
		       source = 'curated', kind = $11, senses = COALESCE($12::jsonb, senses),
		       register = COALESCE(NULLIF($13, ''), register), level_source = 'curated'
		WHERE id = $1`, id, w.Term, w.PartOfSpeech, w.Definition, examples, w.PronunciationIPA, w.Level,
		orEmptyStrings(w.Tags), translations, content, w.Kind, senses, w.Usage.Register)
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

type wordLevelInput struct {
	Level string `json:"level" binding:"required,oneof=A1 A2 B1 B2 C1 C2"`
}

// POST /admin/vocabulary/:id/level — the owner confirms or corrects an entry's level. Its one
// explanation moves with it.
func (m *Module) setWordLevel(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid word id"))
		return
	}
	var in wordLevelInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	tag, err := m.pool.Exec(c.Request.Context(), `
		UPDATE vocabulary v SET level_id = (SELECT id FROM levels WHERE code = $2), level_source = 'curated',
		       level_content = CASE
		           WHEN (SELECT count(*) FROM jsonb_object_keys(v.level_content)) = 1
		           THEN jsonb_build_object($2::text, (SELECT value FROM jsonb_each(v.level_content) LIMIT 1))
		           ELSE v.level_content END
		WHERE v.id = $1`, id, in.Level)
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
	Kind  string      `json:"kind" binding:"omitempty,oneof=word phrase collocation"`
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
		  AND ($2 = '' OR v.level_id = (SELECT id FROM levels WHERE code = $2))
		  AND ($3 = '' OR v.kind = $3)`, in.IDs, in.Level, in.Kind)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if n := tag.RowsAffected(); n > 0 {
		area := "vocabulary"
		if in.Kind != "" {
			area = lexiconArea(in.Kind)
		}
		m.recordContent(c, ActionLexiconPublished, area, "manual", "", int(n), map[string]any{"level": in.Level})
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
	// Every caller is a change — create, edit, status, level — so it is recorded here once.
	m.recordWordChange(c, lexiconArea(w.Kind), w.Term, w.Status)
	httpx.OK(c, w)
}

// ---- generation -----------------------------------------------------------------------

type vocabularyPlan struct {
	/** How many new entries, in all. */
	Count int `json:"count"`
	/** word | phrase | collocation. */
	Kind   string   `json:"kind"`
	Topics []string `json:"topics"`
	/** Optional bounds on the entries' own level. */
	MinLevel string    `json:"min_level"`
	MaxLevel string    `json:"max_level"`
	Actor    uuid.UUID `json:"actor"`
}

type generateWordsInput struct {
	/** How many new entries to write. */
	Count int    `json:"count" binding:"omitempty,min=10,max=100"`
	Kind  string `json:"kind" binding:"omitempty,oneof=word phrase collocation"`
	/** Topics from the list, or the owner's own; empty for a mix. */
	Topics   []string `json:"topics" binding:"omitempty,max=8,dive,min=2,max=40"`
	MinLevel string   `json:"min_level" binding:"omitempty,oneof=A1 A2 B1 B2 C1 C2"`
	MaxLevel string   `json:"max_level" binding:"omitempty,oneof=A1 A2 B1 B2 C1 C2"`
}

// POST /admin/vocabulary/generate — write new entries of one kind, from the topics asked for,
// as drafts, each at a level that has been checked. Never an entry already in the library.
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
	if in.Kind == "" {
		in.Kind = ai.KindWord
	}
	if in.MinLevel != "" && in.MaxLevel != "" && levelRank(in.MinLevel) > levelRank(in.MaxLevel) {
		in.MinLevel, in.MaxLevel = in.MaxLevel, in.MinLevel
	}
	topics := []string{}
	for _, t := range in.Topics {
		if t = strings.ToLower(strings.TrimSpace(t)); t != "" && !slices.Contains(topics, t) {
			topics = append(topics, t)
		}
	}
	plan := vocabularyPlan{Count: in.Count, Kind: in.Kind, Topics: topics, MinLevel: in.MinLevel, MaxLevel: in.MaxLevel, Actor: p.UserID}
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
		m.recordContent(c, ActionLexiconGenerated, lexiconArea(plan.Kind), "ai", strings.Join(plan.Topics, ", "), plan.Count,
			map[string]any{"job_id": job.ID.String()})
		httpx.Accepted(c, map[string]any{"job_id": job.ID, "kind": plan.Kind, "topics": plan.Topics, "count": plan.Count})
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

// VocabularyTopics are the topics the console offers; an owner may type others.
var VocabularyTopics = []string{
	"nature", "animals", "plants", "weather", "environment", "work", "business", "money", "travel", "transport",
	"city", "home", "family", "people", "feelings", "personality", "food", "health", "body", "sport",
	"education", "science", "technology", "media", "art", "music", "shopping", "clothes", "society", "time",
}

func levelRank(code string) int {
	return slices.Index([]string{"A1", "A2", "B1", "B2", "C1", "C2"}, code)
}

// vocabularyWaves bounds how many rounds a run takes to reach its count: entries that come
// back already in the library, or outside the level range, are skipped, and the next round
// asks for the shortfall.
const vocabularyWaves = 8

// runVocabularyGeneration writes plan.Count new entries in batches, a few batches at a time.
// Each batch takes one of the topics in turn, so a run over several topics covers all of them.
// Every batch is told every entry already in the library and written earlier in this run, and
// the unique index catches anything that slips through. Each batch's levels are checked before
// it is stored.
func (m *Module) runVocabularyGeneration(ctx context.Context, plan vocabularyPlan) (map[string]any, error) {
	writer, ok := m.author.(VocabularyWriter)
	if !ok {
		return nil, apperr.New(apperr.CodeUnavailable, "AI content generation is not configured")
	}
	if plan.Kind == "" {
		plan.Kind = ai.KindWord
	}
	exclude, err := m.existingTerms(ctx)
	if err != nil {
		return nil, err
	}
	target := min(max(plan.Count, 1), 100)
	actor := plan.Actor
	added, skipped, outOfRange, failedBatches, batchIndex, rejected := 0, 0, 0, 0, 0, 0
	verified := map[string]int{}

	// Entries are saved the moment their batch comes back, not when the whole run ends, so the
	// console can show the count climbing while the rest are still being written.
	var mu sync.Mutex
	seen := map[string]string{} // spelling key → the term as written
	for _, t := range exclude {
		seen[ai.SpellingKey(t)] = t
	}
	store := func(words []checkedWord, requestID *uuid.UUID) error {
		mu.Lock()
		defer mu.Unlock()
		for _, w := range words {
			if added >= target {
				return nil
			}
			key := ai.SpellingKey(w.Term)
			if seen[key] != "" {
				skipped++
				continue
			}
			if !inRange(w.Level, plan.MinLevel, plan.MaxLevel) {
				outOfRange++
				continue
			}
			stored, err := m.storeGeneratedWord(ctx, w.GeneratedWord, w.source, requestID, actor)
			if err != nil {
				return err
			}
			seen[key] = strings.ToLower(w.Term)
			if stored {
				added++
				verified[w.source]++
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
		for _, t := range seen {
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
			// A couple over what is still needed: an entry can come back already in the library or
			// outside the level range, and is then dropped; the target cuts off any surplus.
			count := min(ai.VocabularyBatch, want-i*ai.VocabularyBatch) + 2
			var topics []string
			switch {
			case len(plan.Topics) > 0:
				topics = []string{plan.Topics[(batchIndex+i)%len(plan.Topics)]}
			default:
				topics = []string{VocabularyTopics[(batchIndex+i*7)%len(VocabularyTopics)]}
			}
			wg.Add(1)
			go func(count int, topics []string) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()
				words, meta, err := writer.WriteVocabulary(ctx, ai.VocabularyRequest{
					Count: count, Kind: plan.Kind, Topics: topics, MinLevel: plan.MinLevel, MaxLevel: plan.MaxLevel,
					Exclude: known, ActorID: &actor,
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
				checked := m.checkLevels(ctx, words)
				checked, dropped, err := m.reviewWords(ctx, plan.Kind, checked)
				mu.Lock()
				rejected += dropped
				mu.Unlock()
				if err != nil {
					mu.Lock()
					failedBatches++
					mu.Unlock()
					return
				}
				m.proofreadWords(ctx, checked)
				if err := store(checked, requestID); err != nil {
					mu.Lock()
					storeErr = err
					mu.Unlock()
				}
			}(count, topics)
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
	return map[string]any{
		"added": added, "requested": target, "skipped_duplicates": skipped, "out_of_range": outOfRange, "rejected": rejected,
		"failed_batches": failedBatches, "level_sources": verified,
	}, nil
}

func inRange(level, lo, hi string) bool {
	r := levelRank(level)
	return (lo == "" || r >= levelRank(lo)) && (hi == "" || r <= levelRank(hi))
}

// checkedWord is a generated entry with where its level now comes from.
type checkedWord struct {
	ai.GeneratedWord
	source string
}

// checkLevels settles each entry's level. A level in the CEFR word list wins outright. Any other
// is asked again of a second, independent check that does not see the first answer: when the
// two agree the level counts as checked; when they disagree the checker's — stricter — level
// is kept and the entry is marked unverified, for the owner to look at.
func (m *Module) checkLevels(ctx context.Context, words []ai.GeneratedWord) []checkedWord {
	out := make([]checkedWord, len(words))
	terms := make([]string, len(words))
	for i, w := range words {
		out[i] = checkedWord{GeneratedWord: w, source: "ai"}
		terms[i] = strings.ToLower(w.Term)
	}
	listed, err := m.listedLevels(ctx, terms)
	if err != nil {
		listed = map[string]map[string]string{}
	}
	var unlisted []ai.LevelCheckItem
	for i := range out {
		byPOS := listed[terms[i]]
		level := byPOS[out[i].PartOfSpeech]
		if level == "" && len(byPOS) == 1 {
			for _, l := range byPOS {
				level = l
			}
		}
		if level != "" {
			setLevel(&out[i].GeneratedWord, level)
			out[i].source = "list"
			continue
		}
		unlisted = append(unlisted, ai.LevelCheckItem{Term: out[i].Term, PartOfSpeech: out[i].PartOfSpeech, Definition: out[i].Definition})
	}
	checker, ok := m.author.(LevelChecker)
	if !ok || len(unlisted) == 0 {
		return out
	}
	checked, err := checker.CheckLevels(ctx, unlisted)
	if err != nil {
		return out
	}
	for i := range out {
		if out[i].source == "list" {
			continue
		}
		second := checked[terms[i]]
		if levelRank(second) < 0 {
			continue
		}
		if second == out[i].Level {
			out[i].source = "ai_checked"
		} else {
			setLevel(&out[i].GeneratedWord, second)
		}
	}
	return out
}

// reviewWords puts a batch past the lexicon reviewer and keeps only what it keeps, with its
// corrections applied: the definition, the Uzbek and Russian translations and definitions. An
// entry the reviewer rejects or does not answer for is dropped — a wrong translation taught as
// right is worse than one entry fewer — and if the review cannot be had at all, the whole
// batch is dropped for the same reason. Returns the kept entries and how many were dropped.
func (m *Module) reviewWords(ctx context.Context, kind string, words []checkedWord) ([]checkedWord, int, error) {
	reviewer, ok := m.author.(LexiconReviewer)
	if !ok || len(words) == 0 {
		return words, 0, nil
	}
	items := make([]ai.LexiconReviewItem, len(words))
	for i, w := range words {
		items[i] = reviewItem(w)
	}
	verdicts, err := reviewer.ReviewLexicon(ctx, kind, items)
	if err != nil {
		return nil, len(words), err
	}
	kept := make([]checkedWord, 0, len(words))
	for _, w := range words {
		r, ok := verdicts[strings.ToLower(w.Term)]
		if !ok || !r.Keep || !ai.FitsKind(w.Term, kind) {
			continue
		}
		kept = append(kept, applyReview(w, r))
	}
	return kept, len(words) - len(kept), nil
}

// reviewItem is what the reviewer reads of an entry.
func reviewItem(w checkedWord) ai.LexiconReviewItem {
	return ai.LexiconReviewItem{
		Term: w.Term, PartOfSpeech: w.PartOfSpeech, Definition: w.Definition, Examples: w.Examples,
		Uz: w.Translations["uz"], Ru: w.Translations["ru"], RuPron: w.Translations["ru_pron"],
		DefUz: w.Translations["def_uz"], DefRu: w.Translations["def_ru"],
	}
}

// applyReview puts the reviewer's corrections into an entry it kept.
func applyReview(w checkedWord, r ai.LexiconReview) checkedWord {
	w.Translations = map[string]string{"uz": r.Uz, "ru": r.Ru, "def_uz": r.DefUz, "def_ru": r.DefRu}
	if r.RuPron != "" {
		w.Translations["ru_pron"] = r.RuPron
	}
	if r.Definition != "" && r.Definition != w.Definition {
		w.Definition = r.Definition
		if text, ok := w.LevelContent[w.Level]; ok {
			text.Definition = r.Definition
			w.LevelContent[w.Level] = text
		}
	}
	return w
}

// setLevel moves an entry, and its one explanation, to another level.
func setLevel(w *ai.GeneratedWord, level string) {
	if w.Level == level {
		return
	}
	if text, ok := w.LevelContent[w.Level]; ok && len(w.LevelContent) == 1 {
		w.LevelContent = map[string]ai.LevelText{level: text}
	}
	w.Level = level
}

// listedLevels reads the CEFR word list for these terms: term → part of speech → level.
func (m *Module) listedLevels(ctx context.Context, terms []string) (map[string]map[string]string, error) {
	rows, err := m.pool.Query(ctx, `SELECT lower(headword), pos, level_code FROM cefr_wordlist WHERE lower(headword) = ANY ($1)`, terms)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]map[string]string{}
	for rows.Next() {
		var term, pos, level string
		if err := rows.Scan(&term, &pos, &level); err != nil {
			return nil, err
		}
		if out[term] == nil {
			out[term] = map[string]string{}
		}
		out[term][pos] = level
	}
	return out, rows.Err()
}

// storeGeneratedWord saves one entry as a draft. It reports false when it was already in the
// library — the same term and part of speech — and nothing was written.
func (m *Module) storeGeneratedWord(ctx context.Context, w ai.GeneratedWord, levelSource string, requestID *uuid.UUID, actor uuid.UUID) (bool, error) {
	examples, _ := json.Marshal(orEmptyStrings(w.Examples))
	translations, _ := json.Marshal(w.Translations)
	content, _ := json.Marshal(w.LevelContent)
	senses, _ := json.Marshal(w.Senses)
	if w.Senses == nil {
		senses = []byte("[]")
	}
	u := w.Usage
	kind := w.Kind
	if kind == "" {
		kind = ai.KindOf(w.PartOfSpeech)
	}
	tag, err := m.pool.Exec(ctx, `
		INSERT INTO vocabulary (term, part_of_speech, definition, examples, pronunciation_ipa, level_id, tags,
		                        translations, level_content, status, source, ai_request_id, created_by,
		                        usage_note, register, collocations, synonyms, antonyms, word_family, common_mistake,
		                        enriched_at, kind, senses, level_source)
		VALUES ($1, $2, $3, $4, $5, (SELECT id FROM levels WHERE code = $6), $7, $8, $9, 'draft', 'ai', $10, $11,
		        $12, $13, $14, $15, $16, $17, $18, CASE WHEN $19 THEN now() END, $20, $21, $22)
		ON CONFLICT (lower(term), part_of_speech) DO NOTHING`,
		w.Term, w.PartOfSpeech, w.Definition, examples, w.PronunciationIPA, w.Level,
		orEmptyStrings(w.Tags), translations, content, requestID, actor,
		u.UsageNote, u.Register, orEmptyStrings(u.Collocations), orEmptyStrings(u.Synonyms), orEmptyStrings(u.Antonyms),
		orEmptyStrings(u.WordFamily), u.CommonMistake, !u.Empty(), kind, senses, levelSource)
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

// DELETE /admin/vocabulary/:id — the entry is removed for good, with every learner's review
// history on it (ON DELETE CASCADE). There is no undo; the console asks before it calls this.
func (m *Module) deleteWord(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid word id"))
		return
	}
	tag, err := m.pool.Exec(c.Request.Context(), `DELETE FROM vocabulary WHERE id = $1`, id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Fail(c, apperr.NotFound("Word"))
		return
	}
	httpx.OK(c, gin.H{"deleted": id})
}

type wordSuggestInput struct {
	Term string `json:"term" binding:"required,max=80"`
	Kind string `json:"kind" binding:"omitempty,oneof=word phrase collocation"`
}

// WordSuggestion is the rest of an entry, filled in for an owner who typed only the term. It is
// a proposal: nothing is saved until the owner adds the word.
type WordSuggestion struct {
	Term             string                  `json:"term"`
	Kind             string                  `json:"kind"`
	PartOfSpeech     string                  `json:"part_of_speech"`
	Level            string                  `json:"level"`
	LevelSource      string                  `json:"level_source"`
	PronunciationIPA string                  `json:"pronunciation_ipa"`
	Translations     map[string]string       `json:"translations"`
	LevelContent     map[string]ai.LevelText `json:"level_content"`
	Tags             []string                `json:"tags"`
	Register         string                  `json:"register"`
	// Existing are the entries already in the library under this term. When there are any,
	// nothing else is filled in: the owner is told before writing a second copy.
	Existing []ExistingEntry `json:"existing"`
}

// ExistingEntry is an entry already in the library under a term the owner typed.
type ExistingEntry struct {
	ID           uuid.UUID `json:"id"`
	Term         string    `json:"term"`
	Kind         string    `json:"kind"`
	PartOfSpeech string    `json:"part_of_speech"`
	Level        string    `json:"level"`
	Status       string    `json:"status"`
}

// existingEntries finds what the library already holds under a term, in any part of speech.
func (m *Module) existingEntries(ctx context.Context, term string) ([]ExistingEntry, error) {
	rows, err := m.pool.Query(ctx, `
		SELECT v.id, v.term, v.kind, v.part_of_speech, COALESCE(l.code, ''), v.status
		FROM vocabulary v LEFT JOIN levels l ON l.id = v.level_id
		WHERE lower(v.term) = lower($1) ORDER BY v.created_at`, term)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ExistingEntry{}
	for rows.Next() {
		var e ExistingEntry
		if err := rows.Scan(&e.ID, &e.Term, &e.Kind, &e.PartOfSpeech, &e.Level, &e.Status); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// suggestionRefusals say why the editor would not fill in a term, in words the owner can act on.
var suggestionRefusals = map[string]string{
	"wrong_kind":    "This is not a %s — add it on the %s page.",
	"not_standard":  "This is not a standard English %s in this form — check the spelling.",
	"inappropriate": "This is not suitable for learners.",
	"cannot_fix":    "No reliable translation could be found — fill it in by hand.",
}

var kindPages = map[string]string{ai.KindWord: "Vocabulary", ai.KindPhrase: "Phrases", ai.KindCollocation: "Collocations"}

// POST /admin/vocabulary/suggest — the owner types a term; the rest of the entry comes back
// written the same way generated entries are: written, its level checked, then put past the
// lexicon reviewer, which corrects the translations and refuses a term of the wrong kind.
func (m *Module) suggestWord(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var in wordSuggestInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	if in.Kind == "" {
		in.Kind = ai.KindWord
	}
	term := strings.Join(strings.Fields(in.Term), " ")
	if !ai.FitsKind(term, in.Kind) {
		msg := "A " + in.Kind + " has at least two words — a single word belongs on the Vocabulary page."
		if in.Kind == ai.KindWord {
			msg = "Vocabulary holds single words — add a combination on the Phrases or Collocations page."
		}
		httpx.Fail(c, apperr.Validation(map[string]any{"fields": map[string]any{"term": msg}}))
		return
	}
	ctx := c.Request.Context()
	existing, err := m.existingEntries(ctx, term)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if len(existing) > 0 {
		httpx.OK(c, WordSuggestion{Term: term, Kind: in.Kind, Translations: map[string]string{}, LevelContent: map[string]ai.LevelText{},
			Tags: []string{}, Existing: existing})
		return
	}
	writer, ok := m.author.(VocabularyWriter)
	if !ok {
		httpx.Fail(c, apperr.New(apperr.CodeUnavailable, "AI content generation is not configured"))
		return
	}
	words, _, err := writer.WriteVocabulary(ctx, ai.VocabularyRequest{Count: 1, Kind: in.Kind, Term: term, ActorID: &p.UserID})
	if err != nil || len(words) == 0 {
		httpx.Fail(c, apperr.New(apperr.CodeUnavailable, "The AI could not fill this in. Please try again."))
		return
	}
	words[0].Term = term
	checked := m.checkLevels(ctx, words[:1])
	if reviewer, ok := m.author.(LexiconReviewer); ok {
		w := checked[0]
		verdicts, err := reviewer.ReviewLexicon(ctx, in.Kind, []ai.LexiconReviewItem{reviewItem(w)})
		if err != nil {
			httpx.Fail(c, apperr.New(apperr.CodeUnavailable, "The AI could not check this. Please try again."))
			return
		}
		r, ok := verdicts[strings.ToLower(w.Term)]
		if !ok {
			httpx.Fail(c, apperr.New(apperr.CodeUnavailable, "The AI could not check this. Please try again."))
			return
		}
		if !r.Keep {
			reason := r.Reason
			if r.Kind != in.Kind {
				reason = "wrong_kind"
			}
			msg := suggestionRefusals[reason]
			if msg == "" {
				msg = suggestionRefusals["cannot_fix"]
			}
			if reason == "wrong_kind" {
				msg = fmt.Sprintf(msg, in.Kind, kindPages[r.Kind])
				if kindPages[r.Kind] == "" {
					msg = fmt.Sprintf(suggestionRefusals["not_standard"], in.Kind)
				}
			} else if strings.Contains(msg, "%s") {
				msg = fmt.Sprintf(msg, in.Kind)
			}
			httpx.Fail(c, apperr.Validation(map[string]any{"fields": map[string]any{"term": msg}}))
			return
		}
		checked[0] = applyReview(w, r)
	}
	w := checked[0]
	httpx.OK(c, WordSuggestion{
		Term: w.Term, Kind: in.Kind, PartOfSpeech: w.PartOfSpeech, Level: w.Level, LevelSource: w.source,
		PronunciationIPA: w.PronunciationIPA, Translations: w.Translations, LevelContent: w.LevelContent,
		Tags: orEmptyStrings(w.Tags), Register: w.Usage.Register, Existing: []ExistingEntry{},
	})
}
