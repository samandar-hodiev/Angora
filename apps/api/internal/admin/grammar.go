package admin

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Grammar authoring.
//
// The learner grammar system reads grammar_topics for the catalogue and grammar_content for
// the canonical explanation. This is the writing side of both, and it respects the one rule
// the schema already enforces: a topic has at most one published explanation at a time, so
// publishing a new version retires the old one in the same transaction.

const (
	ActionGrammarUpdated       = "grammar_topic.updated"
	ActionGrammarContentSaved  = "grammar_content.saved"
	ActionGrammarStatusChanged = "grammar_topic.status_changed"
)

type GrammarTopicRow struct {
	ID            uuid.UUID `json:"id"`
	Slug          string    `json:"slug"`
	Name          string    `json:"name"`
	Description   string    `json:"description"`
	Category      *string   `json:"category"`
	CategoryName  *string   `json:"category_name"`
	Level         *string   `json:"level"`
	CEFRLevels    []string  `json:"cefr_levels"`
	Status        string    `json:"status"`
	IELTSRelevant bool      `json:"ielts_relevant"`
	EstimatedMins int       `json:"estimated_minutes"`
	/** Whether a published explanation exists, and how much practice is authored. */
	HasContent    bool    `json:"has_content"`
	ContentStatus *string `json:"content_status"`
	/** Languages with a published explanation, so the list shows what is still untranslated. */
	Languages     []string   `json:"languages"`
	QuestionCount int        `json:"question_count"`
	PublishedAt   *time.Time `json:"published_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type GrammarTopicDetail struct {
	GrammarTopicRow
	Keywords []string        `json:"keywords"`
	Body     json.RawMessage `json:"body"`
	Version  int             `json:"version"`
	Source   *string         `json:"source"`
	/** The language of the explanation in `body`. The editor opens one language at a time. */
	Language string `json:"language"`
}

type GrammarFilter struct {
	httpx.Pagination
	Search   string `form:"search" binding:"omitempty,max=120"`
	Category string `form:"category" binding:"omitempty,max=64"`
	Level    string `form:"level" binding:"omitempty,max=8"`
	Status   string `form:"status" binding:"omitempty,oneof=draft review published archived"`
}

func (m *Module) grammarTopics(c *gin.Context) {
	var f GrammarFilter
	if err := httpx.BindQuery(c, &f); err != nil {
		httpx.Fail(c, err)
		return
	}
	f.Pagination = f.Normalize()

	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT t.id, t.slug, t.name, t.description, cat.slug, cat.name, l.code, t.cefr_levels,
		       t.status, t.ielts_relevant, t.estimated_minutes,
		       EXISTS (SELECT 1 FROM grammar_content gc WHERE gc.grammar_topic_id = t.id),
		       (SELECT gc.status FROM grammar_content gc
		         WHERE gc.grammar_topic_id = t.id AND gc.language = 'en'
		         ORDER BY gc.version DESC LIMIT 1),
		       COALESCE((SELECT array_agg(DISTINCT gc.language ORDER BY gc.language)
		                 FROM grammar_content gc
		                 WHERE gc.grammar_topic_id = t.id AND gc.status = 'published'), '{}'),
		       (SELECT count(*) FROM grammar_questions q WHERE q.grammar_topic_id = t.id AND q.status = 'published'),
		       t.published_at, t.updated_at, count(*) OVER ()
		FROM grammar_topics t
		LEFT JOIN grammar_categories cat ON cat.id = t.category_id
		LEFT JOIN levels l ON l.id = t.level_id
		WHERE ($1 = '' OR t.name ILIKE '%' || $1 || '%' OR t.slug ILIKE '%' || $1 || '%')
		  AND ($2 = '' OR cat.slug = $2)
		  AND ($3 = '' OR l.code = upper($3))
		  AND ($4 = '' OR t.status = $4)
		ORDER BY cat.sort_order NULLS LAST, t.group_order, t.sort_order, t.name
		OFFSET $5 LIMIT $6`,
		f.Search, f.Category, f.Level, f.Status, f.Offset(), f.PageSize)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []GrammarTopicRow{}
	var total int64
	for rows.Next() {
		var r GrammarTopicRow
		if err := rows.Scan(&r.ID, &r.Slug, &r.Name, &r.Description, &r.Category, &r.CategoryName, &r.Level,
			&r.CEFRLevels, &r.Status, &r.IELTSRelevant, &r.EstimatedMins, &r.HasContent, &r.ContentStatus,
			&r.Languages, &r.QuestionCount, &r.PublishedAt, &r.UpdatedAt, &total); err != nil {
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

type GrammarCategoryRow struct {
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	Topics    int64  `json:"topics"`
	Published int64  `json:"published"`
	Draft     int64  `json:"draft"`
	Review    int64  `json:"review"`
}

func (m *Module) grammarCategories(c *gin.Context) {
	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT cat.slug, cat.name, count(t.id),
		       count(t.id) FILTER (WHERE t.status = 'published'),
		       count(t.id) FILTER (WHERE t.status = 'draft'),
		       count(t.id) FILTER (WHERE t.status = 'review')
		FROM grammar_categories cat
		LEFT JOIN grammar_topics t ON t.category_id = cat.id
		GROUP BY cat.id, cat.slug, cat.name, cat.sort_order
		ORDER BY cat.sort_order`)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []GrammarCategoryRow{}
	for rows.Next() {
		var r GrammarCategoryRow
		if err := rows.Scan(&r.Slug, &r.Name, &r.Topics, &r.Published, &r.Draft, &r.Review); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, list)
}

func (m *Module) grammarTopic(c *gin.Context) {
	d, err := m.loadGrammarTopic(c, c.Param("slug"), editorLanguage(c.Query("lang")))
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, d)
}

// editorLanguages are the languages a curated explanation can be authored in. English is
// the one every topic must have: it is what the AI tutor is given as context and what a
// learner falls back to when their own language has not been written yet.
var editorLanguages = map[string]bool{"en": true, "uz": true, "ru": true}

func editorLanguage(requested string) string {
	if lang := strings.ToLower(strings.TrimSpace(requested)); editorLanguages[lang] {
		return lang
	}
	return "en"
}

// loadGrammarTopic opens one topic in one language. The editor works on a single language
// at a time, so `body`, `version` and `content_status` all describe that language and
// nothing has to be disambiguated downstream.
func (m *Module) loadGrammarTopic(c *gin.Context, slug, language string) (GrammarTopicDetail, error) {
	var d GrammarTopicDetail
	d.Language = language
	err := m.pool.QueryRow(c.Request.Context(), `
		SELECT t.id, t.slug, t.name, t.description, cat.slug, cat.name, l.code, t.cefr_levels,
		       t.status, t.ielts_relevant, t.estimated_minutes,
		       gc.id IS NOT NULL, gc.status, gc.body, coalesce(gc.version, 0), gc.source,
		       COALESCE((SELECT array_agg(DISTINCT x.language ORDER BY x.language)
		                 FROM grammar_content x
		                 WHERE x.grammar_topic_id = t.id AND x.status = 'published'), '{}'),
		       (SELECT count(*) FROM grammar_questions q WHERE q.grammar_topic_id = t.id AND q.status = 'published'),
		       t.keywords, t.published_at, t.updated_at
		FROM grammar_topics t
		LEFT JOIN grammar_categories cat ON cat.id = t.category_id
		LEFT JOIN levels l ON l.id = t.level_id
		LEFT JOIN LATERAL (
			SELECT * FROM grammar_content
			WHERE grammar_topic_id = t.id AND language = $2
			ORDER BY version DESC LIMIT 1
		) gc ON true
		WHERE t.slug = $1`, slug, language).
		Scan(&d.ID, &d.Slug, &d.Name, &d.Description, &d.Category, &d.CategoryName, &d.Level, &d.CEFRLevels,
			&d.Status, &d.IELTSRelevant, &d.EstimatedMins, &d.HasContent, &d.ContentStatus, &d.Body,
			&d.Version, &d.Source, &d.Languages, &d.QuestionCount, &d.Keywords, &d.PublishedAt, &d.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, apperr.NotFound("Grammar topic")
	}
	if d.Body == nil {
		d.Body = json.RawMessage(`{}`)
	}
	return d, err
}

type GrammarTopicInput struct {
	Name          *string          `json:"name" binding:"omitempty,min=2,max=160"`
	Description   *string          `json:"description" binding:"omitempty,max=1000"`
	Level         *string          `json:"level" binding:"omitempty,max=8"`
	EstimatedMins *int             `json:"estimated_minutes" binding:"omitempty,min=1,max=120"`
	IELTSRelevant *bool            `json:"ielts_relevant"`
	Keywords      *[]string        `json:"keywords"`
	Body          *json.RawMessage `json:"body"`
	/** Which language `body` is written in. Defaults to English. */
	Language *string `json:"language" binding:"omitempty,oneof=en uz ru"`
}

type GrammarCreateInput struct {
	Slug          string   `json:"slug" binding:"required,min=2,max=120"`
	Name          string   `json:"name" binding:"required,min=2,max=160"`
	Description   string   `json:"description" binding:"omitempty,max=1000"`
	Category      string   `json:"category" binding:"required,max=64"`
	Level         string   `json:"level" binding:"required,max=8"`
	EstimatedMins int      `json:"estimated_minutes" binding:"omitempty,min=1,max=120"`
	IELTSRelevant bool     `json:"ielts_relevant"`
	Keywords      []string `json:"keywords"`
}

// createGrammarTopic adds a topic as a draft. It has no explanation yet, which is why it
// cannot be published until one is written.
func (m *Module) createGrammarTopic(c *gin.Context) {
	principal, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var in GrammarCreateInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	if in.EstimatedMins == 0 {
		in.EstimatedMins = 10
	}
	if in.Keywords == nil {
		in.Keywords = []string{}
	}

	var id uuid.UUID
	err = m.pool.QueryRow(c.Request.Context(), `
		INSERT INTO grammar_topics (slug, name, description, level_id, category_id, cefr_levels,
		                            keywords, ielts_relevant, estimated_minutes, status)
		SELECT $1, $2, $3, l.id, cat.id, ARRAY[upper($4)], $5, $6, $7, 'draft'
		FROM levels l, grammar_categories cat
		WHERE l.code = upper($4) AND cat.slug = $8
		RETURNING id`,
		in.Slug, in.Name, in.Description, in.Level, in.Keywords, in.IELTSRelevant, in.EstimatedMins, in.Category).
		Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.Validation(map[string]any{"category": "Unknown category or level"}))
		return
	}
	if err != nil {
		httpx.Fail(c, translateItemError(err))
		return
	}

	m.audit.Record(c.Request.Context(), audit.Entry{
		ActorID: &principal.UserID, Action: ActionGrammarUpdated, EntityType: "grammar_topic",
		EntityID: id.String(), Metadata: map[string]any{"slug": in.Slug, "created": true},
		IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})

	d, err := m.loadGrammarTopic(c, in.Slug, "en")
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.Created(c, d)
}

func (m *Module) updateGrammarTopic(c *gin.Context) {
	principal, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	slug := c.Param("slug")
	var in GrammarTopicInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}

	language := "en"
	if in.Language != nil {
		language = *in.Language
	}
	current, err := m.loadGrammarTopic(c, slug, language)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	ctx := c.Request.Context()
	if _, err := m.pool.Exec(ctx, `
		UPDATE grammar_topics t SET
			name              = COALESCE($2, t.name),
			description       = COALESCE($3, t.description),
			level_id          = COALESCE((SELECT id FROM levels WHERE code = upper($4)), t.level_id),
			estimated_minutes = COALESCE($5, t.estimated_minutes),
			ielts_relevant    = COALESCE($6, t.ielts_relevant),
			keywords          = COALESCE($7, t.keywords)
		WHERE t.slug = $1`,
		slug, in.Name, in.Description, in.Level, in.EstimatedMins, in.IELTSRelevant, in.Keywords); err != nil {
		httpx.Fail(c, err)
		return
	}

	// The explanation is versioned separately: a new body is a new draft version rather than
	// an edit of the published one, so what learners are reading never changes underneath them.
	if in.Body != nil {
		// Versions are per language: writing the Uzbek explanation does not create a new
		// version of the English one, and the two can be edited independently.
		if _, err := m.pool.Exec(ctx, `
			INSERT INTO grammar_content (grammar_topic_id, language, body, version, status, source)
			SELECT t.id, $3, $2,
			       coalesce((SELECT max(version) FROM grammar_content
			                  WHERE grammar_topic_id = t.id AND language = $3), 0) + 1,
			       'draft', 'curated'
			FROM grammar_topics t WHERE t.slug = $1`, slug, *in.Body, language); err != nil {
			httpx.Fail(c, err)
			return
		}
		m.audit.Record(ctx, audit.Entry{
			ActorID: &principal.UserID, Action: ActionGrammarContentSaved, EntityType: "grammar_content",
			EntityID: current.ID.String(),
			Metadata: map[string]any{"slug": slug, "language": language, "version": current.Version + 1},
			IP:       c.ClientIP(), UserAgent: c.Request.UserAgent(),
		})
	}

	m.audit.Record(ctx, audit.Entry{
		ActorID: &principal.UserID, Action: ActionGrammarUpdated, EntityType: "grammar_topic",
		EntityID: current.ID.String(), Metadata: map[string]any{"slug": slug},
		IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})

	d, err := m.loadGrammarTopic(c, slug, language)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, d)
}

// setGrammarStatus publishes or withdraws a topic, together with its latest explanation.
//
// The two move as one: a published topic with a draft explanation would show learners a
// catalogue entry that opens onto nothing.
func (m *Module) setGrammarStatus(c *gin.Context) {
	principal, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	slug := c.Param("slug")
	var in ContentStatusInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}

	current, err := m.loadGrammarTopic(c, slug, "en")
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	// English is required, not merely "some language": it is what the AI tutor is given as
	// context and what every learner falls back to, so a topic published in Uzbek alone
	// would be unreadable for everyone else.
	if in.Status == "published" && !current.HasContent {
		httpx.Fail(c, apperr.Conflict("Write the English explanation before publishing this topic"))
		return
	}

	ctx := c.Request.Context()
	tx, err := m.pool.Begin(ctx)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
		UPDATE grammar_topics
		SET status = $2,
		    published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, now()) ELSE published_at END
		WHERE slug = $1`, slug, in.Status); err != nil {
		httpx.Fail(c, err)
		return
	}

	if in.Status == "published" {
		// One published explanation per topic per language: retire the old ones, then
		// publish the newest of each language that has been written. Publishing the topic
		// therefore ships every translation that is ready, and never blocks on one that
		// is not.
		if _, err := tx.Exec(ctx, `
			UPDATE grammar_content SET status = 'archived'
			WHERE grammar_topic_id = $1 AND status = 'published'`, current.ID); err != nil {
			httpx.Fail(c, err)
			return
		}
		if _, err := tx.Exec(ctx, `
			UPDATE grammar_content SET status = 'published', published_at = now()
			WHERE id IN (
				SELECT DISTINCT ON (language) id FROM grammar_content
				WHERE grammar_topic_id = $1
				ORDER BY language, version DESC
			)`, current.ID); err != nil {
			httpx.Fail(c, err)
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		httpx.Fail(c, err)
		return
	}

	m.audit.Record(ctx, audit.Entry{
		ActorID: &principal.UserID, Action: ActionGrammarStatusChanged, EntityType: "grammar_topic",
		EntityID: current.ID.String(),
		Metadata: map[string]any{"slug": slug, "from": current.Status, "to": in.Status},
		IP:       c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})

	d, err := m.loadGrammarTopic(c, slug, "en")
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, d)
}
