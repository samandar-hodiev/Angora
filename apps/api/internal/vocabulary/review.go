package vocabulary

import (
	"errors"
	"math"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Spaced repetition.
//
// A review is rated again, hard, good or easy. SM-2 turns the rating into the next interval: a
// word forgotten comes back in ten minutes, a word remembered comes back a little later each
// time it is remembered, and a word remembered easily jumps further. The status follows the
// interval, so "mastered" means remembered across three weeks, not ticked once.

// Ratings map to SM-2 quality grades.
var ratings = map[string]int{"again": 1, "hard": 3, "good": 4, "easy": 5}

const (
	// masteredInterval is how long a word must stay remembered to count as mastered.
	masteredInterval  = 21
	reviewingInterval = 4
	// againDelay is when a forgotten word comes back, within the same session.
	againDelay = 10 * time.Minute
)

// SRSState is a card's spaced-repetition state.
type SRSState struct {
	EaseFactor   float64
	IntervalDays int
	Repetitions  int
}

// Schedule applies one review of the given SM-2 quality and returns the new state, the status
// it puts the word in, and how long until it is due again.
func Schedule(s SRSState, quality int) (SRSState, string, time.Duration) {
	if s.EaseFactor < 1.3 {
		s.EaseFactor = 2.5
	}
	q := float64(quality)
	s.EaseFactor = math.Max(1.3, s.EaseFactor+(0.1-(5-q)*(0.08+(5-q)*0.02)))
	if quality < 3 {
		s.Repetitions = 0
		s.IntervalDays = 0
		return s, "learning", againDelay
	}
	s.Repetitions++
	switch {
	case s.Repetitions == 1:
		s.IntervalDays = 1
	case s.Repetitions == 2:
		s.IntervalDays = 3
	default:
		s.IntervalDays = int(math.Round(float64(max(s.IntervalDays, 1)) * s.EaseFactor))
	}
	switch quality {
	case 3:
		// Remembered with effort: grow slowly.
		s.IntervalDays = max(1, int(math.Round(float64(s.IntervalDays)*0.8)))
	case 5:
		s.IntervalDays = int(math.Round(float64(s.IntervalDays) * 1.3))
		if s.Repetitions == 1 {
			s.IntervalDays = 4
		}
	}
	s.IntervalDays = min(s.IntervalDays, 365)
	status := "learning"
	switch {
	case s.IntervalDays >= masteredInterval:
		status = "mastered"
	case s.IntervalDays >= reviewingInterval:
		status = "reviewing"
	}
	return s, status, time.Duration(s.IntervalDays) * 24 * time.Hour
}

type reviewQueue struct {
	Cards []Card `json:"cards"`
	/** How many more are due after these. */
	Remaining int `json:"remaining"`
}

type reviewQueueQuery struct {
	Limit int `form:"limit" binding:"omitempty,min=1,max=50"`
}

// GET /vocabulary/review — the words due now, oldest first, new words after the due ones.
func (m *Module) reviewQueue(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	var q reviewQueueQuery
	if err := httpx.BindQuery(c, &q); err != nil {
		httpx.Fail(c, err)
		return
	}
	if q.Limit == 0 {
		q.Limit = 20
	}
	ctx := c.Request.Context()
	if err := m.topUp(ctx, p.UserID); err != nil {
		httpx.Fail(c, err)
		return
	}
	due := `uv.due_at <= now()`
	cards, err := m.cards(ctx, p.UserID, due+` ORDER BY (uv.status = 'new'), uv.due_at, v.term LIMIT $2`, q.Limit)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var total int
	if err := m.pool.QueryRow(ctx, `SELECT count(*)::int FROM user_vocabulary uv WHERE uv.user_id = $1 AND `+due,
		p.UserID).Scan(&total); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, reviewQueue{Cards: cards, Remaining: max(total-len(cards), 0)})
}

type reviewInput struct {
	Rating     string `json:"rating" binding:"required,oneof=again hard good easy"`
	ResponseMs *int   `json:"response_ms" binding:"omitempty,min=0,max=600000"`
}

type reviewResult struct {
	Status       string    `json:"status"`
	Mastery      int       `json:"mastery"`
	IntervalDays int       `json:"interval_days"`
	DueAt        time.Time `json:"due_at"`
}

// POST /vocabulary/review/:id — record one review and schedule the next.
func (m *Module) review(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid word id"))
		return
	}
	var in reviewInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	ctx := c.Request.Context()
	tx, err := m.pool.Begin(ctx)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var s SRSState
	err = tx.QueryRow(ctx, `
		SELECT ease_factor::float8, interval_days, repetitions FROM user_vocabulary
		WHERE user_id = $1 AND vocabulary_id = $2 FOR UPDATE`, p.UserID, id).Scan(&s.EaseFactor, &s.IntervalDays, &s.Repetitions)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.NotFound("Word in your deck"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	quality := ratings[in.Rating]
	next, status, wait := Schedule(s, quality)
	out := reviewResult{Status: status, Mastery: Mastery(status, next.Repetitions), IntervalDays: next.IntervalDays}
	if err := tx.QueryRow(ctx, `
		UPDATE user_vocabulary SET ease_factor = $3, interval_days = $4, repetitions = $5, status = $6,
		       due_at = now() + make_interval(secs => $7), last_reviewed_at = now()
		WHERE user_id = $1 AND vocabulary_id = $2 RETURNING due_at`,
		p.UserID, id, next.EaseFactor, next.IntervalDays, next.Repetitions, status, wait.Seconds()).Scan(&out.DueAt); err != nil {
		httpx.Fail(c, err)
		return
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO vocabulary_reviews (user_id, vocabulary_id, rating, response_ms) VALUES ($1, $2, $3, $4)`,
		p.UserID, id, quality, in.ResponseMs); err != nil {
		httpx.Fail(c, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, out)
}
