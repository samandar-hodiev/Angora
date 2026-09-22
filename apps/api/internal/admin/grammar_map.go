package admin

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// The Grammar Map: the curriculum, and how much of it has actually been written.
//
// Two things are deliberately kept apart here, because conflating them is what made the old
// grammar page misleading.
//
//	grammar_topics   the map. What English grammar consists of. It exists whether or not
//	                 anybody has written a word, and a topic with no explanation is a normal,
//	                 expected state — not an error and not something to hide.
//	grammar_content  the lesson, per language and per CEFR level, versioned. This is what a
//	                 learner reads, and only the published rows ever reach them.
//
// So the map reports two statuses for every topic: the topic's own, and its content's. A
// topic can be published as a curriculum entry and still have nothing to read, which is
// exactly the situation an owner needs to see in order to fix it.

const (
	ActionGrammarGenerated = "grammar_content.generated"
	ActionGrammarPublished = "grammar_content.published"
)

// Content states as the map reports them. Derived from the rows that exist, never stored:
// a cached status is a status that goes stale.
const (
	ContentNotCreated         = "not_created"
	ContentDraft              = "draft"
	ContentInReview           = "in_review"
	ContentPartiallyPublished = "partially_published"
	ContentPublished          = "published"
	ContentNotApplicable      = "not_applicable"
)

// allLevels is the full CEFR ladder. A topic does not have to be taught at all of them —
// the editor and the model decide that per topic — but the map offers all six so an owner
// can see which are missing rather than only which exist.
var allLevels = []string{"A1", "A2", "B1", "B2", "C1", "C2"}

type MapLevel struct {
	Level string `json:"level"`
	/** not_created | draft | review | published | archived | not_applicable */
	Status  string `json:"status"`
	Version int    `json:"version"`
	/** Why the level was marked not applicable, when it was. */
	Reason    string     `json:"reason,omitempty"`
	UpdatedAt *time.Time `json:"updated_at"`
}

type MapTopicContent struct {
	/** not_created | draft | in_review | partially_published | published */
	Status string `json:"status"`
	/** Levels with a published row, out of the levels that carry any content at all. */
	Published int `json:"published_levels"`
	Total     int `json:"total_levels"`
}

type MapTopic struct {
	ID          uuid.UUID `json:"id"`
	Slug        string    `json:"slug"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	/** The topic's own place in the curriculum, and its own publication state. */
	Level       *string  `json:"level"`
	CEFRLevels  []string `json:"cefr_levels"`
	TopicStatus string   `json:"topic_status"`
	/** Where the writing has got to, for the language being viewed. */
	Content MapTopicContent `json:"content"`
	Levels  []MapLevel      `json:"levels"`
	/** Languages with at least one published level, across all levels. */
	Languages     []string `json:"languages"`
	QuestionCount int      `json:"question_count"`
}

type MapCategory struct {
	Slug   string     `json:"slug"`
	Name   string     `json:"name"`
	Topics []MapTopic `json:"topics"`
}

type MapFilter struct {
	Language string `form:"lang" binding:"omitempty,oneof=en uz ru"`
	Search   string `form:"search" binding:"omitempty,max=120"`
	Status   string `form:"status" binding:"omitempty,oneof=not_created draft in_review partially_published published"`
	Level    string `form:"level" binding:"omitempty,max=8"`
	Category string `form:"category" binding:"omitempty,max=64"`
}

// grammarMap returns the whole curriculum, grouped by category, with each topic's writing
// state for one language.
//
// It is one query and one pass rather than a query per topic: the curriculum is 150 topics
// and six levels, and an owner opening this page should not wait for 900 round trips.
func (m *Module) grammarMap(c *gin.Context) {
	var f MapFilter
	if err := httpx.BindQuery(c, &f); err != nil {
		httpx.Fail(c, err)
		return
	}
	language := f.Language
	if language == "" {
		language = "en"
	}

	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT cat.slug, cat.name, cat.sort_order,
		       t.id, t.slug, t.name, t.description, l.code, t.cefr_levels, t.status,
		       (SELECT count(*) FROM grammar_questions q
		         WHERE q.grammar_topic_id = t.id AND q.status = 'published'),
		       COALESCE((
		           SELECT array_agg(DISTINCT x.language ORDER BY x.language)
		           FROM grammar_content x
		           WHERE x.grammar_topic_id = t.id AND x.status = 'published'
		       ), '{}'),
		       COALESCE((
		           -- The newest row per level for this language, whatever its state. The
		           -- newest is what the editor opens and what publishing acts on.
		           SELECT json_agg(json_build_object(
		                      'level', lv.level_code, 'status', lv.status,
		                      'version', lv.version, 'reason', lv.summary,
		                      'updated_at', lv.updated_at)
		                  ORDER BY lv.level_code)
		           FROM (
		               SELECT DISTINCT ON (gc.level_code)
		                      gc.level_code, gc.status, gc.version, gc.summary, gc.updated_at
		               FROM grammar_content gc
		               WHERE gc.grammar_topic_id = t.id AND gc.language = $1
		               ORDER BY gc.level_code, gc.version DESC
		           ) lv
		       ), '[]')
		FROM grammar_topics t
		LEFT JOIN grammar_categories cat ON cat.id = t.category_id
		LEFT JOIN levels l ON l.id = t.level_id
		WHERE ($2 = '' OR t.name ILIKE '%' || $2 || '%' OR t.slug ILIKE '%' || $2 || '%'
		       OR t.description ILIKE '%' || $2 || '%')
		  AND ($3 = '' OR cat.slug = $3)
		  AND ($4 = '' OR l.code = upper($4) OR upper($4) = ANY (t.cefr_levels))
		ORDER BY cat.sort_order NULLS LAST, cat.name, t.group_order, t.sort_order, t.name`,
		language, f.Search, f.Category, f.Level)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	out := []MapCategory{}
	index := map[string]int{}
	for rows.Next() {
		var (
			catSlug, catName *string
			sortOrder        *int
			topic            MapTopic
			raw              []byte
		)
		if err := rows.Scan(&catSlug, &catName, &sortOrder, &topic.ID, &topic.Slug, &topic.Name,
			&topic.Description, &topic.Level, &topic.CEFRLevels, &topic.TopicStatus,
			&topic.QuestionCount, &topic.Languages, &raw); err != nil {
			httpx.Fail(c, err)
			return
		}
		var written []MapLevel
		if err := json.Unmarshal(raw, &written); err != nil {
			httpx.Fail(c, err)
			return
		}
		topic.Levels, topic.Content = levelMatrix(written)

		if f.Status != "" && topic.Content.Status != f.Status {
			continue
		}

		slug, name := "uncategorised", "Uncategorised"
		if catSlug != nil {
			slug, name = *catSlug, *catName
		}
		position, ok := index[slug]
		if !ok {
			position = len(out)
			index[slug] = position
			out = append(out, MapCategory{Slug: slug, Name: name, Topics: []MapTopic{}})
		}
		out[position].Topics = append(out[position].Topics, topic)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}

	// A category filtered down to nothing is noise, not information.
	kept := out[:0]
	for _, category := range out {
		if len(category.Topics) > 0 {
			kept = append(kept, category)
		}
	}
	httpx.OK(c, kept)
}

// levelMatrix fills in the levels that have no row, and derives the topic's overall state.
//
// "Published" means every level that carries content is published — a topic with three
// written levels and three untouched ones is fully published, because the untouched ones
// are not promises anybody made. A level explicitly marked not applicable is a decision and
// counts as settled, not as work outstanding.
func levelMatrix(written []MapLevel) ([]MapLevel, MapTopicContent) {
	byLevel := map[string]MapLevel{}
	for _, level := range written {
		byLevel[level.Level] = level
	}

	levels := make([]MapLevel, 0, len(allLevels))
	var carrying, published, drafts, review int
	for _, code := range allLevels {
		level, ok := byLevel[code]
		if !ok {
			levels = append(levels, MapLevel{Level: code, Status: ContentNotCreated})
			continue
		}
		if level.Status != ContentNotApplicable {
			level.Reason = ""
			carrying++
		}
		switch level.Status {
		case "published":
			published++
		case "draft":
			drafts++
		case "review":
			review++
		}
		levels = append(levels, level)
	}

	content := MapTopicContent{Published: published, Total: carrying}
	switch {
	case len(byLevel) == 0:
		content.Status = ContentNotCreated
	case carrying == 0:
		// Every level was ruled out. The topic is settled, with nothing to teach.
		content.Status = ContentNotApplicable
	case published == carrying:
		content.Status = ContentPublished
	case published > 0:
		content.Status = ContentPartiallyPublished
	case review > 0:
		content.Status = ContentInReview
	default:
		content.Status = ContentDraft
	}
	return levels, content
}

// ---- one topic, opened in the builder --------------------------------------------------

type LevelContent struct {
	Level   string `json:"level"`
	Status  string `json:"status"`
	Version int    `json:"version"`
	Title   string `json:"title"`
	Summary string `json:"summary"`
	/** The structured sections the learner page renders; see internal/grammar.Content. */
	Body   json.RawMessage `json:"body"`
	Source string          `json:"source"`
	/** Practice questions authored against this level. */
	QuestionCount int        `json:"question_count"`
	PublishedAt   *time.Time `json:"published_at"`
	UpdatedAt     *time.Time `json:"updated_at"`
	/** The live version a learner is reading, when this draft is not it. */
	PublishedVersion *int `json:"published_version"`
}

type TopicContent struct {
	Topic    GrammarTopicDetail `json:"topic"`
	Language string             `json:"language"`
	/** Names of topics learners confuse this with; the model is told about them. */
	Related []string       `json:"related"`
	Levels  []LevelContent `json:"levels"`
}

func (m *Module) grammarTopicContent(c *gin.Context) {
	language := editorLanguage(c.Query("lang"))
	out, err := m.loadTopicContent(c.Request.Context(), c.Param("slug"), language)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, out)
}

func (m *Module) loadTopicContent(ctx context.Context, slug, language string) (TopicContent, error) {
	out := TopicContent{Language: language, Levels: []LevelContent{}, Related: []string{}}

	var topicID uuid.UUID
	err := m.pool.QueryRow(ctx, `
		SELECT t.id, t.slug, t.name, t.description, cat.slug, cat.name, l.code, t.cefr_levels,
		       t.status, t.ielts_relevant, t.estimated_minutes, t.keywords, t.published_at, t.updated_at,
		       COALESCE((SELECT array_agg(DISTINCT x.language ORDER BY x.language) FROM grammar_content x
		                  WHERE x.grammar_topic_id = t.id AND x.status = 'published'), '{}')
		FROM grammar_topics t
		LEFT JOIN grammar_categories cat ON cat.id = t.category_id
		LEFT JOIN levels l ON l.id = t.level_id
		WHERE t.slug = $1`, slug).
		Scan(&topicID, &out.Topic.Slug, &out.Topic.Name, &out.Topic.Description, &out.Topic.Category,
			&out.Topic.CategoryName, &out.Topic.Level, &out.Topic.CEFRLevels, &out.Topic.Status,
			&out.Topic.IELTSRelevant, &out.Topic.EstimatedMins, &out.Topic.Keywords,
			&out.Topic.PublishedAt, &out.Topic.UpdatedAt, &out.Topic.Languages)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, apperr.NotFound("Grammar topic")
	}
	if err != nil {
		return out, err
	}
	out.Topic.ID = topicID
	out.Topic.Language = language
	out.Topic.Body = json.RawMessage(`{}`)

	// What learners confuse this with, from the relations the curriculum already records.
	relations, err := m.pool.Query(ctx, `
		SELECT DISTINCT other.name
		FROM grammar_relations r
		JOIN grammar_topics other ON other.id = r.to_topic_id
		WHERE r.from_topic_id = $1 AND r.kind IN ('compare', 'commonly_confused')
		LIMIT 6`, topicID)
	if err != nil {
		return out, err
	}
	for relations.Next() {
		var name string
		if err := relations.Scan(&name); err != nil {
			relations.Close()
			return out, err
		}
		out.Related = append(out.Related, name)
	}
	relations.Close()
	if err := relations.Err(); err != nil {
		return out, err
	}

	rows, err := m.pool.Query(ctx, `
		SELECT DISTINCT ON (gc.level_code)
		       gc.level_code, gc.status, gc.version, gc.title, gc.summary, gc.body, gc.source,
		       gc.published_at, gc.updated_at,
		       (SELECT count(*) FROM grammar_questions q
		         JOIN levels ql ON ql.id = q.level_id
		         WHERE q.grammar_topic_id = $1 AND ql.code = gc.level_code),
		       (SELECT p.version FROM grammar_content p
		         WHERE p.grammar_topic_id = $1 AND p.language = $2
		           AND p.level_code = gc.level_code AND p.status = 'published')
		FROM grammar_content gc
		WHERE gc.grammar_topic_id = $1 AND gc.language = $2
		ORDER BY gc.level_code, gc.version DESC`, topicID, language)
	if err != nil {
		return out, err
	}
	defer rows.Close()

	byLevel := map[string]LevelContent{}
	for rows.Next() {
		var level LevelContent
		if err := rows.Scan(&level.Level, &level.Status, &level.Version, &level.Title, &level.Summary,
			&level.Body, &level.Source, &level.PublishedAt, &level.UpdatedAt,
			&level.QuestionCount, &level.PublishedVersion); err != nil {
			return out, err
		}
		byLevel[level.Level] = level
	}
	if err := rows.Err(); err != nil {
		return out, err
	}

	// Every level is offered, written or not: the editor's job is to see the gaps.
	for _, code := range allLevels {
		if level, ok := byLevel[code]; ok {
			out.Levels = append(out.Levels, level)
			continue
		}
		out.Levels = append(out.Levels, LevelContent{
			Level: code, Status: ContentNotCreated, Body: json.RawMessage(`{}`),
		})
	}
	return out, nil
}

func parseLevels(codes []string) ([]cefr.Level, error) {
	out := make([]cefr.Level, 0, len(codes))
	for _, code := range codes {
		level, err := cefr.Parse(strings.ToUpper(strings.TrimSpace(code)))
		if err != nil {
			return nil, apperr.Validation(map[string]any{
				"fields": map[string]any{"levels": "must be CEFR codes from A1 to C2"},
			})
		}
		out = append(out, level)
	}
	return out, nil
}

func recordGrammarAudit(ctx context.Context, recorder audit.Recorder, actor uuid.UUID, action, slug string, meta map[string]any) {
	if recorder == nil {
		return
	}
	recorder.Record(ctx, audit.Entry{
		ActorID: &actor, Action: action, EntityType: "grammar_content", EntityID: slug, Metadata: meta,
	})
}
