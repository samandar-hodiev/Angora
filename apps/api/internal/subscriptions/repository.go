package subscriptions

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
)

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore {
	return &PostgresStore{pool: pool}
}

var errNoDefaultPlan = errors.New("no default subscription plan configured")

const planColumns = `id, code, name, description, billing_interval, price_cents, currency, trial_days, is_default`

func (s *PostgresStore) PublicPlans(ctx context.Context) ([]Plan, error) {
	return s.plans(ctx, `WHERE is_public AND is_active ORDER BY sort_order, price_cents`)
}

func (s *PostgresStore) DefaultPlan(ctx context.Context) (Plan, error) {
	plans, err := s.plans(ctx, `WHERE is_default AND is_active`)
	if err != nil {
		return Plan{}, err
	}
	if len(plans) == 0 {
		return Plan{}, errNoDefaultPlan
	}
	return plans[0], nil
}

func (s *PostgresStore) PlanByID(ctx context.Context, id uuid.UUID) (Plan, error) {
	plans, err := s.plans(ctx, `WHERE id = $1`, id)
	if err != nil {
		return Plan{}, err
	}
	if len(plans) == 0 {
		return Plan{}, errors.New("subscription plan not found")
	}
	return plans[0], nil
}

func (s *PostgresStore) plans(ctx context.Context, where string, args ...any) ([]Plan, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+planColumns+` FROM subscription_plans `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	plans := []Plan{}
	index := map[uuid.UUID]int{}
	for rows.Next() {
		var p Plan
		if err := rows.Scan(&p.ID, &p.Code, &p.Name, &p.Description, &p.BillingInterval,
			&p.PriceCents, &p.Currency, &p.TrialDays, &p.IsDefault); err != nil {
			return nil, err
		}
		p.Entitlements = []PlanEntitlement{}
		index[p.ID] = len(plans)
		plans = append(plans, p)
	}
	if err := rows.Err(); err != nil || len(plans) == 0 {
		return plans, err
	}

	ids := make([]uuid.UUID, 0, len(plans))
	for _, p := range plans {
		ids = append(ids, p.ID)
	}
	erows, err := s.pool.Query(ctx, `
		SELECT pe.plan_id, e.key, e.kind, pe.limit_value, pe.limit_period
		FROM plan_entitlements pe
		JOIN entitlements e ON e.key = pe.entitlement_key
		WHERE pe.plan_id = ANY ($1)
		ORDER BY e.key`, ids)
	if err != nil {
		return nil, err
	}
	defer erows.Close()
	for erows.Next() {
		var planID uuid.UUID
		var pe PlanEntitlement
		if err := erows.Scan(&planID, &pe.Key, &pe.Kind, &pe.Limit, &pe.Period); err != nil {
			return nil, err
		}
		i := index[planID]
		plans[i].Entitlements = append(plans[i].Entitlements, pe)
	}
	return plans, erows.Err()
}

func (s *PostgresStore) LiveSubscription(ctx context.Context, userID uuid.UUID, now time.Time) (*Subscription, error) {
	var sub Subscription
	err := s.pool.QueryRow(ctx, `
		SELECT id, plan_id, status, provider, current_period_start, current_period_end,
		       trial_ends_at, cancel_at_period_end
		FROM subscriptions
		WHERE user_id = $1
		  AND status IN ('trialing', 'active', 'past_due')
		  AND (current_period_end IS NULL OR current_period_end > $2)
		ORDER BY created_at DESC
		LIMIT 1`, userID, now,
	).Scan(&sub.ID, &sub.PlanID, &sub.Status, &sub.Provider, &sub.CurrentPeriodStart,
		&sub.CurrentPeriodEnd, &sub.TrialEndsAt, &sub.CancelAtPeriodEnd)
	if database.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &sub, nil
}

func (s *PostgresStore) Usage(ctx context.Context, userID uuid.UUID, since time.Time) (map[UsageKey]int, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT entitlement_key, period_start, used FROM usage_counters
		WHERE user_id = $1 AND (period_start >= $2 OR period_start = to_timestamp(0))`,
		userID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	usage := map[UsageKey]int{}
	for rows.Next() {
		var k UsageKey
		var used int
		if err := rows.Scan(&k.Entitlement, &k.PeriodStart, &used); err != nil {
			return nil, err
		}
		k.PeriodStart = k.PeriodStart.UTC()
		usage[k] = used
	}
	return usage, rows.Err()
}

func (s *PostgresStore) IncrementUsage(ctx context.Context, userID uuid.UUID, key UsageKey, amount int, limit *int) (bool, error) {
	var used int
	err := s.pool.QueryRow(ctx, `
		INSERT INTO usage_counters (user_id, entitlement_key, period_start, used)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, entitlement_key, period_start) DO UPDATE
			SET used = usage_counters.used + EXCLUDED.used, updated_at = now()
			WHERE $5::int IS NULL OR usage_counters.used + EXCLUDED.used <= $5::int
		RETURNING used`,
		userID, key.Entitlement, key.PeriodStart, amount, limit,
	).Scan(&used)
	if database.IsNotFound(err) {
		return false, nil
	}
	return err == nil, err
}
