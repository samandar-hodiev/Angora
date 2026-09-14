// Package subscriptions resolves what a user is allowed to do.
//
// The rest of the system asks two questions only:
//
//	RequireFeature(user, "ai_coach.chat")         -> allowed or ENTITLEMENT_REQUIRED
//	ConsumeUsage(user, "speaking.evaluations", 1) -> allowed or USAGE_LIMIT_REACHED
//
// Plans, prices and limits are data (subscription_plans, plan_entitlements). Nothing
// checks plan codes like "pro", so plans can be added, renamed or re-priced without code.
package subscriptions

import (
	"sort"
	"time"

	"github.com/google/uuid"
)

type Kind string

const (
	KindFeature Kind = "feature"
	KindLimit   Kind = "limit"
)

type Period string

const (
	PeriodDay      Period = "day"
	PeriodWeek     Period = "week"
	PeriodMonth    Period = "month"
	PeriodLifetime Period = "lifetime"
)

type PlanEntitlement struct {
	Key    string  `json:"key"`
	Kind   Kind    `json:"kind"`
	Limit  *int    `json:"limit"` // nil = unlimited (limits only)
	Period *Period `json:"period"`
}

type Plan struct {
	ID              uuid.UUID         `json:"id"`
	Code            string            `json:"code"`
	Name            string            `json:"name"`
	Description     string            `json:"description"`
	BillingInterval string            `json:"billing_interval"`
	PriceCents      int               `json:"price_cents"`
	Currency        string            `json:"currency"`
	TrialDays       int               `json:"trial_days"`
	IsDefault       bool              `json:"is_default"`
	Entitlements    []PlanEntitlement `json:"entitlements"`
}

type Subscription struct {
	ID                 uuid.UUID  `json:"id"`
	PlanID             uuid.UUID  `json:"plan_id"`
	Status             string     `json:"status"`
	Provider           string     `json:"provider"`
	CurrentPeriodStart time.Time  `json:"current_period_start"`
	CurrentPeriodEnd   *time.Time `json:"current_period_end"`
	TrialEndsAt        *time.Time `json:"trial_ends_at"`
	CancelAtPeriodEnd  bool       `json:"cancel_at_period_end"`
}

type LimitState struct {
	Limit     *int       `json:"limit"`
	Used      int        `json:"used"`
	Remaining *int       `json:"remaining"`
	Period    Period     `json:"period"`
	ResetsAt  *time.Time `json:"resets_at"`
}

// Entitlements is what clients receive. Web and mobile render features and limits from
// this object; they never infer them from the plan name.
type Entitlements struct {
	PlanCode string                `json:"plan_code"`
	PlanName string                `json:"plan_name"`
	Status   string                `json:"status"` // free | trialing | active | past_due
	Features []string              `json:"features"`
	Limits   map[string]LimitState `json:"limits"`
}

func (e Entitlements) HasFeature(key string) bool {
	for _, f := range e.Features {
		if f == key {
			return true
		}
	}
	return false
}

// UsageKey identifies a counter window.
type UsageKey struct {
	Entitlement string
	PeriodStart time.Time
}

// Resolve computes entitlements for a plan, an optional live subscription and current
// usage counters. It is pure so the rules are unit-testable without a database.
func Resolve(plan Plan, sub *Subscription, usage map[UsageKey]int, now time.Time) Entitlements {
	status := "free"
	if sub != nil {
		status = sub.Status
	}
	e := Entitlements{
		PlanCode: plan.Code,
		PlanName: plan.Name,
		Status:   status,
		Features: []string{},
		Limits:   map[string]LimitState{},
	}
	for _, pe := range plan.Entitlements {
		switch pe.Kind {
		case KindFeature:
			e.Features = append(e.Features, pe.Key)
		case KindLimit:
			period := PeriodLifetime
			if pe.Period != nil {
				period = *pe.Period
			}
			start, resets := Window(period, now)
			used := usage[UsageKey{Entitlement: pe.Key, PeriodStart: start}]
			state := LimitState{Limit: pe.Limit, Used: used, Period: period, ResetsAt: resets}
			if pe.Limit != nil {
				remaining := max(*pe.Limit-used, 0)
				state.Remaining = &remaining
			}
			e.Limits[pe.Key] = state
		}
	}
	sort.Strings(e.Features)
	return e
}

// Window returns the start of the usage window containing now and when it resets.
// Windows are computed in UTC for now; per-learner timezones can be introduced here
// without touching callers.
func Window(period Period, now time.Time) (time.Time, *time.Time) {
	now = now.UTC()
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	var start, end time.Time
	switch period {
	case PeriodDay:
		start, end = day, day.AddDate(0, 0, 1)
	case PeriodWeek:
		offset := (int(day.Weekday()) + 6) % 7 // Monday = 0
		start = day.AddDate(0, 0, -offset)
		end = start.AddDate(0, 0, 7)
	case PeriodMonth:
		start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		end = start.AddDate(0, 1, 0)
	default:
		return time.Unix(0, 0).UTC(), nil
	}
	return start, &end
}
