package app

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/samandar-hodiev/engora/apps/api/internal/admin"
	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/assessment"
	"github.com/samandar-hodiev/engora/apps/api/internal/auth"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/coach"
	"github.com/samandar-hodiev/engora/apps/api/internal/grammar"
	"github.com/samandar-hodiev/engora/apps/api/internal/health"
	"github.com/samandar-hodiev/engora/apps/api/internal/ielts"
	"github.com/samandar-hodiev/engora/apps/api/internal/jobs"
	"github.com/samandar-hodiev/engora/apps/api/internal/learning"
	"github.com/samandar-hodiev/engora/apps/api/internal/levels"
	"github.com/samandar-hodiev/engora/apps/api/internal/mistakes"
	"github.com/samandar-hodiev/engora/apps/api/internal/onboarding"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/middleware"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/ratelimit"
	"github.com/samandar-hodiev/engora/apps/api/internal/practice"
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
		middleware.BodyLimitWithOverrides(cfg.HTTP.MaxJSONBodyBytes, map[string]int64{
			assessment.RecordingRoute: cfg.Storage.MaxUploadBytes + 1<<20,
			practice.SpeakingRoute:    cfg.Storage.MaxUploadBytes + 1<<20,
			profiles.AvatarRoute:      6 << 20,
			profiles.WallpaperRoute:   9 << 20,
		}),
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

	platform.NewSettingsHandler(c.DB).RegisterRoutes(r, v1)
	users.NewHandler(c.Users).RegisterRoutes(v1)
	profiles.NewModule(c.DB, c.Audit, c.Log, c.Storage, c.Analytics).RegisterRoutes(v1)
	learning.NewModule(c.DB, c.Redis).RegisterRoutes(v1)
	subscriptions.NewHandler(c.Subscriptions).RegisterRoutes(v1)
	progress.NewModule(c.DB).RegisterRoutes(v1)
	mistakes.NewModule(c.DB).RegisterRoutes(v1)
	vocabulary.NewModule(c.DB).RegisterRoutes(v1)
	grammar.NewModule(grammar.Deps{
		Pool: c.DB, Redis: c.Redis, Tutor: c.GrammarTutor,
		Storage: c.Storage, Tracker: c.Analytics, Plans: c.Subscriptions, Log: c.Log,
	}).RegisterRoutes(v1)
	coach.NewModule(coach.Deps{Pool: c.DB, AI: c.AI, Plans: c.Subscriptions}).RegisterRoutes(v1)
	ielts.NewModule(ielts.Deps{Pool: c.DB, Plans: c.Subscriptions}).RegisterRoutes(v1)
	practice.NewModule(practice.Deps{
		Pool: c.DB, Plans: c.Subscriptions, Usage: c.Subscriptions,
		Evaluator: c.Evaluator, Speaker: c.Evaluator, Storage: c.Storage,
		MaxUploadBytes: cfg.Storage.MaxUploadBytes, Tracker: c.Analytics,
	}).RegisterRoutes(v1)
	recommendations.NewModule(c.DB).RegisterRoutes(v1)
	levels.NewModule(c.DB).RegisterRoutes(v1)
	onboarding.NewHandler(c.Onboarding).RegisterRoutes(v1)
	assessment.NewHandler(c.Assessment).RegisterRoutes(v1)
	analytics.RegisterRoutes(v1, c.Analytics, ratelimit.Middleware(ratelimit.NewRedisLimiter(c.Redis), "analytics",
		120, time.Minute, c.Log))
	admin.NewModule(c.DB, c.Audit).RegisterRoutes(v1)
	jobs.RegisterRoutes(v1, c.Jobs)

	v1.GET("/admin/system/metrics", authz.RequirePermission(authz.PermSystemRead), func(ctx *gin.Context) {
		httpx.OK(ctx, c.Metrics.Snapshot())
	})

	return r, nil
}
