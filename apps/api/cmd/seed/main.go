// Command seed loads development data. It refuses to run when APP_ENV=production.
//
//	go run ./cmd/seed content                 sample learning content (topics, tasks, passages, words, grammar)
//	go run ./cmd/seed demo [email] [password] a demo learner with progress, mistakes, vocabulary and history
//	go run ./cmd/seed promote EMAIL           give an existing account the ADMIN role
//
// Content is idempotent (matched by slug/title); running it twice changes nothing.
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/joho/godotenv"

	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "seed:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: seed content | demo [email] [password] | promote EMAIL")
	}
	for _, f := range []string{".env", "../../.env"} {
		if _, err := os.Stat(f); err == nil {
			_ = godotenv.Load(f)
		}
	}
	if os.Getenv("APP_ENV") == "production" {
		return errors.New("refusing to seed a production environment")
	}
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return errors.New("DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	pool, err := database.Connect(ctx, database.Options{URL: url, MaxConns: 4, ConnectTimeout: 10 * time.Second})
	if err != nil {
		return err
	}
	defer pool.Close()

	switch args[0] {
	case "content":
		return seedContent(ctx, pool)
	case "demo":
		email, password := "demo@engora.dev", "engora-demo-2026"
		if len(args) > 1 {
			email = args[1]
		}
		if len(args) > 2 {
			password = args[2]
		}
		if err := seedContent(ctx, pool); err != nil {
			return err
		}
		return seedDemo(ctx, pool, email, password)
	case "promote":
		if len(args) != 2 {
			return errors.New("usage: seed promote EMAIL")
		}
		tag, err := pool.Exec(ctx, `UPDATE users SET role = 'ADMIN' WHERE lower(email) = lower($1)`, args[1])
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("no account with email %s", args[1])
		}
		fmt.Printf("%s is now ADMIN (sign in again to refresh the token)\n", args[1])
		return nil
	default:
		return fmt.Errorf("unknown command %q", args[0])
	}
}
