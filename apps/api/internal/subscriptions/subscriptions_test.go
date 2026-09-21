package subscriptions

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
)

func ptr[T any](v T) *T { return &v }

var freePlan = Plan{
	ID: uuid.New(), Code: "free", Name: "Free", IsDefault: true,
	Entitlements: []PlanEntitlement{
		{Key: "writing.practice", Kind: KindFeature},
		{Key: "speaking.practice", Kind: KindFeature},
		{Key: "speaking.evaluations", Kind: KindLimit, Limit: ptr(3), Period: ptr(PeriodDay)},
	},
}

var proPlan = Plan{
	ID: uuid.New(), Code: "pro", Name: "Pro",
	Entitlements: []PlanEntitlement{
		{Key: "ai_coach.chat", Kind: KindFeature},
		{Key: "speaking.evaluations", Kind: KindLimit, Limit: nil, Period: ptr(PeriodDay)},
	},
}

func TestWindow(t *testing.T) {
	// Wednesday 2026-09-16 15:30 UTC
	now := time.Date(2026, 9, 16, 15, 30, 0, 0, time.UTC)

	cases := []struct {
		period    Period
		wantStart time.Time
		wantEnd   *time.Time
	}{
		{PeriodDay, time.Date(2026, 9, 16, 0, 0, 0, 0, time.UTC), ptr(time.Date(2026, 9, 17, 0, 0, 0, 0, time.UTC))},
		{PeriodWeek, time.Date(2026, 9, 14, 0, 0, 0, 0, time.UTC), ptr(time.Date(2026, 9, 21, 0, 0, 0, 0, time.UTC))},
		{PeriodMonth, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC), ptr(time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC))},
		{PeriodLifetime, time.Unix(0, 0).UTC(), nil},
	}
	for _, tc := range cases {
		start, end := Window(tc.period, now)
		if !start.Equal(tc.wantStart) {
			t.Errorf("%s start = %s, want %s", tc.period, start, tc.wantStart)
		}
		if (end == nil) != (tc.wantEnd == nil) || (end != nil && !end.Equal(*tc.wantEnd)) {
			t.Errorf("%s end = %v, want %v", tc.period, end, tc.wantEnd)
		}
	}
}

func TestResolveFreePlan(t *testing.T) {
	now := time.Date(2026, 9, 16, 10, 0, 0, 0, time.UTC)
	dayStart, _ := Window(PeriodDay, now)
	usage := map[UsageKey]int{
		{Entitlement: "speaking.evaluations", PeriodStart: dayStart}:                   2,
		{Entitlement: "speaking.evaluations", PeriodStart: dayStart.AddDate(0, 0, -1)}: 3, // yesterday: ignored
	}

	e := Resolve(freePlan, nil, usage, now)

	if e.Status != "free" || e.PlanCode != "free" {
		t.Errorf("status/plan = %s/%s", e.Status, e.PlanCode)
	}
	if len(e.Features) != 2 || e.Features[0] != "speaking.practice" {
		t.Errorf("features must be sorted and complete: %v", e.Features)
	}
	if e.HasFeature("ai_coach.chat") {
		t.Error("free plan must not include ai_coach.chat")
	}
	lim := e.Limits["speaking.evaluations"]
	if lim.Used != 2 || lim.Remaining == nil || *lim.Remaining != 1 {
		t.Errorf("limit state = %+v", lim)
	}
}

func TestResolveUnlimited(t *testing.T) {
	sub := &Subscription{Status: "active", PlanID: proPlan.ID}
	e := Resolve(proPlan, sub, nil, time.Now())
	if e.Status != "active" {
		t.Errorf("status = %s", e.Status)
	}
	lim := e.Limits["speaking.evaluations"]
	if lim.Limit != nil || lim.Remaining != nil {
		t.Errorf("unlimited entitlement must have nil limit/remaining: %+v", lim)
	}
}

type memStore struct {
	sub   *Subscription
	usage map[UsageKey]int
}

func (m *memStore) PublicPlans(context.Context) ([]Plan, error) {
	return []Plan{freePlan, proPlan}, nil
}
func (m *memStore) DefaultPlan(context.Context) (Plan, error) { return freePlan, nil }
func (m *memStore) PlanByID(_ context.Context, id uuid.UUID) (Plan, error) {
	if id == proPlan.ID {
		return proPlan, nil
	}
	return freePlan, nil
}
func (m *memStore) LiveSubscription(context.Context, uuid.UUID, time.Time) (*Subscription, error) {
	return m.sub, nil
}
func (m *memStore) Usage(context.Context, uuid.UUID, time.Time) (map[UsageKey]int, error) {
	return m.usage, nil
}
func (m *memStore) IncrementUsage(_ context.Context, _ uuid.UUID, key UsageKey, amount int, limit *int) (bool, error) {
	if limit != nil && m.usage[key]+amount > *limit {
		return false, nil
	}
	m.usage[key] += amount
	return true, nil
}
func (m *memStore) DecrementUsage(_ context.Context, _ uuid.UUID, key UsageKey, amount int) error {
	if m.usage[key] -= amount; m.usage[key] < 0 {
		m.usage[key] = 0
	}
	return nil
}

func TestRequireFeature(t *testing.T) {
	store := &memStore{usage: map[UsageKey]int{}}
	svc := NewService(store)
	user := uuid.New()

	err := svc.RequireFeature(context.Background(), user, "ai_coach.chat")
	if !apperr.Is(err, apperr.CodeEntitlementRequired) {
		t.Fatalf("free user: err = %v, want ENTITLEMENT_REQUIRED", err)
	}

	store.sub = &Subscription{Status: "active", PlanID: proPlan.ID}
	if err := svc.RequireFeature(context.Background(), user, "ai_coach.chat"); err != nil {
		t.Fatalf("pro user: err = %v", err)
	}
}

func TestConsumeUsageEnforcesLimit(t *testing.T) {
	store := &memStore{usage: map[UsageKey]int{}}
	svc := NewService(store)
	user := uuid.New()
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		if err := svc.ConsumeUsage(ctx, user, "speaking.evaluations", 1); err != nil {
			t.Fatalf("use %d: %v", i+1, err)
		}
	}
	if err := svc.ConsumeUsage(ctx, user, "speaking.evaluations", 1); !apperr.Is(err, apperr.CodeUsageLimitReached) {
		t.Fatalf("4th use: err = %v, want USAGE_LIMIT_REACHED", err)
	}
	if err := svc.ConsumeUsage(ctx, user, "ai_coach.messages", 1); !apperr.Is(err, apperr.CodeEntitlementRequired) {
		t.Fatalf("limit not in plan: err = %v, want ENTITLEMENT_REQUIRED", err)
	}
}

func TestUnlimitedPlanIsNotMetered(t *testing.T) {
	// A plan that grants the limit with no value (the "unlimited" tier) must never refuse
	// the learner, however much they use.
	store := &memStore{usage: map[UsageKey]int{}, sub: &Subscription{Status: "active", PlanID: proPlan.ID}}
	svc := NewService(store)
	ctx := context.Background()
	user := uuid.New()

	for i := 0; i < 500; i++ {
		if err := svc.ConsumeUsage(ctx, user, "speaking.evaluations", 1); err != nil {
			t.Fatalf("unlimited plan refused use %d: %v", i+1, err)
		}
	}
}

func TestReleaseUsageRefundsFailedWork(t *testing.T) {
	// A provider failure must not cost the learner a unit of their quota.
	store := &memStore{usage: map[UsageKey]int{}}
	svc := NewService(store)
	ctx := context.Background()
	user := uuid.New()

	for i := 0; i < 3; i++ {
		if err := svc.ConsumeUsage(ctx, user, "speaking.evaluations", 1); err != nil {
			t.Fatalf("use %d: %v", i+1, err)
		}
	}
	if err := svc.ConsumeUsage(ctx, user, "speaking.evaluations", 1); !apperr.Is(err, apperr.CodeUsageLimitReached) {
		t.Fatalf("free plan should be exhausted, got %v", err)
	}

	if err := svc.ReleaseUsage(ctx, user, "speaking.evaluations", 1); err != nil {
		t.Fatalf("release: %v", err)
	}
	if err := svc.ConsumeUsage(ctx, user, "speaking.evaluations", 1); err != nil {
		t.Fatalf("after a refund the learner should have one unit back, got %v", err)
	}
}

func TestReleaseUsageNeverGoesNegative(t *testing.T) {
	store := &memStore{usage: map[UsageKey]int{}}
	svc := NewService(store)
	ctx := context.Background()
	user := uuid.New()

	if err := svc.ReleaseUsage(ctx, user, "speaking.evaluations", 5); err != nil {
		t.Fatalf("refunding unused quota: %v", err)
	}
	for key, used := range store.usage {
		if used < 0 {
			t.Fatalf("%s went negative: %d", key.Entitlement, used)
		}
	}

	// A refund for something the plan does not meter is a no-op, not an error.
	if err := svc.ReleaseUsage(ctx, user, "ai_coach.messages", 1); err != nil {
		t.Fatalf("refund for an unmetered entitlement: %v", err)
	}
}
