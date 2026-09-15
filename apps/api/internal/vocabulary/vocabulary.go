// Package vocabulary serves the learner's word deck with spaced-repetition state.
//
// Review scheduling (SM-2 updates from ratings) arrives in Phase 5; the read model and
// the mastery calculation are shared by every client from here.
package vocabulary

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

type Card struct {
	ID               uuid.UUID  `json:"id"`
	Term             string     `json:"term"`
	PartOfSpeech     string     `json:"part_of_speech"`
	Definition       string     `json:"definition"`
	Examples         []string   `json:"examples"`
	PronunciationIPA string     `json:"pronunciation_ipa"`
	Level            *string    `json:"level"`
	Tags             []string   `json:"tags"`
	Status           string     `json:"status"`
	Mastery          int        `json:"mastery"`
	DueAt            time.Time  `json:"due_at"`
	LastReviewedAt   *time.Time `json:"last_reviewed_at"`
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
	v1.GET("/vocabulary/deck", authz.RequirePermission(authz.PermLearningPractice), m.deck)
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
		SELECT v.id, v.term, v.part_of_speech, v.definition, v.examples, v.pronunciation_ipa, l.code, v.tags,
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
			&card.PronunciationIPA, &card.Level, &card.Tags, &card.Status, &repetitions, &card.DueAt,
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
