package database

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
)

func TestMigrateURL(t *testing.T) {
	cases := map[string]string{
		"postgres://u:p@h:5432/db?sslmode=disable": "pgx5://u:p@h:5432/db?sslmode=disable",
		"postgresql://h/db":                        "pgx5://h/db",
		"pgx5://h/db":                              "pgx5://h/db",
	}
	for in, want := range cases {
		if got := migrateURL(in); got != want {
			t.Errorf("migrateURL(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRetryPingGivesUp(t *testing.T) {
	calls := 0
	err := retryPing(context.Background(), 300*time.Millisecond, func(context.Context) error {
		calls++
		return errors.New("connection refused")
	})
	if err == nil || calls < 2 {
		t.Errorf("err = %v after %d calls, want an error after retries", err, calls)
	}
}

// TestPostgresIntegration verifies connection and the full migration cycle against a
// disposable database. It DROPS all tables, so never point it at real data:
//
//	TEST_DATABASE_URL=postgres://localhost:5432/engora_test?sslmode=disable go test ./internal/platform/database/
func TestPostgresIntegration(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()

	pool, err := Connect(ctx, Options{URL: url, MaxConns: 2, ConnectTimeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	m, err := NewMigrator(url)
	if err != nil {
		t.Fatal(err)
	}
	defer closeMigrator(m)

	if err := m.Down(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		t.Fatalf("reset: %v", err)
	}
	if err := MigrateUp(url); err != nil {
		t.Fatalf("up: %v", err)
	}

	rows, err := pool.Query(ctx, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)
	if err != nil {
		t.Fatal(err)
	}
	existing := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		existing[name] = true
	}
	rows.Close()
	for _, table := range requiredTables {
		if !existing[table] {
			t.Errorf("table %q missing after migrate up", table)
		}
	}

	var defaultPlan string
	if err := pool.QueryRow(ctx, `SELECT code FROM subscription_plans WHERE is_default`).Scan(&defaultPlan); err != nil {
		t.Fatalf("seeded default plan: %v", err)
	}

	if err := m.Down(); err != nil {
		t.Fatalf("down: %v", err)
	}
	if err := MigrateUp(url); err != nil {
		t.Fatalf("up after down (migrations must be reversible): %v", err)
	}

	if _, err := pool.Exec(ctx, `INSERT INTO users (email) VALUES ('Case@Example.com')`); err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO users (email) VALUES ('case@example.com')`)
	if !IsUniqueViolation(err) {
		t.Errorf("emails must be unique case-insensitively, err = %v", err)
	}
}

// requiredTables is the foundation schema from the architecture brief.
var requiredTables = []string{
	"users", "profiles", "roles", "refresh_tokens", "subscriptions", "subscription_plans",
	"entitlements", "plan_entitlements", "usage_counters",
	"skills", "levels", "topics", "lessons", "content_items",
	"speaking_sessions", "writing_submissions", "reading_attempts", "listening_attempts",
	"vocabulary", "user_vocabulary", "vocabulary_reviews", "grammar_topics", "user_grammar_progress",
	"mistakes", "weaknesses", "skill_progress", "learning_plans", "recommendations",
	"ai_requests", "ai_usage", "ai_analyses", "audio_files", "transcripts",
	"notifications", "streaks", "achievements", "user_achievements", "audit_logs",
}
