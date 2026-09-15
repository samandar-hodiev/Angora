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
	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/auth"
	"github.com/samandar-hodiev/engora/apps/api/internal/jobs"
	"github.com/samandar-hodiev/engora/apps/api/internal/mail"
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
	AI            *ai.Gateway
	Storage       storage.ObjectStorage
	Jobs          jobs.Queue
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

	c.Mailer = mail.New(cfg.Mail.Provider, log)
	c.Users = users.NewPostgresRepository(c.DB)
	c.Tokens = auth.NewTokenIssuer(cfg.Auth.JWTSecret, cfg.Auth.JWTIssuer, cfg.Auth.AccessTokenTTL)
	c.Auth, err = auth.NewService(auth.Deps{
		Users:  c.Users,
		Tokens: auth.NewPostgresTokenRepository(c.DB),
		Resets: auth.NewPostgresResetStore(c.DB),
		Hasher: auth.DefaultArgon2id(),
		Issuer: c.Tokens,
		Audit:  c.Audit,
		Mailer: c.Mailer,
	}, auth.Options{RefreshTTL: cfg.Auth.RefreshTokenTTL, ResetTTL: time.Hour, WebURL: cfg.App.WebURL})
	if err != nil {
		c.Close()
		return nil, fmt.Errorf("auth: %w", err)
	}
	c.Subscriptions = subscriptions.NewService(subscriptions.NewPostgresStore(c.DB))
	c.Jobs = jobs.NewRedisQueue(c.Redis, "default")

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
