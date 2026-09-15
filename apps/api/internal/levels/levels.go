// Package levels records and serves a learner's CEFR level history.
//
// Four kinds of statements are kept separately and never overwritten:
//
//	self_reported    what the learner says their level is
//	placement_start  the level they think they are closest to before a placement test
//	assessed         what an assessment estimated
//	estimated        Engora's current best estimate (assessments now, real practice later)
//
// profiles.current_level_id mirrors the latest estimate's base level so existing reads
// (dashboard, content filters) stay cheap.
package levels

import (
	"context"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

const (
	KindSelfReported   = "self_reported"
	KindPlacementStart = "placement_start"
	KindAssessed       = "assessed"
	KindEstimated      = "estimated"
)

const (
	SourceOnboarding = "onboarding"
	SourceAssessment = "assessment"
)

// Querier is satisfied by *pgxpool.Pool and pgx.Tx, so callers can record levels inside
// their own transaction.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Entry struct {
	Kind       string     `json:"kind"`
	CEFR       cefr.Level `json:"cefr"`
	SourceType string     `json:"source_type"`
	SourceID   *uuid.UUID `json:"source_id"`
	Confidence *float64   `json:"confidence"`
	CreatedAt  time.Time  `json:"created_at"`
}

type Summary struct {
	SelfReported     *Entry  `json:"self_reported"`
	PlacementStart   *Entry  `json:"placement_start"`
	Assessed         *Entry  `json:"assessed"`
	CurrentEstimated *Entry  `json:"current_estimated"`
	History          []Entry `json:"history"`
}

// Record appends a level statement. An estimate also updates the profile's current level.
func Record(ctx context.Context, q Querier, userID uuid.UUID, e Entry) error {
	if !e.CEFR.Valid() {
		return fmt.Errorf("record level: invalid level %+v", e.CEFR)
	}
	if _, err := q.Exec(ctx, `
		INSERT INTO user_levels (user_id, kind, cefr, source_type, source_id, confidence)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		userID, e.Kind, e.CEFR.String(), e.SourceType, e.SourceID, e.Confidence); err != nil {
		return fmt.Errorf("record %s level: %w", e.Kind, err)
	}
	if e.Kind == KindEstimated {
		if _, err := q.Exec(ctx, `
			UPDATE profiles SET current_level_id = (SELECT id FROM levels WHERE code = $2) WHERE user_id = $1`,
			userID, e.CEFR.BaseCode()); err != nil {
			return fmt.Errorf("update current level: %w", err)
		}
	}
	return nil
}

// Load returns the latest statement of each kind plus recent history (newest first).
func Load(ctx context.Context, q Querier, userID uuid.UUID) (Summary, error) {
	rows, err := q.Query(ctx, `
		SELECT kind, cefr, source_type, source_id, confidence::float8, created_at
		FROM user_levels WHERE user_id = $1
		ORDER BY created_at DESC, id DESC
		LIMIT 50`, userID)
	if err != nil {
		return Summary{}, err
	}
	defer rows.Close()

	s := Summary{History: []Entry{}}
	for rows.Next() {
		var e Entry
		var code string
		if err := rows.Scan(&e.Kind, &code, &e.SourceType, &e.SourceID, &e.Confidence, &e.CreatedAt); err != nil {
			return Summary{}, err
		}
		if e.CEFR, err = cefr.Parse(code); err != nil {
			return Summary{}, err
		}
		entry := e
		latest := map[string]**Entry{
			KindSelfReported: &s.SelfReported, KindPlacementStart: &s.PlacementStart,
			KindAssessed: &s.Assessed, KindEstimated: &s.CurrentEstimated,
		}[e.Kind]
		if latest != nil && *latest == nil {
			*latest = &entry
		}
		s.History = append(s.History, e)
	}
	return s, rows.Err()
}

type Module struct {
	pool *pgxpool.Pool
}

func NewModule(pool *pgxpool.Pool) *Module { return &Module{pool: pool} }

func (m *Module) RegisterRoutes(v1 *gin.RouterGroup) {
	v1.GET("/levels/me", authz.RequirePermission(authz.PermProfileManageOwn), func(c *gin.Context) {
		p, err := authz.CurrentPrincipal(c)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		summary, err := Load(c.Request.Context(), m.pool, p.UserID)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		httpx.OK(c, summary)
	})
}
