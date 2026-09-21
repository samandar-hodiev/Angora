// Package app is the composition root: it builds infrastructure and modules from
// configuration and wires them together. It is the only package that knows every module.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/samandar-hodiev/engora/apps/api/config"
	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/ai/providers/mock"
	"github.com/samandar-hodiev/engora/apps/api/internal/ai/providers/openai"
	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/assessment"
	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/auth"
	"github.com/samandar-hodiev/engora/apps/api/internal/grammar"
	"github.com/samandar-hodiev/engora/apps/api/internal/jobs"
	"github.com/samandar-hodiev/engora/apps/api/internal/mail"
	"github.com/samandar-hodiev/engora/apps/api/internal/onboarding"
	"github.com/samandar-hodiev/engora/apps/api/internal/personalization"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/cache"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/internal/storage"
	"github.com/samandar-hodiev/engora/apps/api/internal/subscriptions"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
)

// Container holds shared infrastructure and services used by both the API server and
// the background worker.
type Container struct {
	Config   *config.Config
	Log      *slog.Logger
	DB       *pgxpool.Pool
	Redis    *redis.Client
	Reporter observability.ErrorReporter
	Metrics  *observability.Metrics
	Audit    audit.Recorder
	Mailer   mail.Mailer

	Users         *users.PostgresRepository
	Tokens        *auth.TokenIssuer
	Auth          *auth.Service
	Subscriptions *subscriptions.Service
	Evaluator     *ai.PlacementEvaluator
	AI            *ai.Gateway
	Storage       storage.ObjectStorage
	Jobs          jobs.Queue
	Analytics     analytics.Tracker
	Plans         *personalization.Service
	Onboarding    *onboarding.Service
	Assessment    *assessment.Service
	GrammarTutor  grammar.Tutor
}

func New(ctx context.Context, cfg *config.Config, log *slog.Logger) (*Container, error) {
	c := &Container{Config: cfg, Log: log}

	var err error
	c.DB, err = database.Connect(ctx, database.Options{URL: cfg.Database.URL, MaxConns: cfg.Database.MaxConns})
	if err != nil {
		return nil, err
	}
	log.Info("postgres connected")

	c.Redis, err = cache.Connect(ctx, cfg.Redis.URL, 30*time.Second)
	if err != nil {
		c.Close()
		return nil, err
	}
	log.Info("redis connected")

	c.Reporter = observability.NewErrorReporter(cfg.Observability.ErrorTracker, log)
	c.Metrics = observability.NewMetrics()
	c.Audit = audit.NewPostgresRecorder(c.DB, log)

	c.Storage, err = storage.New(cfg.Storage)
	if err != nil {
		c.Close()
		return nil, fmt.Errorf("storage: %w", err)
	}

	c.AI, err = newAIGateway(cfg.AI, c.DB, log)
	if err != nil {
		c.Close()
		return nil, fmt.Errorf("ai gateway: %w", err)
	}

	c.Mailer = mail.New(cfg.Mail, log)
	if cfg.Mail.Provider == "log" {
		log.Warn("emails are not sent (MAIL_PROVIDER=log): verification codes are logged and shown on the verify page in development")
	}
	c.Users = users.NewPostgresRepository(c.DB)
	c.Tokens = auth.NewTokenIssuer(cfg.Auth.JWTSecret, cfg.Auth.JWTIssuer, cfg.Auth.AccessTokenTTL)
	c.Analytics = analytics.NewPostgresTracker(c.DB, log)
	authDeps := auth.Deps{
		EmailCodes: auth.NewPostgresEmailCodeStore(c.DB),
		Tracker:    c.Analytics,
		Users:      c.Users,
		Tokens:     auth.NewPostgresTokenRepository(c.DB),
		Resets:     auth.NewPostgresResetStore(c.DB),
		Identities: auth.NewPostgresIdentityStore(c.DB),
		Hasher:     auth.DefaultArgon2id(),
		Issuer:     c.Tokens,
		Audit:      c.Audit,
		Mailer:     c.Mailer,
	}
	if len(cfg.Auth.GoogleClientIDs) > 0 {
		authDeps.Google = auth.NewGoogleVerifier(cfg.Auth.GoogleClientIDs)
	} else {
		log.Warn("google sign-in disabled: GOOGLE_CLIENT_IDS is not set")
	}
	c.Auth, err = auth.NewService(authDeps, auth.Options{
		RefreshTTL: cfg.Auth.RefreshTokenTTL, ResetTTL: time.Hour, WebURL: cfg.App.WebURL,
		// Only when nothing can deliver email locally; never in production.
		ExposeDevCodes: cfg.App.Env == config.EnvDevelopment && cfg.Mail.Provider == "log",
	})
	if err != nil {
		c.Close()
		return nil, fmt.Errorf("auth: %w", err)
	}
	c.Subscriptions = subscriptions.NewService(subscriptions.NewPostgresStore(c.DB))
	c.Jobs = jobs.NewRedisQueue(c.Redis, "default")

	c.Plans = personalization.NewService(c.DB, c.Analytics)
	c.Onboarding = onboarding.NewService(c.DB, c.Plans, c.Analytics)
	// One evaluator for placement and for practice: a learner's practice feedback and their
	// placement result come from the same rubric and prompt version, so they are comparable.
	c.Evaluator = ai.NewPlacementEvaluator(c.AI)
	c.Assessment = assessment.NewService(assessment.Deps{
		Pool:           c.DB,
		Storage:        c.Storage,
		Queue:          c.Jobs,
		Evaluator:      c.Evaluator,
		Plans:          c.Plans,
		Progress:       c.Onboarding,
		Tracker:        c.Analytics,
		Log:            log,
		MaxUploadBytes: cfg.Storage.MaxUploadBytes,
	})
	c.Onboarding.SetPlacement(c.Assessment)

	// A grammar explanation is generated once per topic, level and language and then read
	// by every learner who opens that topic, so it runs on the main model: the cost is paid
	// once and the quality is what the learner is taught from. AI_FAST_MODEL, when set, is
	// for the cheap per-request work.
	fastModel := cfg.AI.FastModel
	if fastModel == "" {
		fastModel = cfg.AI.Model
	}
	c.GrammarTutor = ai.NewGrammarTutor(c.AI, fastModel, cfg.AI.Model)

	log.Info("container ready",
		slog.String("env", string(cfg.App.Env)),
		slog.String("ai_provider", cfg.AI.Provider),
		slog.String("storage_provider", c.Storage.Provider()))
	return c, nil
}

func newAIGateway(cfg config.AIConfig, pool *pgxpool.Pool, log *slog.Logger) (*ai.Gateway, error) {
	var provider ai.Provider
	switch cfg.Provider {
	case openai.Name:
		provider = openai.New(cfg.OpenAIAPIKey, cfg.OpenAIBaseURL)
	case mock.Name:
		provider = mock.New()
	default:
		return nil, fmt.Errorf("unsupported AI provider %q", cfg.Provider)
	}
	return ai.NewGateway(ai.GatewayConfig{
		DefaultProvider: provider.Name(),
		DefaultModel:    cfg.Model,
	}, ai.NewPostgresUsageRecorder(pool, log), log, provider)
}

// Close releases connections. Safe to call on a partially built container.
func (c *Container) Close() {
	if c.Redis != nil {
		_ = c.Redis.Close()
	}
	if c.DB != nil {
		c.DB.Close()
	}
}
