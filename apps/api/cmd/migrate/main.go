// Command migrate manages database schema migrations.
//
//	go run ./cmd/migrate up             apply all pending migrations
//	go run ./cmd/migrate down [N|all]   roll back N migrations (default 1)
//	go run ./cmd/migrate version        print the current version
//	go run ./cmd/migrate force V        mark version V as clean after a failed migration
//	go run ./cmd/migrate create NAME    create the next NNNNNN_NAME.{up,down}.sql pair
//
// It needs only DATABASE_URL, read from the environment or the monorepo .env file.
package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"

	"github.com/golang-migrate/migrate/v4"
	"github.com/joho/godotenv"

	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "migrate:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: migrate up | down [N|all] | version | force VERSION | create NAME")
	}
	if args[0] == "create" {
		if len(args) != 2 {
			return errors.New("usage: migrate create NAME")
		}
		return create("migrations", args[1])
	}

	for _, f := range []string{".env", "../../.env"} {
		if _, err := os.Stat(f); err == nil {
			_ = godotenv.Load(f)
		}
	}
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return errors.New("DATABASE_URL is not set")
	}

	m, err := database.NewMigrator(url)
	if err != nil {
		return err
	}
	defer func() { _, _ = m.Close() }()

	switch args[0] {
	case "up":
		err = m.Up()
	case "down":
		switch {
		case len(args) > 1 && args[1] == "all":
			err = m.Down()
		default:
			n := 1
			if len(args) > 1 {
				if n, err = strconv.Atoi(args[1]); err != nil || n < 1 {
					return errors.New("down expects a positive number or 'all'")
				}
			}
			err = m.Steps(-n)
		}
	case "force":
		if len(args) != 2 {
			return errors.New("usage: migrate force VERSION")
		}
		v, convErr := strconv.Atoi(args[1])
		if convErr != nil {
			return convErr
		}
		err = m.Force(v)
	case "version":
	default:
		return fmt.Errorf("unknown command %q", args[0])
	}
	if err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}

	version, dirty, verr := m.Version()
	switch {
	case errors.Is(verr, migrate.ErrNilVersion):
		fmt.Println("schema version: none")
	case verr != nil:
		return verr
	default:
		fmt.Printf("schema version: %d (dirty: %v)\n", version, dirty)
	}
	return nil
}

var validName = regexp.MustCompile(`^[a-z0-9_]+$`)
var numbered = regexp.MustCompile(`^(\d{6})_.*\.sql$`)

func create(dir, name string) error {
	if !validName.MatchString(name) {
		return errors.New("name must be snake_case: letters, digits and underscores")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read %s (run from apps/api): %w", dir, err)
	}
	var versions []int
	for _, e := range entries {
		if m := numbered.FindStringSubmatch(e.Name()); m != nil {
			v, _ := strconv.Atoi(m[1])
			versions = append(versions, v)
		}
	}
	sort.Ints(versions)
	next := 1
	if len(versions) > 0 {
		next = versions[len(versions)-1] + 1
	}
	for _, dirn := range []string{"up", "down"} {
		path := filepath.Join(dir, fmt.Sprintf("%06d_%s.%s.sql", next, name, dirn))
		if err := os.WriteFile(path, []byte("-- "+name+" ("+dirn+")\n"), 0o644); err != nil {
			return err
		}
		fmt.Println("created", path)
	}
	return nil
}
