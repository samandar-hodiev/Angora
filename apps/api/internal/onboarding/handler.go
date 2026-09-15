package onboarding

import (
	"context"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes mounts /onboarding. Every mutation returns the full, fresh State so a
// client can always render from the server's answer.
func (h *Handler) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/onboarding", authz.RequirePermission(authz.PermProfileManageOwn))
	g.GET("", h.run(func(ctx context.Context, c *gin.Context, userID uuid.UUID) (State, error) {
		return h.svc.Get(ctx, userID)
	}))
	g.POST("/start", h.run(func(ctx context.Context, _ *gin.Context, userID uuid.UUID) (State, error) {
		return h.svc.Start(ctx, userID)
	}))
	g.PUT("/goals", h.run(func(ctx context.Context, c *gin.Context, userID uuid.UUID) (State, error) {
		var in struct {
			Goals []string `json:"goals" binding:"required,max=6,dive,max=64"`
		}
		if err := httpx.BindJSON(c, &in); err != nil {
			return State{}, err
		}
		return h.svc.SetGoals(ctx, userID, in.Goals)
	}))
	g.PUT("/daily-time", h.run(func(ctx context.Context, c *gin.Context, userID uuid.UUID) (State, error) {
		var in struct {
			Minutes int `json:"minutes" binding:"required"`
		}
		if err := httpx.BindJSON(c, &in); err != nil {
			return State{}, err
		}
		return h.svc.SetDailyTime(ctx, userID, in.Minutes)
	}))
	g.PUT("/level", h.run(func(ctx context.Context, c *gin.Context, userID uuid.UUID) (State, error) {
		var in levelInput
		if err := httpx.BindJSON(c, &in); err != nil {
			return State{}, err
		}
		return h.svc.ChooseLevel(ctx, userID, in.Level)
	}))
	g.POST("/placement", h.run(func(ctx context.Context, _ *gin.Context, userID uuid.UUID) (State, error) {
		return h.svc.ChoosePlacement(ctx, userID)
	}))
	g.PUT("/placement/start-level", h.run(func(ctx context.Context, c *gin.Context, userID uuid.UUID) (State, error) {
		var in levelInput
		if err := httpx.BindJSON(c, &in); err != nil {
			return State{}, err
		}
		return h.svc.StartPlacement(ctx, userID, in.Level, httpx.ClientPlatform(c))
	}))
	g.POST("/placement/abandon", h.run(func(ctx context.Context, _ *gin.Context, userID uuid.UUID) (State, error) {
		return h.svc.AbandonPlacement(ctx, userID)
	}))
	g.POST("/results-viewed", h.run(func(ctx context.Context, _ *gin.Context, userID uuid.UUID) (State, error) {
		return h.svc.ResultsViewed(ctx, userID)
	}))
	g.POST("/plan", h.run(func(ctx context.Context, _ *gin.Context, userID uuid.UUID) (State, error) {
		return h.svc.RegeneratePlan(ctx, userID)
	}))
	g.PUT("/step", h.run(func(ctx context.Context, c *gin.Context, userID uuid.UUID) (State, error) {
		var in struct {
			Step Step `json:"step" binding:"required,max=32"`
		}
		if err := httpx.BindJSON(c, &in); err != nil {
			return State{}, err
		}
		return h.svc.Navigate(ctx, userID, in.Step)
	}))
	g.POST("/complete", h.run(func(ctx context.Context, _ *gin.Context, userID uuid.UUID) (State, error) {
		return h.svc.Complete(ctx, userID)
	}))
}

type levelInput struct {
	Level string `json:"level" binding:"required,max=4"`
}

func (h *Handler) run(fn func(ctx context.Context, c *gin.Context, userID uuid.UUID) (State, error)) gin.HandlerFunc {
	return func(c *gin.Context) {
		p, err := authz.CurrentPrincipal(c)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		state, err := fn(c.Request.Context(), c, p.UserID)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		httpx.OK(c, state)
	}
}
