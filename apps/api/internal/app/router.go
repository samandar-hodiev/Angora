package app

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/samandar-hodiev/engora/apps/api/internal/admin"
	"github.com/samandar-hodiev/engora/apps/api/internal/auth"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/grammar"
	"github.com/samandar-hodiev/engora/apps/api/internal/health"
	"github.com/samandar-hodiev/engora/apps/api/internal/jobs"
	"github.com/samandar-hodiev/engora/apps/api/internal/learning"
	"github.com/samandar-hodiev/engora/apps/api/internal/mistakes"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/middleware"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/ratelimit"
	"github.com/samandar-hodiev/engora/apps/api/internal/profiles"
	"github.com/samandar-hodiev/engora/apps/api/internal/progress"
	"github.com/samandar-hodiev/engora/apps/api/internal/recommendations"
	"github.com/samandar-hodiev/engora/apps/api/internal/subscriptions"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
	"github.com/samandar-hodiev/engora/apps/api/internal/vocabulary"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// NewRouter builds the HTTP API.
//
// Versioning: every business route lives under /api/v1. A future /api/v2 is a second
// group registering new handlers (new DTOs) over the same services, so v1 mobile clients
// keep working while v2 is adopted. Only infrastructure endpoints (/health) sit outside.
func NewRouter(c *Container) (*gin.Engine, error) {
	cfg := c.Config
	if cfg.App.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}
	httpx.ConfigureValidator()

	r := gin.New()
	if err := r.SetTrustedProxies(cfg.HTTP.TrustedProxies); err != nil {
		return nil, err
	}
	r.HandleMethodNotAllowed = true
	r.NoRoute(middleware.NotFound())
	r.NoMethod(middleware.MethodNotAllowed())

	r.Use(
		middleware.RequestID(c.Log),
		middleware.AccessLog(c.Log),
		middleware.Metrics(c.Metrics),
		middleware.Recovery(c.Reporter),
		middleware.SecurityHeaders(cfg.App.IsProduction()),
		middleware.CORS(cfg.HTTP.CORSAllowedOrigins),
		middleware.BodyLimit(cfg.HTTP.MaxJSONBodyBytes),
		middleware.Errors(c.Reporter),
	)

	v1 := r.Group("/api/v1", auth.Authenticate(c.Tokens))

	health.NewHandler(cfg.App.Version, map[string]health.Checker{
		"database": func(ctx context.Context) error { return c.DB.Ping(ctx) },
		"redis":    func(ctx context.Context) error { return c.Redis.Ping(ctx).Err() },
	}).RegisterRoutes(r, v1)

	authLimit := ratelimit.Middleware(ratelimit.NewRedisLimiter(c.Redis), "auth",
		cfg.HTTP.RateLimitAuthPerMinute, time.Minute, c.Log)
	auth.NewHandler(c.Auth).RegisterRoutes(v1, authLimit)

	users.NewHandler(c.Users).RegisterRoutes(v1)
	profiles.NewModule(c.DB, c.Audit, c.Log).RegisterRoutes(v1)
	learning.NewModule(c.DB, c.Redis).RegisterRoutes(v1)
	subscriptions.NewHandler(c.Subscriptions).RegisterRoutes(v1)
	progress.NewModule(c.DB).RegisterRoutes(v1)
	mistakes.NewModule(c.DB).RegisterRoutes(v1)
	vocabulary.NewModule(c.DB).RegisterRoutes(v1)
	grammar.NewModule(c.DB).RegisterRoutes(v1)
	recommendations.NewModule(c.DB).RegisterRoutes(v1)
	admin.NewModule(c.DB).RegisterRoutes(v1)
	jobs.RegisterRoutes(v1, c.Jobs)

	v1.GET("/admin/system/metrics", authz.RequirePermission(authz.PermSystemRead), func(ctx *gin.Context) {
		httpx.OK(ctx, c.Metrics.Snapshot())
	})

	return r, nil
}
