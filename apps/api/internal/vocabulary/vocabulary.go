// Package vocabulary is the learner's side of words: a library to browse by level, topic and
// part of speech; each word with how it is used, not only what it means; comparisons of words
// that look the same in Uzbek or Russian; and a deck reviewed with spaced repetition.
package vocabulary

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/ratelimit"
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
	Collocations   []string             `json:"collocations"`
	Kind           string               `json:"kind"`
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
	/** Reviews done today, for the "today" counter. */
	ReviewedToday int `json:"reviewed_today"`
}

type Deck struct {
	Summary DeckSummary `json:"summary"`
	Cards   []Card      `json:"cards"`
	/** The learner's level: the explanation each card shows. */
	LearnerLevel string `json:"learner_level"`
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

// Writer is the AI the module needs: usage notes for a word that has none, and comparisons.
type Writer interface {
	EnrichWord(ctx context.Context, req ai.EnrichRequest) (ai.WordUsage, *ai.EvaluationMeta, error)
	CompareWords(ctx context.Context, req ai.CompareRequest) (*ai.WordComparison, *ai.EvaluationMeta, error)
	WriteLadder(ctx context.Context, term string, userID *uuid.UUID) (*ai.Ladder, *ai.EvaluationMeta, error)
	TranslateDefinitions(ctx context.Context, items []ai.DefinitionItem) (map[string]map[string]string, error)
	WriteVerbExamples(ctx context.Context, verbs []ai.VerbForms) (map[string]map[string]string, error)
	ProofreadUzbek(ctx context.Context, items []ai.UzbekText) (map[string]string, error)
}

// Entitlements is the slice of the subscription service that meters comparisons.
type Entitlements interface {
	ConsumeUsage(ctx context.Context, userID uuid.UUID, key string, amount int) error
	ReleaseUsage(ctx context.Context, userID uuid.UUID, key string, amount int) error
}

// Logger is the slice of *slog.Logger this package needs.
type Logger interface {
	Warn(msg string, args ...any)
}

type Deps struct {
	Pool  *pgxpool.Pool
	Redis *redis.Client
	// AI writes usage notes and comparisons. Nil turns both off; everything else works.
	AI    Writer
	Plans Entitlements
	Log   Logger
}

type Module struct {
	pool  *pgxpool.Pool
	redis *redis.Client
	ai    Writer
	plans Entitlements
	log   Logger
}

func NewModule(d Deps) *Module {
	return &Module{pool: d.Pool, redis: d.Redis, ai: d.AI, plans: d.Plans, log: d.Log}
}

// EntitlementCompare meters comparisons that have to be written; a cached one is free.
const EntitlementCompare = "vocabulary.ai_compare"

// comparePerHour is abuse protection on top of the plan's monthly budget.
const comparePerHour = 30

func (m *Module) RegisterRoutes(v1 *gin.RouterGroup) {
	practice := authz.RequirePermission(authz.PermLearningPractice)
	v := v1.Group("/vocabulary", practice)
	v.GET("/deck", m.deck)
	v.POST("/deck/:id", m.addToDeck)
	v.DELETE("/deck/:id", m.removeFromDeck)
	v.POST("/deck/:id/known", m.markKnown)
	v.GET("/library", m.library)
	v.GET("/words/:id", m.word)
	v.GET("/review", m.reviewQueue)
	v.POST("/review/:id", m.review)
	v.GET("/irregular-verbs", m.irregularVerbs)
	v.GET("/irregular-verbs/practice", m.irregularPractice)
	v.POST("/irregular-verbs/:id/answer", m.irregularAnswer)
	if m.redis != nil {
		limiter := ratelimit.NewRedisLimiter(m.redis)
		v.POST("/compare", m.userLimit(limiter, "vocabulary_compare", comparePerHour), m.compare)
		v.POST("/ladder", m.userLimit(limiter, "vocabulary_ladder", comparePerHour), m.ladder)
	} else {
		v.POST("/compare", m.compare)
		v.POST("/ladder", m.ladder)
	}
}

// userLimit rate limits by user, not IP: AI spend belongs to the account that asked.
func (m *Module) userLimit(l ratelimit.Limiter, bucket string, perHour int) gin.HandlerFunc {
	return func(c *gin.Context) {
		p, ok := authz.PrincipalFrom(c)
		if !ok {
			httpx.WriteError(c, apperr.Unauthorized("Authentication required"))
			return
		}
		d, err := l.Allow(c.Request.Context(), bucket+":"+p.UserID.String(), perHour, time.Hour)
		if err != nil {
			m.warn("vocabulary rate limiter unavailable, allowing request", "bucket", bucket, "error", err.Error())
			c.Next()
			return
		}
		if !d.Allowed {
			httpx.WriteError(c, apperr.New(apperr.CodeRateLimited,
				"You have compared a lot of words in the last hour. Try again a little later.").
				WithDetails(map[string]any{"retry_after_seconds": max(int(d.RetryAfter.Seconds()), 1)}))
			return
		}
		c.Next()
	}
}

func (m *Module) warn(msg string, args ...any) {
	if m.log != nil {
		m.log.Warn(msg, args...)
	}
}

// LevelText is a word explained for one level.
type LevelText struct {
	Definition string   `json:"definition"`
	Examples   []string `json:"examples"`
	SameAs     string   `json:"same_as,omitempty"`
}

// learnerLevel is the learner's CEFR level, B1 when they have none yet.
func (m *Module) learnerLevel(ctx context.Context, userID uuid.UUID) string {
	level := "B1"
	_ = m.pool.QueryRow(ctx, `
		SELECT l.code FROM profiles pr JOIN levels l ON l.id = pr.current_level_id WHERE pr.user_id = $1`,
		userID).Scan(&level)
	if len(level) > 2 {
		level = level[:2]
	}
	return level
}

type deckQuery struct {
	/** due | new | learning | mastered; empty is every word. */
	Filter string `form:"filter" binding:"omitempty,oneof=due new learning mastered"`
	/** word | phrase | collocation; empty is every kind. */
	Kind string `form:"kind" binding:"omitempty,oneof=word phrase collocation"`
	httpx.Pagination
}

func (m *Module) deck(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	var q deckQuery
	if err := httpx.BindQuery(c, &q); err != nil {
		httpx.Fail(c, err)
		return
	}
	q.Pagination = q.Pagination.Normalize()
	ctx := c.Request.Context()

	if err := m.topUp(ctx, p.UserID); err != nil {
		httpx.Fail(c, err)
		return
	}

	deck := Deck{Cards: []Card{}, LearnerLevel: m.learnerLevel(ctx, p.UserID)}
	err := m.pool.QueryRow(ctx, `
		SELECT count(*)::int,
		       count(*) FILTER (WHERE due_at <= now())::int,
		       count(*) FILTER (WHERE status = 'new')::int,
		       count(*) FILTER (WHERE status = 'learning')::int,
		       count(*) FILTER (WHERE status = 'reviewing')::int,
		       count(*) FILTER (WHERE status = 'mastered')::int,
		       (SELECT count(*)::int FROM vocabulary_reviews r JOIN vocabulary v ON v.id = r.vocabulary_id
		        WHERE r.user_id = $1 AND r.reviewed_at >= date_trunc('day', now()) AND ($2 = '' OR v.kind = $2))
		FROM user_vocabulary uv WHERE uv.user_id = $1
		  AND ($2 = '' OR EXISTS (SELECT 1 FROM vocabulary v WHERE v.id = uv.vocabulary_id AND v.kind = $2))`, p.UserID, q.Kind,
	).Scan(&deck.Summary.Total, &deck.Summary.Due, &deck.Summary.New, &deck.Summary.Learning,
		&deck.Summary.Reviewing, &deck.Summary.Mastered, &deck.Summary.ReviewedToday)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	filter := `TRUE`
	switch q.Filter {
	case "due":
		filter = `uv.due_at <= now()`
	case "new":
		filter = `uv.status = 'new'`
	case "learning":
		filter = `uv.status IN ('learning', 'reviewing')`
	case "mastered":
		filter = `uv.status = 'mastered'`
	}
	filter += ` AND ($2 = '' OR v.kind = $2)`
	var total int64
	if err := m.pool.QueryRow(ctx, `SELECT count(*) FROM user_vocabulary uv JOIN vocabulary v ON v.id = uv.vocabulary_id
		WHERE uv.user_id = $1 AND `+filter, p.UserID, q.Kind).Scan(&total); err != nil {
		httpx.Fail(c, err)
		return
	}
	cards, err := m.cards(ctx, p.UserID, filter+` ORDER BY uv.due_at ASC, v.term ASC OFFSET $3 LIMIT $4`,
		q.Kind, q.Offset(), q.PageSize)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	deck.Cards = cards
	httpx.OKWithMeta(c, deck, httpx.Meta{Page: q.Page, PageSize: q.PageSize, Total: total})
}

// cards reads the learner's cards matching the SQL tail, which may use $2 onwards.
func (m *Module) cards(ctx context.Context, userID uuid.UUID, tail string, args ...any) ([]Card, error) {
	rows, err := m.pool.Query(ctx, `
		SELECT v.id, v.term, v.part_of_speech, v.definition, v.examples, v.pronunciation_ipa, v.translations,
		       v.level_content, l.code, v.tags, v.collocations, v.kind,
		       uv.status, uv.repetitions, uv.due_at, uv.last_reviewed_at
		FROM user_vocabulary uv
		JOIN vocabulary v ON v.id = uv.vocabulary_id
		LEFT JOIN levels l ON l.id = v.level_id
		WHERE uv.user_id = $1 AND `+tail, append([]any{userID}, args...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Card{}
	for rows.Next() {
		var card Card
		var repetitions int
		if err := rows.Scan(&card.ID, &card.Term, &card.PartOfSpeech, &card.Definition, &card.Examples,
			&card.PronunciationIPA, &card.Translations, &card.LevelContent, &card.Level, &card.Tags, &card.Collocations, &card.Kind,
			&card.Status, &repetitions, &card.DueAt, &card.LastReviewedAt); err != nil {
			return nil, err
		}
		card.Mastery = Mastery(card.Status, repetitions)
		if card.Tags == nil {
			card.Tags = []string{}
		}
		if card.Collocations == nil {
			card.Collocations = []string{}
		}
		out = append(out, card)
	}
	return out, rows.Err()
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

// DELETE /vocabulary/deck/:id — take a word out of the learner's deck, with its progress.
func (m *Module) removeFromDeck(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid word id"))
		return
	}
	tag, err := m.pool.Exec(c.Request.Context(),
		`DELETE FROM user_vocabulary WHERE user_id = $1 AND vocabulary_id = $2`, p.UserID, id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, map[string]bool{"removed": tag.RowsAffected() > 0})
}

// POST /vocabulary/deck/:id/known — "I know it": the word is mastered and leaves the reviews.
// It is added to the deck first if it was not there, so a word known from the library counts.
func (m *Module) markKnown(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid word id"))
		return
	}
	tag, err := m.pool.Exec(c.Request.Context(), `
		INSERT INTO user_vocabulary (user_id, vocabulary_id, source, status, interval_days, due_at, last_reviewed_at)
		SELECT $1, v.id, 'manual', 'mastered', $3, now() + make_interval(days => $3), now()
		FROM vocabulary v WHERE v.id = $2 AND v.status = 'published'
		ON CONFLICT (user_id, vocabulary_id) DO UPDATE
		SET status = 'mastered', interval_days = GREATEST(user_vocabulary.interval_days, $3),
		    due_at = now() + make_interval(days => GREATEST(user_vocabulary.interval_days, $3)), last_reviewed_at = now()`,
		p.UserID, id, masteredInterval)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Fail(c, apperr.NotFound("Word"))
		return
	}
	httpx.OK(c, map[string]any{"status": "mastered", "mastery": 100})
}
