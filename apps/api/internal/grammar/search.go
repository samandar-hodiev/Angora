package grammar

import (
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Grammar search runs in PostgreSQL, not in the browser. The curriculum is a few hundred
// topics today and grows with every release; shipping it to every client to filter would
// get slower exactly as the product gets better.
//
// Three signals are combined, because learners search in three different ways:
//
//	full text   "past perfect", "reported speech"        → ts_rank over name + description
//	keywords    "v2", "did", "used to", "-ing"           → the keywords array, which carries
//	                                                        synonyms, forms and tags
//	prefix      "artic", "cond"                          → ILIKE on the name, for typing
//
// A name match always outranks a keyword match, which outranks a description match, so
// "the article" returns The Article before "Articles with geographical names".

// SearchResult is a topic plus why it matched, so the client can highlight it.
type SearchResult struct {
	TopicSummary
	// MatchedKeywords are the topic's own keywords that matched the query. The client
	// highlights these rather than guessing which part of the text matched.
	MatchedKeywords []string `json:"matched_keywords"`
	Rank            float64  `json:"rank"`
}

type SearchResponse struct {
	Query   string         `json:"query"`
	Results []SearchResult `json:"results"`
	// Related are topics connected to the results (compare/related/next) that did not match
	// the query themselves — the "Related" block under search results.
	Related []TopicSummary `json:"related"`
	// Suggestions are offered when nothing matched, so the empty state is never a dead end.
	Suggestions []string `json:"suggestions"`
}

// defaultSuggestions are shown when a search returns nothing. They are the entry points
// most learners are actually looking for.
var defaultSuggestions = []string{"past", "articles", "conditionals", "present perfect", "modal verbs"}

type searchQuery struct {
	Q     string `form:"q" binding:"required,min=1,max=64"`
	Level string `form:"level" binding:"omitempty,max=8"`
	Limit int    `form:"limit" binding:"omitempty,min=1,max=50"`
}

// GET /grammar/search?q=&level=&limit=
func (m *Module) search(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	ctx := c.Request.Context()

	var q searchQuery
	if err := httpx.BindQuery(c, &q); err != nil {
		httpx.Fail(c, err)
		return
	}
	if q.Limit == 0 {
		q.Limit = 20
	}
	term := strings.TrimSpace(q.Q)

	levels, err := m.resolveLevel(ctx, p.UserID, q.Level)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	// $3 is the websearch query ("used to" stays a phrase, a bare word is a prefix match),
	// $4 the ILIKE pattern, $5 the lower-cased term matched against keywords.
	rows, err := m.pool.Query(ctx, `
		WITH sq AS (
		    SELECT websearch_to_tsquery('english', $2) AS ts,
		           lower($2) AS term,
		           '%' || lower($2) || '%' AS like_term,
		           lower($2) || '%' AS prefix_term
		)
		SELECT `+topicColumns+`,
		       COALESCE(ARRAY(SELECT k FROM unnest(t.keywords) k WHERE lower(k) LIKE sq.like_term), '{}'),
		       -- Ranking is layered by how deliberate the match is. A learner typing "ing"
		       -- means the -ing form, not every topic whose name contains those letters, so a
		       -- keyword that IS the query beats one that merely contains it, and both beat an
		       -- accidental substring of a name like "Defining".
		       (ts_rank(t.search_document, sq.ts) * 4
		         + CASE WHEN lower(t.name) = sq.term THEN 12
		                WHEN lower(t.name) LIKE sq.prefix_term THEN 5
		                WHEN lower(t.name) LIKE sq.like_term THEN 1.5 ELSE 0 END
		         + CASE WHEN EXISTS (SELECT 1 FROM unnest(t.keywords) k
		                              WHERE lower(k) = sq.term OR lower(ltrim(k, '-')) = sq.term) THEN 8
		                WHEN EXISTS (SELECT 1 FROM unnest(t.keywords) k
		                              WHERE lower(k) LIKE sq.prefix_term OR lower(k) LIKE '%% ' || sq.prefix_term) THEN 4
		                WHEN EXISTS (SELECT 1 FROM unnest(t.keywords) k WHERE lower(k) LIKE sq.like_term) THEN 1
		                ELSE 0 END
		         -- Between topics that match equally well, the more fundamental one goes first:
		         -- someone searching "past" almost always wants Past Simple before Past Perfect.
		         + (1 - t.difficulty)
		       )::float8 AS rank`+topicJoins+`
		CROSS JOIN sq
		WHERE t.status = 'published'
		  AND (t.search_document @@ sq.ts
		       OR lower(t.name) LIKE sq.like_term
		       OR EXISTS (SELECT 1 FROM unnest(t.keywords) k WHERE lower(k) LIKE sq.like_term))
		  AND ($3::text[] IS NULL OR t.cefr_levels && $3 OR l.code = ANY($3))
		ORDER BY rank DESC, t.sort_order, t.name
		LIMIT $4`, p.UserID, term, levels, q.Limit)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	out := SearchResponse{Query: term, Results: []SearchResult{}, Related: []TopicSummary{}, Suggestions: []string{}}
	matched := map[string]bool{}
	for rows.Next() {
		var r SearchResult
		if err := rows.Scan(&r.Slug, &r.Name, &r.Description, &r.Category, &r.CategoryName, &r.Group,
			&r.Level, &r.CEFRLevels, &r.Difficulty, &r.IELTSRelevant, &r.EstimatedMinutes, &r.HasPractice,
			&r.Mastery, &r.State, &r.Attempts, &r.LastPracticedAt, &r.MatchedKeywords, &r.Rank); err != nil {
			httpx.Fail(c, err)
			return
		}
		matched[r.Slug] = true
		out.Results = append(out.Results, r)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}

	if len(out.Results) == 0 {
		out.Suggestions = defaultSuggestions
		m.track(ctx, p.UserID, EventSearch, map[string]any{"query": term, "results": 0})
		httpx.OK(c, out)
		return
	}

	// "Search: past → Past Simple … Related: Past Simple vs Present Perfect". The related
	// block comes from the relation graph, not from a second text search.
	slugs := make([]string, 0, len(out.Results))
	for _, r := range out.Results {
		slugs = append(slugs, r.Slug)
	}
	relatedRows, err := m.pool.Query(ctx, `SELECT DISTINCT `+topicColumns+topicJoins+`
		JOIN grammar_relations r ON r.to_topic_id = t.id
		JOIN grammar_topics src ON src.id = r.from_topic_id
		WHERE t.status = 'published' AND src.slug = ANY($2)
		  AND r.kind IN ('compare', 'commonly_confused', 'related')
		  AND NOT (t.slug = ANY($2))
		ORDER BY t.name
		LIMIT 8`, p.UserID, slugs)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer relatedRows.Close()
	out.Related, err = collectTopics(relatedRows)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	m.track(ctx, p.UserID, EventSearch, map[string]any{"query": term, "results": len(out.Results)})
	httpx.OK(c, out)
}
