package subscriptions

import (
	"context"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

type Store interface {
	PublicPlans(ctx context.Context) ([]Plan, error)
	DefaultPlan(ctx context.Context) (Plan, error)
	PlanByID(ctx context.Context, id uuid.UUID) (Plan, error)
	LiveSubscription(ctx context.Context, userID uuid.UUID, now time.Time) (*Subscription, error)
	Usage(ctx context.Context, userID uuid.UUID, since time.Time) (map[UsageKey]int, error)
	// IncrementUsage adds amount if the result stays within limit (nil = unlimited) and
	// reports whether it did. It must be atomic.
	IncrementUsage(ctx context.Context, userID uuid.UUID, key UsageKey, amount int, limit *int) (bool, error)
}

type Service struct {
	store Store
	now   func() time.Time
}

func NewService(store Store) *Service {
	return &Service{store: store, now: time.Now}
}

func (s *Service) Plans(ctx context.Context) ([]Plan, error) {
	return s.store.PublicPlans(ctx)
}

// Current returns the live subscription (nil on the default plan) and entitlements.
func (s *Service) Current(ctx context.Context, userID uuid.UUID) (*Subscription, Entitlements, error) {
	now := s.now()
	sub, err := s.store.LiveSubscription(ctx, userID, now)
	if err != nil {
		return nil, Entitlements{}, fmt.Errorf("load subscription: %w", err)
	}
	var plan Plan
	if sub != nil {
		plan, err = s.store.PlanByID(ctx, sub.PlanID)
	} else {
		plan, err = s.store.DefaultPlan(ctx)
	}
	if err != nil {
		return nil, Entitlements{}, fmt.Errorf("load plan: %w", err)
	}
	// The longest window is a month; lifetime counters use the epoch start.
	usage, err := s.store.Usage(ctx, userID, now.AddDate(0, -1, -1))
	if err != nil {
		return nil, Entitlements{}, fmt.Errorf("load usage: %w", err)
	}
	return sub, Resolve(plan, sub, usage, now), nil
}

func (s *Service) EntitlementsFor(ctx context.Context, userID uuid.UUID) (Entitlements, error) {
	_, e, err := s.Current(ctx, userID)
	return e, err
}

// RequireFeature returns ENTITLEMENT_REQUIRED if the user's plan lacks the feature.
func (s *Service) RequireFeature(ctx context.Context, userID uuid.UUID, key string) error {
	e, err := s.EntitlementsFor(ctx, userID)
	if err != nil {
		return err
	}
	if !e.HasFeature(key) {
		return apperr.New(apperr.CodeEntitlementRequired, "Your plan does not include this feature").
			WithDetails(map[string]any{"entitlement": key})
	}
	return nil
}

// ConsumeUsage records usage of a metered entitlement, refusing when the limit is reached.
func (s *Service) ConsumeUsage(ctx context.Context, userID uuid.UUID, key string, amount int) error {
	e, err := s.EntitlementsFor(ctx, userID)
	if err != nil {
		return err
	}
	state, ok := e.Limits[key]
	if !ok {
		return apperr.New(apperr.CodeEntitlementRequired, "Your plan does not include this feature").
			WithDetails(map[string]any{"entitlement": key})
	}
	limitReached := apperr.New(apperr.CodeUsageLimitReached, "You have reached your plan's limit").
		WithDetails(map[string]any{"entitlement": key, "limit": state.Limit, "resets_at": state.ResetsAt})

	if state.Limit != nil && amount > *state.Limit {
		return limitReached
	}
	start, _ := Window(state.Period, s.now())
	ok, err = s.store.IncrementUsage(ctx, userID, UsageKey{Entitlement: key, PeriodStart: start}, amount, state.Limit)
	if err != nil {
		return fmt.Errorf("increment usage: %w", err)
	}
	if !ok {
		return limitReached
	}
	return nil
}

// RequireFeatureMiddleware guards a route with a feature entitlement.
func (s *Service) RequireFeatureMiddleware(key string) gin.HandlerFunc {
	return func(c *gin.Context) {
		p, err := authz.CurrentPrincipal(c)
		if err == nil {
			err = s.RequireFeature(c.Request.Context(), p.UserID, key)
		}
		if err != nil {
			httpx.WriteError(c, apperr.From(err))
			return
		}
		c.Next()
	}
}

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/subscriptions")
	g.GET("/plans", h.plans)
	g.GET("/me", authz.RequireAuthenticated(), h.me)
}

func (h *Handler) plans(c *gin.Context) {
	plans, err := h.svc.Plans(c.Request.Context())
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, plans)
}

func (h *Handler) me(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	sub, ent, err := h.svc.Current(c.Request.Context(), p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, gin.H{"subscription": sub, "entitlements": ent})
}
