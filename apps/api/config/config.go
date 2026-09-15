// Package config loads and validates all runtime configuration from environment
// variables. It is the only place in the API that reads os.Getenv.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// Environment is the deployment environment the process runs in.
type Environment string

const (
	EnvDevelopment Environment = "development"
	EnvTest        Environment = "test"
	EnvProduction  Environment = "production"
)

type Config struct {
	App           AppConfig
	HTTP          HTTPConfig
	Database      DatabaseConfig
	Redis         RedisConfig
	Auth          AuthConfig
	AI            AIConfig
	Storage       StorageConfig
	Mail          MailConfig
	Observability ObservabilityConfig
}

type AppConfig struct {
	Env       Environment
	Port      int
	Version   string
	LogLevel  string
	LogFormat string
	// WebURL is the public web app origin, used in links sent to users (password reset).
	WebURL string
}

type MailConfig struct {
	Provider string
	From     string
}

func (a AppConfig) IsProduction() bool { return a.Env == EnvProduction }

type HTTPConfig struct {
	CORSAllowedOrigins     []string
	TrustedProxies         []string
	RateLimitAuthPerMinute int
	ReadTimeout            time.Duration
	WriteTimeout           time.Duration
	ShutdownTimeout        time.Duration
	MaxJSONBodyBytes       int64
}

type DatabaseConfig struct {
	URL      string
	MaxConns int32
}

type RedisConfig struct {
	URL string
}

type AuthConfig struct {
	JWTSecret       string
	JWTIssuer       string
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration
}

type AIConfig struct {
	Provider      string
	Model         string
	OpenAIAPIKey  string
	OpenAIBaseURL string
}

type StorageConfig struct {
	Provider       string
	LocalDir       string
	Bucket         string
	Region         string
	Endpoint       string
	AccessKey      string
	SecretKey      string
	MaxUploadBytes int64
}

type ObservabilityConfig struct {
	ErrorTracker string
}

// Load reads configuration from the process environment. In development it first loads
// `.env` files (the API's own directory, then the monorepo root) without overriding
// variables that are already set, so real environment variables always win.
func Load() (*Config, error) {
	if Environment(os.Getenv("APP_ENV")) != EnvProduction {
		for _, f := range []string{".env", "../../.env"} {
			if _, err := os.Stat(f); err == nil {
				_ = godotenv.Load(f)
			}
		}
	}
	return FromLookup(os.LookupEnv)
}

// FromLookup builds a Config from any key lookup function. Tests use it to avoid
// touching the real process environment.
func FromLookup(lookup func(string) (string, bool)) (*Config, error) {
	r := reader{lookup: lookup}

	cfg := &Config{
		App: AppConfig{
			Env:       Environment(r.str("APP_ENV", string(EnvDevelopment))),
			Port:      r.int("APP_PORT", 8000),
			Version:   r.str("APP_VERSION", "dev"),
			LogLevel:  r.str("LOG_LEVEL", "info"),
			LogFormat: r.str("LOG_FORMAT", "json"),
			WebURL:    r.str("WEB_APP_URL", "http://localhost:3001"),
		},
		HTTP: HTTPConfig{
			CORSAllowedOrigins:     r.list("CORS_ALLOWED_ORIGINS"),
			TrustedProxies:         r.list("TRUSTED_PROXIES"),
			RateLimitAuthPerMinute: r.int("RATE_LIMIT_AUTH_PER_MINUTE", 10),
			ReadTimeout:            r.duration("HTTP_READ_TIMEOUT", 15*time.Second),
			WriteTimeout:           r.duration("HTTP_WRITE_TIMEOUT", 30*time.Second),
			ShutdownTimeout:        r.duration("HTTP_SHUTDOWN_TIMEOUT", 20*time.Second),
			MaxJSONBodyBytes:       int64(r.int("HTTP_MAX_JSON_BODY_BYTES", 1<<20)),
		},
		Database: DatabaseConfig{
			URL:      r.str("DATABASE_URL", ""),
			MaxConns: int32(r.int("DATABASE_MAX_CONNS", 10)),
		},
		Redis: RedisConfig{
			URL: r.str("REDIS_URL", ""),
		},
		Auth: AuthConfig{
			JWTSecret:       r.str("JWT_SECRET", ""),
			JWTIssuer:       r.str("JWT_ISSUER", "engora"),
			AccessTokenTTL:  r.duration("JWT_ACCESS_TTL", 15*time.Minute),
			RefreshTokenTTL: r.duration("REFRESH_TOKEN_TTL", 30*24*time.Hour),
		},
		AI: AIConfig{
			Provider:      strings.ToLower(r.str("AI_PROVIDER", "mock")),
			Model:         r.str("AI_MODEL", ""),
			OpenAIAPIKey:  r.str("OPENAI_API_KEY", ""),
			OpenAIBaseURL: r.str("OPENAI_BASE_URL", "https://api.openai.com/v1"),
		},
		Storage: StorageConfig{
			Provider:       strings.ToLower(r.str("STORAGE_PROVIDER", "local")),
			LocalDir:       r.str("STORAGE_LOCAL_DIR", "./var/storage"),
			Bucket:         r.str("STORAGE_BUCKET", ""),
			Region:         r.str("STORAGE_REGION", "auto"),
			Endpoint:       r.str("STORAGE_ENDPOINT", ""),
			AccessKey:      r.str("STORAGE_ACCESS_KEY", ""),
			SecretKey:      r.str("STORAGE_SECRET_KEY", ""),
			MaxUploadBytes: int64(r.int("STORAGE_MAX_UPLOAD_MB", 25)) << 20,
		},
		Mail: MailConfig{
			Provider: strings.ToLower(r.str("MAIL_PROVIDER", "log")),
			From:     r.str("MAIL_FROM", "Engora <no-reply@engora.local>"),
		},
		Observability: ObservabilityConfig{
			ErrorTracker: strings.ToLower(r.str("ERROR_TRACKER", "log")),
		},
	}

	if err := errors.Join(append(r.errs, cfg.validate()...)...); err != nil {
		return nil, fmt.Errorf("invalid configuration: %w", err)
	}
	return cfg, nil
}

// minJWTSecretLength keeps HS256 keys at a brute-force-resistant size.
const minJWTSecretLength = 32

func (c *Config) validate() []error {
	var errs []error
	switch c.App.Env {
	case EnvDevelopment, EnvTest, EnvProduction:
	default:
		errs = append(errs, fmt.Errorf("APP_ENV must be development, test or production, got %q", c.App.Env))
	}
	if c.App.Port <= 0 || c.App.Port > 65535 {
		errs = append(errs, fmt.Errorf("APP_PORT must be a valid port, got %d", c.App.Port))
	}
	if c.Database.URL == "" {
		errs = append(errs, errors.New("DATABASE_URL is required"))
	}
	if c.Redis.URL == "" {
		errs = append(errs, errors.New("REDIS_URL is required"))
	}
	if len(c.Auth.JWTSecret) < minJWTSecretLength {
		errs = append(errs, fmt.Errorf("JWT_SECRET must be at least %d characters", minJWTSecretLength))
	}
	if c.Auth.AccessTokenTTL <= 0 || c.Auth.RefreshTokenTTL <= c.Auth.AccessTokenTTL {
		errs = append(errs, errors.New("REFRESH_TOKEN_TTL must be longer than a positive JWT_ACCESS_TTL"))
	}

	switch c.AI.Provider {
	case "mock":
		if c.App.IsProduction() {
			errs = append(errs, errors.New("AI_PROVIDER=mock is not allowed in production"))
		}
	case "openai":
		if c.AI.OpenAIAPIKey == "" {
			errs = append(errs, errors.New("OPENAI_API_KEY is required when AI_PROVIDER=openai"))
		}
	default:
		errs = append(errs, fmt.Errorf("AI_PROVIDER %q is not supported", c.AI.Provider))
	}

	switch c.Storage.Provider {
	case "local":
		if c.App.IsProduction() {
			errs = append(errs, errors.New("STORAGE_PROVIDER=local is not allowed in production"))
		}
	case "s3":
		if c.Storage.Bucket == "" || c.Storage.AccessKey == "" || c.Storage.SecretKey == "" {
			errs = append(errs, errors.New("STORAGE_BUCKET, STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY are required when STORAGE_PROVIDER=s3"))
		}
	default:
		errs = append(errs, fmt.Errorf("STORAGE_PROVIDER %q is not supported", c.Storage.Provider))
	}

	switch c.Mail.Provider {
	case "log":
		if c.App.IsProduction() {
			errs = append(errs, errors.New("MAIL_PROVIDER=log is not allowed in production (it logs reset links)"))
		}
	case "none":
	default:
		errs = append(errs, fmt.Errorf("MAIL_PROVIDER %q is not supported", c.Mail.Provider))
	}

	if c.App.IsProduction() && len(c.HTTP.CORSAllowedOrigins) == 0 {
		errs = append(errs, errors.New("CORS_ALLOWED_ORIGINS is required in production"))
	}
	return errs
}

// reader collects parse errors so that every problem is reported at once.
type reader struct {
	lookup func(string) (string, bool)
	errs   []error
}

func (r *reader) str(key, fallback string) string {
	if v, ok := r.lookup(key); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return fallback
}

func (r *reader) int(key string, fallback int) int {
	v := r.str(key, "")
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		r.errs = append(r.errs, fmt.Errorf("%s must be an integer, got %q", key, v))
		return fallback
	}
	return n
}

func (r *reader) duration(key string, fallback time.Duration) time.Duration {
	v := r.str(key, "")
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		r.errs = append(r.errs, fmt.Errorf("%s must be a duration like 15m or 720h, got %q", key, v))
		return fallback
	}
	return d
}

func (r *reader) list(key string) []string {
	var out []string
	for _, part := range strings.Split(r.str(key, ""), ",") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}
