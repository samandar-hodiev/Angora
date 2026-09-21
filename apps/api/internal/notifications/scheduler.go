package notifications

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
)

// Scheduler sends the notifications nobody triggers: the ones that are about time passing
// rather than about something the learner just did.
//
// It runs in the worker process on a ticker rather than as a queued job, because these are
// sweeps over "who is in this state right now", not work items. Two properties keep it
// honest:
//
//   - Every sweep re-reads the notifications table to find who already has today's
//     message. A restart, a second worker or a missed tick can therefore never produce a
//     duplicate; there is no in-memory "already sent" set to lose.
//   - A reminder is only sent during the learner's own evening. A streak nudge that
//     arrives at four in the morning is not a nudge, it is a reason to turn notifications
//     off.
type Scheduler struct {
	svc      *Service
	log      *slog.Logger
	Interval time.Duration
}

func NewScheduler(svc *Service, log *slog.Logger) *Scheduler {
	return &Scheduler{svc: svc, log: log, Interval: time.Hour}
}

// Run sweeps until the context is cancelled.
func (s *Scheduler) Run(ctx context.Context) {
	ticker := time.NewTicker(s.Interval)
	defer ticker.Stop()
	for {
		s.runOnce(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Scheduler) runOnce(ctx context.Context) {
	expiring, err := s.SendExpiryWarnings(ctx)
	if err != nil {
		s.log.Error("subscription expiry sweep failed", slog.String("error", err.Error()))
	}
	streaks, err := s.SendStreakReminders(ctx)
	if err != nil {
		s.log.Error("streak reminder sweep failed", slog.String("error", err.Error()))
	}
	if expiring+streaks > 0 {
		s.log.Info("scheduled notifications sent",
			slog.Int("subscription_expiring", expiring), slog.Int("streak_reminder", streaks))
	}
}

// expiryWindowDays is how much warning someone gets before a paid period ends. Long enough
// to act on, short enough that it is still about this subscription.
const expiryWindowDays = 3

// SendExpiryWarnings tells learners whose paid period ends soon. Exported so the sweep can
// be run and asserted on directly rather than waiting for a ticker.
func (s *Scheduler) SendExpiryWarnings(ctx context.Context) (int, error) {
	rows, err := s.svc.pool.Query(ctx, `
		SELECT s.user_id, p.name, greatest(0, ceil(extract(epoch FROM s.current_period_end - now()) / 86400))::int
		FROM subscriptions s
		JOIN subscription_plans p ON p.id = s.plan_id
		WHERE s.status IN ('trialing', 'active')
		  AND NOT s.cancel_at_period_end
		  AND s.current_period_end IS NOT NULL
		  AND s.current_period_end > now()
		  AND s.current_period_end <= now() + make_interval(days => $1)
		  AND NOT EXISTS (
		      SELECT 1 FROM notifications n
		      WHERE n.user_id = s.user_id AND n.template_code = $2
		        AND n.created_at > now() - make_interval(days => $1 + 1))`,
		expiryWindowDays, CodeSubscriptionExpiring)
	if err != nil {
		return 0, err
	}
	type target struct {
		userID uuid.UUID
		plan   string
		days   int
	}
	var targets []target
	for rows.Next() {
		var t target
		if err := rows.Scan(&t.userID, &t.plan, &t.days); err != nil {
			rows.Close()
			return 0, err
		}
		targets = append(targets, t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	sent := 0
	for _, t := range targets {
		if err := s.svc.Notify(ctx, t.userID, CodeSubscriptionExpiring, map[string]any{
			"plan": t.plan, "days": t.days,
		}); err != nil {
			s.log.Warn("expiry warning failed",
				slog.String("user_id", t.userID.String()), slog.String("error", err.Error()))
			continue
		}
		sent++
	}
	return sent, nil
}

// SendStreakReminders nudges learners who have a streak going and have not practised
// today, in their own evening.
func (s *Scheduler) SendStreakReminders(ctx context.Context) (int, error) {
	rows, err := s.svc.pool.Query(ctx, `
		SELECT st.user_id, st.current_days
		FROM streaks st
		JOIN profiles pr ON pr.user_id = st.user_id
		WHERE st.current_days >= 2
		  AND (st.last_activity_date IS NULL OR st.last_activity_date < (now() AT TIME ZONE pr.timezone)::date)
		  AND extract(hour FROM now() AT TIME ZONE pr.timezone) BETWEEN 18 AND 20
		  AND NOT EXISTS (
		      SELECT 1 FROM notifications n
		      WHERE n.user_id = st.user_id AND n.template_code = $1
		        AND n.created_at >= (now() AT TIME ZONE pr.timezone)::date)`,
		CodeStreakReminder)
	if err != nil {
		return 0, err
	}
	type target struct {
		userID uuid.UUID
		days   int
	}
	var targets []target
	for rows.Next() {
		var t target
		if err := rows.Scan(&t.userID, &t.days); err != nil {
			rows.Close()
			return 0, err
		}
		targets = append(targets, t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	sent := 0
	for _, t := range targets {
		if err := s.svc.Notify(ctx, t.userID, CodeStreakReminder, map[string]any{"days": t.days}); err != nil {
			s.log.Warn("streak reminder failed",
				slog.String("user_id", t.userID.String()), slog.String("error", err.Error()))
			continue
		}
		sent++
	}
	return sent, nil
}
