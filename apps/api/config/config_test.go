package config

import (
	"strings"
	"testing"
	"time"
)

func lookupFrom(env map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) {
		v, ok := env[k]
		return v, ok
	}
}

func validEnv() map[string]string {
	return map[string]string{
		"DATABASE_URL": "postgres://localhost/engora",
		"REDIS_URL":    "redis://localhost:6379/0",
		"JWT_SECRET":   strings.Repeat("s", 40),
	}
}

func TestDefaults(t *testing.T) {
	cfg, err := FromLookup(lookupFrom(validEnv()))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.App.Env != EnvDevelopment {
		t.Errorf("env = %q, want development", cfg.App.Env)
	}
	if cfg.App.Port != 8000 {
		t.Errorf("port = %d, want 8000", cfg.App.Port)
	}
	if cfg.Auth.AccessTokenTTL != 15*time.Minute {
		t.Errorf("access ttl = %s, want 15m", cfg.Auth.AccessTokenTTL)
	}
	if cfg.AI.Provider != "mock" || cfg.Storage.Provider != "local" {
		t.Errorf("providers = %q/%q, want mock/local", cfg.AI.Provider, cfg.Storage.Provider)
	}
	if cfg.Storage.MaxUploadBytes != 25<<20 {
		t.Errorf("max upload = %d, want 25MB", cfg.Storage.MaxUploadBytes)
	}
}

func TestParsesListsAndDurations(t *testing.T) {
	env := validEnv()
	env["CORS_ALLOWED_ORIGINS"] = " http://a.test , ,http://b.test"
	env["JWT_ACCESS_TTL"] = "5m"
	cfg, err := FromLookup(lookupFrom(env))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := cfg.HTTP.CORSAllowedOrigins; len(got) != 2 || got[0] != "http://a.test" || got[1] != "http://b.test" {
		t.Errorf("origins = %v", got)
	}
	if cfg.Auth.AccessTokenTTL != 5*time.Minute {
		t.Errorf("access ttl = %s, want 5m", cfg.Auth.AccessTokenTTL)
	}
}

func TestReportsAllProblemsAtOnce(t *testing.T) {
	_, err := FromLookup(lookupFrom(map[string]string{
		"APP_PORT":       "not-a-number",
		"JWT_ACCESS_TTL": "soon",
	}))
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, want := range []string{"APP_PORT", "JWT_ACCESS_TTL", "DATABASE_URL", "REDIS_URL", "JWT_SECRET"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error does not mention %s: %v", want, err)
		}
	}
}

func TestRejectsShortJWTSecret(t *testing.T) {
	env := validEnv()
	env["JWT_SECRET"] = "too-short"
	if _, err := FromLookup(lookupFrom(env)); err == nil || !strings.Contains(err.Error(), "JWT_SECRET") {
		t.Fatalf("expected JWT_SECRET error, got %v", err)
	}
}

func TestProductionRejectsDevelopmentProviders(t *testing.T) {
	env := validEnv()
	env["APP_ENV"] = "production"
	_, err := FromLookup(lookupFrom(env))
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, want := range []string{"AI_PROVIDER=mock", "STORAGE_PROVIDER=local", "CORS_ALLOWED_ORIGINS"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error does not mention %s: %v", want, err)
		}
	}
}

func TestProviderSpecificRequirements(t *testing.T) {
	env := validEnv()
	env["AI_PROVIDER"] = "openai"
	env["STORAGE_PROVIDER"] = "s3"
	_, err := FromLookup(lookupFrom(env))
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, want := range []string{"OPENAI_API_KEY", "STORAGE_BUCKET"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error does not mention %s: %v", want, err)
		}
	}
}
