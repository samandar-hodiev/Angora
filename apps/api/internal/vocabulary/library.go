package vocabulary

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// LibraryWord is a published word as the learner browses the library.
type LibraryWord struct {
	ID               uuid.UUID            `json:"id"`
	Term             string               `json:"term"`
	Kind             string               `json:"kind"`
	PartOfSpeech     string               `json:"part_of_speech"`
	PronunciationIPA string               `json:"pronunciation_ipa"`
	Level            *string              `json:"level"`
	Tags             []string             `json:"tags"`
	Translations     map[string]string    `json:"translations"`
	LevelContent     map[string]LevelText `json:"level_content"`
	/** The explanation at the entry's own level. */
	Definition string   `json:"definition"`
	Examples   []string `json:"examples"`
	/** Other meanings, each at its own level. */
	Senses []ai.Sense `json:"senses"`
	/** list | ai_checked | ai | curated: where the level came from. */
	LevelSource string `json:"level_source"`
	Register    string `json:"register"`
	/** The words worth comparing it with. */
	Synonyms []string `json:"synonyms"`
	/** The word is in the learner's own deck, and how far along it is there. */
	InDeck     bool    `json:"in_deck"`
	DeckStatus *string `json:"deck_status"`
}

// Facet is one value a filter can take, with how many published words have it.
type Facet struct {
	Value string `json:"value"`
	Count int    `json:"count"`
}

type LibraryFacets struct {
	Levels        []Facet `json:"levels"`
	Topics        []Facet `json:"topics"`
	Registers     []Facet `json:"registers"`
	PartsOfSpeech []Facet `json:"parts_of_speech"`
}

type libraryPage struct {
	Items []LibraryWord `json:"items"`
	/** The learner's level: the explanation the page opens on. */
	LearnerLevel string        `json:"learner_level"`
	Facets       LibraryFacets `json:"facets"`
}

type libraryQuery struct {
	Search string `form:"q" binding:"omitempty,max=100"`
	Level  string `form:"level" binding:"omitempty,oneof=A1 A2 B1 B2 C1 C2"`
	Topic  string `form:"topic" binding:"omitempty,max=40"`
	POS    string `form:"pos" binding:"omitempty,max=30"`
	Kind   string `form:"kind" binding:"omitempty,oneof=word phrase collocation"`
	/** formal | informal | neutral | … */
	Register string `form:"register" binding:"omitempty,max=20"`
	/** level (default): easiest first, A–Z inside a level; az; newest. */
	Sort string `form:"sort" binding:"omitempty,oneof=level az newest"`
	/** all (default) | new: not in my deck | mine: in my deck. */
	Show string `form:"show" binding:"omitempty,oneof=all new mine"`
	httpx.Pagination
}

// GET /vocabulary/library — published words, filtered by level, topic, part of speech and
// whether they are already in the learner's deck, and searchable in English, Uzbek and
// Russian. Facets say how many words each filter value holds, so an empty one is never offered.
func (m *Module) library(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	var q libraryQuery
	if err := httpx.BindQuery(c, &q); err != nil {
		httpx.Fail(c, err)
		return
	}
	q.Pagination = q.Pagination.Normalize()
	ctx := c.Request.Context()

	out := libraryPage{Items: []LibraryWord{}, LearnerLevel: m.learnerLevel(ctx, p.UserID)}

	where := `WHERE v.status = 'published'
	            AND ($1 = '' OR v.term ILIKE '%' || $1 || '%' OR v.translations::text ILIKE '%' || $1 || '%'
	                 OR $1 ILIKE ANY (v.synonyms))
	            AND ($2 = '' OR l.code = $2)
	            AND ($3 = '' OR EXISTS (SELECT 1 FROM unnest(v.tags) t WHERE lower(t) = lower($3)))
	            AND ($4 = '' OR v.part_of_speech = $4)
	            AND (CASE $6 WHEN 'new' THEN uv.vocabulary_id IS NULL WHEN 'mine' THEN uv.vocabulary_id IS NOT NULL ELSE TRUE END)
	            AND ($9 = '' OR v.kind = $9)
	            AND ($10 = '' OR v.register = $10)`
	from := ` FROM vocabulary v LEFT JOIN levels l ON l.id = v.level_id
	          LEFT JOIN user_vocabulary uv ON uv.vocabulary_id = v.id AND uv.user_id = $5 `
	args := []any{q.Search, q.Level, q.Topic, q.POS, p.UserID, q.Show, 0, 0, q.Kind, q.Register}

	var total int64
	// The count shares the list's arguments; it names $7 and $8 (offset, limit) only so every
	// argument has a type.
	if err := m.pool.QueryRow(ctx, `SELECT count(*)`+from+where+` AND $7::int = $8::int`, args...).Scan(&total); err != nil {
		httpx.Fail(c, err)
		return
	}
	order := `l.rank NULLS LAST, lower(v.term)`
	switch q.Sort {
	case "az":
		order = `lower(v.term)`
	case "newest":
		order = `v.published_at DESC NULLS LAST, lower(v.term)`
	}
	rows, err := m.pool.Query(ctx, `
		SELECT v.id, v.term, v.part_of_speech, v.pronunciation_ipa, l.code, v.tags, v.translations,
		       v.level_content, v.definition, v.examples, v.register, v.synonyms, uv.status, v.kind, v.senses, v.level_source`+from+where+`
		ORDER BY `+order+` OFFSET $7 LIMIT $8`, withPage(args, q.Offset(), q.PageSize)...)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var w LibraryWord
		if err := rows.Scan(&w.ID, &w.Term, &w.PartOfSpeech, &w.PronunciationIPA, &w.Level, &w.Tags, &w.Translations,
			&w.LevelContent, &w.Definition, &w.Examples, &w.Register, &w.Synonyms, &w.DeckStatus, &w.Kind, &w.Senses,
			&w.LevelSource); err != nil {
			httpx.Fail(c, err)
			return
		}
		w.settle()
		w.InDeck = w.DeckStatus != nil
		out.Items = append(out.Items, w)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	if out.Facets, err = m.facets(c, q.Kind); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OKWithMeta(c, out, httpx.Meta{Page: q.Page, PageSize: q.PageSize, Total: total})
}

// withPage sets OFFSET and LIMIT, the 7th and 8th arguments of the library query.
func withPage(args []any, offset, limit int) []any {
	out := append([]any{}, args...)
	out[6], out[7] = offset, limit
	return out
}

// settle fills what older entries lack: an explanation keyed by level, the definition taken
// from it, and empty lists rather than nulls.
func (w *LibraryWord) settle() {
	w.LevelContent = withOwnLevel(w.LevelContent, w.Level, w.Definition, w.Examples)
	if w.Definition == "" && w.Level != nil {
		if t, ok := w.LevelContent[*w.Level]; ok {
			w.Definition, w.Examples = t.Definition, t.Examples
		}
	}
	if w.Examples == nil {
		w.Examples = []string{}
	}
	if w.Senses == nil {
		w.Senses = []ai.Sense{}
	}
	if w.Tags == nil {
		w.Tags = []string{}
	}
	if w.Synonyms == nil {
		w.Synonyms = []string{}
	}
}

// withOwnLevel gives a word written before levels existed its one explanation, at its own level.
func withOwnLevel(content map[string]LevelText, level *string, definition string, examples []string) map[string]LevelText {
	if len(content) == 0 && definition != "" {
		code := "B1"
		if level != nil {
			code = *level
		}
		return map[string]LevelText{code: {Definition: definition, Examples: examples}}
	}
	if content == nil {
		return map[string]LevelText{}
	}
	return content
}

// facets counts the published library by level, topic and part of speech.
func (m *Module) facets(c *gin.Context, kind string) (LibraryFacets, error) {
	ctx := c.Request.Context()
	f := LibraryFacets{Levels: []Facet{}, Topics: []Facet{}, PartsOfSpeech: []Facet{}, Registers: []Facet{}}
	read := func(sql string, into *[]Facet) error {
		rows, err := m.pool.Query(ctx, sql, kind)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var x Facet
			if err := rows.Scan(&x.Value, &x.Count); err != nil {
				return err
			}
			*into = append(*into, x)
		}
		return rows.Err()
	}
	if err := read(`SELECT l.code, count(*)::int FROM vocabulary v JOIN levels l ON l.id = v.level_id
		WHERE v.status = 'published' AND ($1 = '' OR v.kind = $1) GROUP BY l.code, l.rank ORDER BY l.rank`, &f.Levels); err != nil {
		return f, err
	}
	if err := read(`SELECT lower(t), count(*)::int FROM vocabulary v, unnest(v.tags) t
		WHERE v.status = 'published' AND ($1 = '' OR v.kind = $1) AND trim(t) <> '' GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 30`, &f.Topics); err != nil {
		return f, err
	}
	if err := read(`SELECT part_of_speech, count(*)::int FROM vocabulary
		WHERE status = 'published' AND ($1 = '' OR kind = $1) AND part_of_speech <> '' GROUP BY 1 ORDER BY 2 DESC, 1`, &f.PartsOfSpeech); err != nil {
		return f, err
	}
	if err := read(`SELECT register, count(*)::int FROM vocabulary
		WHERE status = 'published' AND ($1 = '' OR kind = $1) AND register <> '' GROUP BY 1 ORDER BY 2 DESC, 1`, &f.Registers); err != nil {
		return f, err
	}
	return f, nil
}
