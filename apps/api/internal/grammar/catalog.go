package grammar

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// topicColumns is the summary projection shared by every list, search and relation query,
// so a topic looks the same wherever it appears. It expects `t` (grammar_topics),
// `c` (grammar_categories), `l` (levels) and `p` (user_grammar_progress) to be in scope.
const topicColumns = `
	t.slug, t.name, t.description,
	COALESCE(c.slug, ''), COALESCE(c.name, ''), t.group_label,
	l.code, t.cefr_levels, t.difficulty::float8, t.ielts_relevant, t.estimated_minutes,
	EXISTS (SELECT 1 FROM grammar_questions q WHERE q.grammar_topic_id = t.id AND q.status = 'published'),
	COALESCE(p.mastery, 0)::float8, COALESCE(p.state, 'not_started'),
	COALESCE(p.attempts, 0), p.last_practiced_at`

func scanTopicSummary(row pgx.Row, t *TopicSummary) error {
	return row.Scan(&t.Slug, &t.Name, &t.Description, &t.Category, &t.CategoryName, &t.Group,
		&t.Level, &t.CEFRLevels, &t.Difficulty, &t.IELTSRelevant, &t.EstimatedMinutes,
		&t.HasPractice, &t.Mastery, &t.State, &t.Attempts, &t.LastPracticedAt)
}

// topicJoins attaches the category, level and the caller's progress to grammar_topics.
const topicJoins = `
	FROM grammar_topics t
	LEFT JOIN grammar_categories c ON c.id = t.category_id
	LEFT JOIN levels l ON l.id = t.level_id
	LEFT JOIN user_grammar_progress p ON p.grammar_topic_id = t.id AND p.user_id = $1`

// GET /grammar/categories — the library's folders with the learner's standing in each.
// Topics are not included: the curriculum is large and categories expand on demand.
func (m *Module) categories(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT cat.slug, cat.name, cat.description, cat.sort_order,
		       count(t.id)::int,
		       count(pr.user_id) FILTER (WHERE pr.state <> 'not_started')::int,
		       count(pr.user_id) FILTER (WHERE pr.state = 'mastered')::int,
		       COALESCE(avg(COALESCE(pr.mastery, 0)), 0)::float8,
		       COALESCE(array_agg(DISTINCT l.code ORDER BY l.code) FILTER (WHERE l.code IS NOT NULL), '{}')
		FROM grammar_categories cat
		LEFT JOIN grammar_topics t ON t.category_id = cat.id AND t.status = 'published'
		LEFT JOIN levels l ON l.id = t.level_id
		LEFT JOIN user_grammar_progress pr ON pr.grammar_topic_id = t.id AND pr.user_id = $1
		WHERE cat.status = 'published'
		GROUP BY cat.id
		ORDER BY cat.sort_order, cat.name`, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	out := []Category{}
	for rows.Next() {
		var cat Category
		if err := rows.Scan(&cat.Slug, &cat.Name, &cat.Description, &cat.SortOrder, &cat.TopicCount,
			&cat.StartedCount, &cat.MasteredCount, &cat.Mastery, &cat.Levels); err != nil {
			httpx.Fail(c, err)
			return
		}
		out = append(out, cat)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, out)
}

// TopicFilter is the query contract for /grammar/topics.
type TopicFilter struct {
	Category string `form:"category" binding:"omitempty,max=64"`
	// Level is a CEFR code, or "me" for the learner's own level (see resolveLevel).
	Level string `form:"level" binding:"omitempty,max=8"`
	Group string `form:"group" binding:"omitempty,max=64"`
}

// GET /grammar/topics — topics in a category, at a level, or both.
func (m *Module) listTopics(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	var f TopicFilter
	if err := httpx.BindQuery(c, &f); err != nil {
		httpx.Fail(c, err)
		return
	}

	levels, err := m.resolveLevel(c.Request.Context(), p.UserID, f.Level)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	args := []any{p.UserID}
	where := []string{"t.status = 'published'"}
	if f.Category != "" {
		args = append(args, f.Category)
		where = append(where, fmt.Sprintf("c.slug = $%d", len(args)))
	}
	if f.Group != "" {
		args = append(args, f.Group)
		where = append(where, fmt.Sprintf("t.group_label = $%d", len(args)))
	}
	if len(levels) > 0 {
		// cefr_levels lists every level a topic is worth studying at, so a B1 learner sees
		// a topic tagged A2+B1 under "My Level" without it being hidden from A2 learners.
		args = append(args, levels)
		where = append(where, fmt.Sprintf("(t.cefr_levels && $%d OR l.code = ANY($%d))", len(args), len(args)))
	}

	rows, err := m.pool.Query(c.Request.Context(), `SELECT `+topicColumns+topicJoins+`
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY c.sort_order, t.group_order, t.sort_order, t.name`, args...)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	out, err := collectTopics(rows)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, out)
}

func collectTopics(rows pgx.Rows) ([]TopicSummary, error) {
	out := []TopicSummary{}
	for rows.Next() {
		var t TopicSummary
		if err := scanTopicSummary(rows, &t); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// resolveLevel turns the `level` parameter into the CEFR codes to filter by.
//
//	""      no filter — the whole library, which is always browsable
//	"me"    the learner's own level from their profile, plus the level below and above,
//	        because what is worth studying at B1 starts at A2 and reaches into B2
//	"B1"    exactly that level
//
// The learner's level comes from profiles.current_level_id, the same source the dashboard
// and content filters read. Nothing about level is stored again here.
func (m *Module) resolveLevel(ctx context.Context, userID uuid.UUID, level string) ([]string, error) {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "", "all":
		return nil, nil
	case "me", "my_level", "my-level":
		var code *string
		err := m.pool.QueryRow(ctx, `
			SELECT l.code FROM profiles pr
			LEFT JOIN levels l ON l.id = pr.current_level_id
			WHERE pr.user_id = $1`, userID).Scan(&code)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		if code == nil || *code == "" {
			// No level yet (placement not taken): show everything rather than nothing.
			return nil, nil
		}
		parsed, err := cefr.Parse(*code)
		if err != nil {
			return nil, nil
		}
		band := []string{parsed.BaseCode()}
		if below := parsed.Shift(-1).BaseCode(); below != parsed.BaseCode() {
			band = append(band, below)
		}
		if above := parsed.Shift(1).BaseCode(); above != parsed.BaseCode() {
			band = append(band, above)
		}
		return band, nil
	default:
		parsed, err := cefr.Parse(level)
		if err != nil {
			return nil, apperr.BadRequest("level must be a CEFR code (A1–C2), \"me\" or \"all\"")
		}
		return []string{parsed.BaseCode()}, nil
	}
}

// GET /grammar/topics/:slug — the full topic page in one request.
func (m *Module) topic(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	ctx := c.Request.Context()
	slug := c.Param("slug")

	var (
		topic    Topic
		topicID  uuid.UUID
		body     []byte
		progress Progress
	)
	err := m.pool.QueryRow(ctx, `
		SELECT t.id, `+topicColumns+`,
		       COALESCE(gc.body, 'null'::jsonb),
		       COALESCE(p.mastery, 0)::float8, COALESCE(p.understanding, 0)::float8,
		       COALESCE(p.practice, 0)::float8, COALESCE(p.application, 0)::float8,
		       COALESCE(p.correct, 0),
		       (SELECT count(*) FROM grammar_questions q
		         WHERE q.grammar_topic_id = t.id AND q.status = 'published')::int`+
		topicJoins+`
		LEFT JOIN grammar_content gc ON gc.grammar_topic_id = t.id AND gc.status = 'published'
		WHERE t.slug = $2 AND t.status = 'published'`, p.UserID, slug).
		Scan(&topicID, &topic.Slug, &topic.Name, &topic.Description, &topic.Category, &topic.CategoryName,
			&topic.Group, &topic.Level, &topic.CEFRLevels, &topic.Difficulty, &topic.IELTSRelevant,
			&topic.EstimatedMinutes, &topic.HasPractice, &topic.Mastery, &topic.State, &topic.Attempts,
			&topic.LastPracticedAt, &body, &progress.Mastery, &progress.Understanding,
			&progress.Practice, &progress.Application, &progress.Correct, &topic.QuestionCount)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.NotFound("Grammar topic"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	if len(body) > 0 && string(body) != "null" {
		var content Content
		if err := json.Unmarshal(body, &content); err != nil {
			// Malformed canonical content must not take the page down: the learner still
			// gets the topic, its relations and its practice.
			m.log.Error("grammar content is not readable", "topic", slug, "error", err.Error())
		} else {
			topic.Content = &content
		}
	}
	progress.State = topic.State
	progress.Attempts = topic.Attempts
	progress.LastPracticedAt = topic.LastPracticedAt
	topic.Progress = progress

	relations, err := m.relationsOf(ctx, p.UserID, topicID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	// A relation kind with no rows must serialize as [] and not null: the API contract says
	// these are arrays, and a client that trusts it would otherwise crash on the one topic
	// that happens to have no "related" links.
	topic.Prerequisites = orEmpty(relations[RelPrerequisite])
	topic.Related = orEmpty(append(relations[RelRelated], relations[RelAlternative]...))
	topic.Compare = orEmpty(append(relations[RelCompare], relations[RelCommonlyConfused]...))
	topic.Next = orEmpty(relations[RelNext])

	topic.Visuals, err = m.visualsOf(ctx, topicID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	// Opening a topic is the first signal of understanding. It is recorded here rather than
	// from the client so every platform counts it the same way.
	if err := m.markOpened(ctx, p.UserID, topicID); err != nil {
		m.log.Warn("grammar topic open not recorded", "topic", slug, "error", err.Error())
	}
	m.track(ctx, p.UserID, EventTopicOpened, map[string]any{"topic": slug, "category": topic.Category})

	httpx.OK(c, topic)
}

// relationsOf loads every outgoing relation of a topic, grouped by kind.
func (m *Module) relationsOf(ctx context.Context, userID, topicID uuid.UUID) (map[string][]RelatedTopic, error) {
	rows, err := m.pool.Query(ctx, `
		SELECT r.kind, r.note, `+topicColumns+`
		FROM grammar_relations r
		JOIN grammar_topics t ON t.id = r.to_topic_id AND t.status = 'published'
		LEFT JOIN grammar_categories c ON c.id = t.category_id
		LEFT JOIN levels l ON l.id = t.level_id
		LEFT JOIN user_grammar_progress p ON p.grammar_topic_id = t.id AND p.user_id = $1
		WHERE r.from_topic_id = $2
		ORDER BY r.kind, r.sort_order, t.name`, userID, topicID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string][]RelatedTopic{}
	for rows.Next() {
		var rel RelatedTopic
		if err := rows.Scan(&rel.Kind, &rel.Note, &rel.Slug, &rel.Name, &rel.Description, &rel.Category,
			&rel.CategoryName, &rel.Group, &rel.Level, &rel.CEFRLevels, &rel.Difficulty, &rel.IELTSRelevant,
			&rel.EstimatedMinutes, &rel.HasPractice, &rel.Mastery, &rel.State, &rel.Attempts,
			&rel.LastPracticedAt); err != nil {
			return nil, err
		}
		out[rel.Kind] = append(out[rel.Kind], rel)
	}
	return out, rows.Err()
}

// GET /grammar/topics/:slug/related — the relation graph around one topic on its own, for
// clients that render it separately from the topic page.
func (m *Module) related(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	topicID, err := m.topicIDBySlug(c.Request.Context(), c.Param("slug"))
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	relations, err := m.relationsOf(c.Request.Context(), p.UserID, topicID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	for _, kind := range []string{RelPrerequisite, RelRelated, RelCompare, RelNext, RelAlternative, RelCommonlyConfused} {
		if relations[kind] == nil {
			relations[kind] = []RelatedTopic{}
		}
	}
	httpx.OK(c, relations)
}

// GET /grammar/topics/:slug/compare/:other — the comparison table between two topics.
// Comparisons are stored once and read from either direction.
func (m *Module) comparison(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	ctx := c.Request.Context()
	left, right := c.Param("slug"), c.Param("other")

	var (
		out      Comparison
		rowsJSON []byte
		flipped  bool
	)
	err := m.pool.QueryRow(ctx, `
		SELECT gc.summary, gc.rows, lt.slug <> $1
		FROM grammar_comparisons gc
		JOIN grammar_topics lt ON lt.id = gc.left_topic_id
		JOIN grammar_topics rt ON rt.id = gc.right_topic_id
		WHERE gc.status = 'published'
		  AND ((lt.slug = $1 AND rt.slug = $2) OR (lt.slug = $2 AND rt.slug = $1))`,
		left, right).Scan(&out.Summary, &rowsJSON, &flipped)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.NotFound("Comparison"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if err := json.Unmarshal(rowsJSON, &out.Rows); err != nil {
		httpx.Fail(c, apperr.Wrap(err, apperr.CodeInternal, "Something went wrong"))
		return
	}
	if flipped {
		// Stored the other way round: swap the columns so the URL's first topic stays left.
		for i := range out.Rows {
			out.Rows[i].Left, out.Rows[i].Right = out.Rows[i].Right, out.Rows[i].Left
		}
	}

	for slug, dst := range map[string]*TopicSummary{left: &out.Left, right: &out.Right} {
		if err := scanTopicSummary(m.pool.QueryRow(ctx, `SELECT `+topicColumns+topicJoins+`
			WHERE t.slug = $2 AND t.status = 'published'`, p.UserID, slug), dst); err != nil {
			httpx.Fail(c, err)
			return
		}
	}
	httpx.OK(c, out)
}

// MapNode is a category with its topics, grouped, for the grammar map.
type MapNode struct {
	Slug   string     `json:"slug"`
	Name   string     `json:"name"`
	Groups []MapGroup `json:"groups"`
}

type MapGroup struct {
	Label  string         `json:"label"`
	Topics []TopicSummary `json:"topics"`
}

// GET /grammar/map — the whole curriculum as category → group → topic. A hierarchical map
// rather than a force-directed graph: it answers "where am I and what is next" at a glance,
// and the relation graph is already available per topic.
func (m *Module) topicMap(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	rows, err := m.pool.Query(c.Request.Context(), `SELECT `+topicColumns+topicJoins+`
		WHERE t.status = 'published' AND c.status = 'published'
		ORDER BY c.sort_order, t.group_order, t.sort_order, t.name`, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	topics, err := collectTopics(rows)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	nodes := []MapNode{}
	byCategory := map[string]int{}
	for _, t := range topics {
		ci, ok := byCategory[t.Category]
		if !ok {
			nodes = append(nodes, MapNode{Slug: t.Category, Name: t.CategoryName})
			ci = len(nodes) - 1
			byCategory[t.Category] = ci
		}
		groups := nodes[ci].Groups
		gi := -1
		for i := range groups {
			if groups[i].Label == t.Group {
				gi = i
				break
			}
		}
		if gi < 0 {
			groups = append(groups, MapGroup{Label: t.Group, Topics: []TopicSummary{}})
			gi = len(groups) - 1
		}
		groups[gi].Topics = append(groups[gi].Topics, t)
		nodes[ci].Groups = groups
	}
	httpx.OK(c, nodes)
}

// orEmpty turns a nil slice into an empty one, so it marshals as [] rather than null.
func orEmpty[T any](in []T) []T {
	if in == nil {
		return []T{}
	}
	return in
}

func (m *Module) topicIDBySlug(ctx context.Context, slug string) (uuid.UUID, error) {
	var id uuid.UUID
	err := m.pool.QueryRow(ctx, `SELECT id FROM grammar_topics WHERE slug = $1 AND status = 'published'`, slug).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, apperr.NotFound("Grammar topic")
	}
	return id, err
}

func (m *Module) visualsOf(ctx context.Context, topicID uuid.UUID) ([]Visual, error) {
	rows, err := m.pool.Query(ctx, `
		SELECT id, kind, alt_text, caption, status
		FROM grammar_visuals
		WHERE grammar_topic_id = $1 AND user_id IS NULL AND status = 'ready'
		ORDER BY created_at`, topicID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Visual{}
	for rows.Next() {
		var v Visual
		if err := rows.Scan(&v.ID, &v.Kind, &v.AltText, &v.Caption, &v.Status); err != nil {
			return nil, err
		}
		v.URL = VisualRoute + "/" + v.ID.String()
		out = append(out, v)
	}
	return out, rows.Err()
}
