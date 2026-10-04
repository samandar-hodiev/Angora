// Package vocabulary serves the learner's word deck with spaced-repetition state.
//
// Review scheduling (SM-2 updates from ratings) arrives in Phase 5; the read model and
// the mastery calculation are shared by every client from here.
package vocabulary

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

type Card struct {
	ID               uuid.UUID `json:"id"`
	Term             string    `json:"term"`
	PartOfSpeech     string    `json:"part_of_speech"`
	Definition       string    `json:"definition"`
	Examples         []string  `json:"examples"`
	PronunciationIPA string    `json:"pronunciation_ipa"`
	// Translations is the word in the learner's own language: {"uz": "...", "ru": "..."}.
	Translations map[string]string `json:"translations"`
	// LevelContent is the word explained per CEFR level: {"A1": {"definition", "examples"}}.
	LevelContent   map[string]LevelText `json:"level_content"`
	Level          *string              `json:"level"`
	Tags           []string             `json:"tags"`
	Status         string               `json:"status"`
	Mastery        int                  `json:"mastery"`
	DueAt          time.Time            `json:"due_at"`
	LastReviewedAt *time.Time           `json:"last_reviewed_at"`
}

type DeckSummary struct {
	Total     int `json:"total"`
	Due       int `json:"due"`
	New       int `json:"new"`
	Learning  int `json:"learning"`
	Reviewing int `json:"reviewing"`
	Mastered  int `json:"mastered"`
}

type Deck struct {
	Summary DeckSummary `json:"summary"`
	Cards   []Card      `json:"cards"`
}

// Mastery converts spaced-repetition state into a 0–100 value for display. It lives on
// the server so web and mobile always agree.
func Mastery(status string, repetitions int) int {
	base := map[string]int{"new": 0, "learning": 25, "reviewing": 60}
	if status == "mastered" {
		return 100
	}
	return min(base[status]+repetitions*5, 95)
}

type Module struct {
	pool *pgxpool.Pool
}

func NewModule(pool *pgxpool.Pool) *Module { return &Module{pool: pool} }

func (m *Module) RegisterRoutes(v1 *gin.RouterGroup) {
	practice := authz.RequirePermission(authz.PermLearningPractice)
	v1.GET("/vocabulary/deck", practice, m.deck)
	v1.GET("/vocabulary/library", practice, m.library)
	v1.POST("/vocabulary/deck/:id", practice, m.addToDeck)
}

// LevelText is a word explained for one level.
type LevelText struct {
	Definition string   `json:"definition"`
	Examples   []string `json:"examples"`
}

func (m *Module) deck(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	var page httpx.Pagination
	if err := httpx.BindQuery(c, &page); err != nil {
		httpx.Fail(c, err)
		return
	}
	page = page.Normalize()
	ctx := c.Request.Context()

	if err := m.topUp(ctx, p.UserID); err != nil {
		httpx.Fail(c, err)
		return
	}

	deck := Deck{Cards: []Card{}}
	err := m.pool.QueryRow(ctx, `
		SELECT count(*)::int,
		       count(*) FILTER (WHERE due_at <= now())::int,
		       count(*) FILTER (WHERE status = 'new')::int,
		       count(*) FILTER (WHERE status = 'learning')::int,
		       count(*) FILTER (WHERE status = 'reviewing')::int,
		       count(*) FILTER (WHERE status = 'mastered')::int
		FROM user_vocabulary WHERE user_id = $1`, p.UserID,
	).Scan(&deck.Summary.Total, &deck.Summary.Due, &deck.Summary.New, &deck.Summary.Learning,
		&deck.Summary.Reviewing, &deck.Summary.Mastered)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	rows, err := m.pool.Query(ctx, `
		SELECT v.id, v.term, v.part_of_speech, v.definition, v.examples, v.pronunciation_ipa, v.translations,
		       v.level_content, l.code, v.tags,
		       uv.status, uv.repetitions, uv.due_at, uv.last_reviewed_at
		FROM user_vocabulary uv
		JOIN vocabulary v ON v.id = uv.vocabulary_id
		LEFT JOIN levels l ON l.id = v.level_id
		WHERE uv.user_id = $1
		ORDER BY uv.due_at ASC, v.term ASC
		OFFSET $2 LIMIT $3`, p.UserID, page.Offset(), page.PageSize)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var card Card
		var repetitions int
		if err := rows.Scan(&card.ID, &card.Term, &card.PartOfSpeech, &card.Definition, &card.Examples,
			&card.PronunciationIPA, &card.Translations, &card.LevelContent, &card.Level, &card.Tags, &card.Status, &repetitions, &card.DueAt,
			&card.LastReviewedAt); err != nil {
			httpx.Fail(c, err)
			return
		}
		card.Mastery = Mastery(card.Status, repetitions)
		deck.Cards = append(deck.Cards, card)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OKWithMeta(c, deck, httpx.Meta{Page: page.Page, PageSize: page.PageSize, Total: int64(deck.Summary.Total)})
}

// newWordsInDeck is how many unstarted words a deck holds before more are added: enough to
// learn from, few enough that the deck does not become a list nobody finishes.
const newWordsInDeck = 10

// topUp adds published words at the learner's level — one either side of it too — while
// their deck has fewer than newWordsInDeck new words. Words an owner publishes reach learners
// this way, without anyone having to assign them.
func (m *Module) topUp(ctx context.Context, userID uuid.UUID) error {
	_, err := m.pool.Exec(ctx, `
		WITH learner AS (
		    SELECT COALESCE((SELECT l.rank FROM profiles pr JOIN levels l ON l.id = pr.current_level_id
		                     WHERE pr.user_id = $1), (SELECT rank FROM levels WHERE code = 'B1')) AS rank
		), room AS (
		    SELECT GREATEST($2 - count(*), 0) AS n FROM user_vocabulary WHERE user_id = $1 AND status = 'new'
		)
		INSERT INTO user_vocabulary (user_id, vocabulary_id, source)
		SELECT $1, v.id, 'library'
		FROM vocabulary v
		JOIN levels l ON l.id = v.level_id, learner
		WHERE v.status = 'published'
		  AND l.rank BETWEEN learner.rank - 1 AND learner.rank + 1
		  AND NOT EXISTS (SELECT 1 FROM user_vocabulary uv WHERE uv.user_id = $1 AND uv.vocabulary_id = v.id)
		ORDER BY abs(l.rank - learner.rank), v.frequency_rank NULLS LAST, v.published_at, v.term
		LIMIT (SELECT n FROM room)
		ON CONFLICT DO NOTHING`, userID, newWordsInDeck)
	return err
}

// LibraryWord is a published word as the learner browses the library.
type LibraryWord struct {
	ID               uuid.UUID            `json:"id"`
	Term             string               `json:"term"`
	PartOfSpeech     string               `json:"part_of_speech"`
	PronunciationIPA string               `json:"pronunciation_ipa"`
	Level            *string              `json:"level"`
	Tags             []string             `json:"tags"`
	Translations     map[string]string    `json:"translations"`
	LevelContent     map[string]LevelText `json:"level_content"`
	/** The word is in the learner's own deck. */
	InDeck bool `json:"in_deck"`
}

type libraryPage struct {
	Items []LibraryWord `json:"items"`
	/** The learner's level: the explanation the page opens on. */
	LearnerLevel string `json:"learner_level"`
}

type libraryQuery struct {
	Search string `form:"q" binding:"omitempty,max=100"`
	Level  string `form:"level" binding:"omitempty,oneof=A1 A2 B1 B2 C1 C2"`
	httpx.Pagination
}

// GET /vocabulary/library — every published word, at every level, in one list. Each comes
// with its explanation for every level; the learner's own level is the one shown first.
func (m *Module) library(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	var q libraryQuery
	if err := httpx.BindQuery(c, &q); err != nil {
		httpx.Fail(c, err)
		return
	}
	q.Pagination = q.Pagination.Normalize()
	ctx := c.Request.Context()

	out := libraryPage{Items: []LibraryWord{}, LearnerLevel: "B1"}
	_ = m.pool.QueryRow(ctx, `
		SELECT l.code FROM profiles pr JOIN levels l ON l.id = pr.current_level_id WHERE pr.user_id = $1`,
		p.UserID).Scan(&out.LearnerLevel)

	where := `WHERE v.status = 'published'
	            AND ($1 = '' OR v.term ILIKE '%' || $1 || '%' OR v.translations::text ILIKE '%' || $1 || '%')
	            AND ($2 = '' OR l.code = $2)`
	var total int64
	if err := m.pool.QueryRow(ctx, `SELECT count(*) FROM vocabulary v LEFT JOIN levels l ON l.id = v.level_id `+where,
		q.Search, q.Level).Scan(&total); err != nil {
		httpx.Fail(c, err)
		return
	}
	rows, err := m.pool.Query(ctx, `
		SELECT v.id, v.term, v.part_of_speech, v.pronunciation_ipa, l.code, v.tags, v.translations,
		       v.level_content, v.definition, v.examples,
		       EXISTS (SELECT 1 FROM user_vocabulary uv WHERE uv.user_id = $3 AND uv.vocabulary_id = v.id)
		FROM vocabulary v LEFT JOIN levels l ON l.id = v.level_id `+where+`
		ORDER BY lower(v.term)
		OFFSET $4 LIMIT $5`, q.Search, q.Level, p.UserID, q.Offset(), q.PageSize)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var w LibraryWord
		var definition string
		var examples []string
		if err := rows.Scan(&w.ID, &w.Term, &w.PartOfSpeech, &w.PronunciationIPA, &w.Level, &w.Tags, &w.Translations,
			&w.LevelContent, &definition, &examples, &w.InDeck); err != nil {
			httpx.Fail(c, err)
			return
		}
		// A word written before levels existed has one explanation, at its own level.
		if len(w.LevelContent) == 0 && definition != "" {
			code := "B1"
			if w.Level != nil {
				code = *w.Level
			}
			w.LevelContent = map[string]LevelText{code: {Definition: definition, Examples: examples}}
		}
		if w.Tags == nil {
			w.Tags = []string{}
		}
		out.Items = append(out.Items, w)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OKWithMeta(c, out, httpx.Meta{Page: q.Page, PageSize: q.PageSize, Total: total})
}

// POST /vocabulary/deck/:id — add a published word to the learner's own deck.
func (m *Module) addToDeck(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid word id"))
		return
	}
	tag, err := m.pool.Exec(c.Request.Context(), `
		INSERT INTO user_vocabulary (user_id, vocabulary_id, source)
		SELECT $1, v.id, 'manual' FROM vocabulary v WHERE v.id = $2 AND v.status = 'published'
		ON CONFLICT DO NOTHING`, p.UserID, id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, map[string]bool{"added": tag.RowsAffected() > 0})
}
