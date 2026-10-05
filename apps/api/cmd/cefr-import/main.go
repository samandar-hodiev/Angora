// Command cefr-import loads a level-tagged English word list into cefr_wordlist, the reference
// that generated vocabulary is checked against, and moves the library's words to the listed
// level wherever no owner has set one by hand.
//
//	go run ./cmd/cefr-import -source cefrj  cefrj-vocabulary-profile-1.5.csv
//	go run ./cmd/cefr-import -source octanove octanove-vocabulary-profile-c1c2-1.0.csv
//
// The CSV needs a header with "headword", "pos" and "CEFR" columns, as the CEFR-J and
// Octanove lists have. A headword with alternatives ("colour/color") is stored once for each.
// It needs only DATABASE_URL, read from the environment or the monorepo .env file.
package main

import (
	"context"
	"encoding/csv"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/joho/godotenv"

	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "cefr-import:", err)
		os.Exit(1)
	}
}

func run() error {
	source := flag.String("source", "", "name of the list, stored with each row (e.g. cefrj, octanove)")
	flag.Parse()
	if *source == "" || flag.NArg() != 1 {
		return errors.New("usage: cefr-import -source NAME FILE.csv")
	}
	for _, p := range []string{".env", "../.env", "../../.env"} {
		_ = godotenv.Load(filepath.Clean(p))
	}
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return errors.New("DATABASE_URL is not set")
	}
	f, err := os.Open(flag.Arg(0))
	if err != nil {
		return err
	}
	defer f.Close()
	rows, err := Parse(f)
	if err != nil {
		return err
	}

	ctx := context.Background()
	pool, err := database.Connect(ctx, database.Options{URL: dbURL, MaxConns: 2})
	if err != nil {
		return err
	}
	defer pool.Close()

	batch := &pgx.Batch{}
	for _, r := range rows {
		batch.Queue(`INSERT INTO cefr_wordlist (headword, pos, level_code, source) VALUES ($1, $2, $3, $4)
			ON CONFLICT (headword, pos) DO UPDATE SET level_code = EXCLUDED.level_code, source = EXCLUDED.source`,
			r.Headword, r.POS, r.Level, *source)
	}
	if err := pool.SendBatch(ctx, batch).Close(); err != nil {
		return fmt.Errorf("store rows: %w", err)
	}
	// Words already in the library take the listed level — the same part of speech first,
	// else the only listing — unless an owner set the level by hand.
	tag, err := pool.Exec(ctx, `
		WITH listed AS (
		    SELECT v.id, COALESCE(
		        (SELECT c.level_code FROM cefr_wordlist c WHERE c.headword = lower(v.term) AND c.pos = v.part_of_speech),
		        (SELECT min(c.level_code) FROM cefr_wordlist c WHERE c.headword = lower(v.term)
		         HAVING count(*) = 1)) AS code
		    FROM vocabulary v WHERE v.level_source <> 'curated'
		)
		UPDATE vocabulary v SET level_id = l.id, level_source = 'list',
		       level_content = CASE
		           WHEN (SELECT count(*) FROM jsonb_object_keys(v.level_content)) = 1
		           THEN jsonb_build_object(l.code, (SELECT value FROM jsonb_each(v.level_content) LIMIT 1))
		           ELSE v.level_content END
		FROM listed JOIN levels l ON l.code = listed.code
		WHERE v.id = listed.id`)
	if err != nil {
		return fmt.Errorf("relevel library: %w", err)
	}
	fmt.Printf("cefr-import: %d list entries stored, %d library words now at their listed level\n", len(rows), tag.RowsAffected())
	return nil
}

// Row is one headword of the list.
type Row struct {
	Headword, POS, Level string
}

// Parse reads the CSV, one row per headword alternative, skipping rows without a known level.
func Parse(r io.Reader) ([]Row, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1
	header, err := cr.Read()
	if err != nil {
		return nil, fmt.Errorf("read header: %w", err)
	}
	col := map[string]int{}
	for i, h := range header {
		col[strings.ToLower(strings.TrimSpace(strings.TrimPrefix(h, "\ufeff")))] = i
	}
	hw, okH := col["headword"]
	pos, okP := col["pos"]
	lv, okL := col["cefr"]
	if !okH || !okP || !okL {
		return nil, errors.New(`the header needs "headword", "pos" and "CEFR" columns`)
	}
	var out []Row
	seen := map[[2]string]bool{}
	for {
		rec, err := cr.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		if len(rec) <= max(hw, pos, lv) {
			continue
		}
		level := strings.ToUpper(strings.TrimSpace(rec[lv]))
		if !strings.Contains("A1 A2 B1 B2 C1 C2", level) || len(level) != 2 {
			continue
		}
		p := strings.ToLower(strings.TrimSpace(rec[pos]))
		for _, h := range strings.Split(rec[hw], "/") {
			h = strings.ToLower(strings.TrimSpace(h))
			key := [2]string{h, p}
			if h == "" || seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, Row{Headword: h, POS: p, Level: level})
		}
	}
	return out, nil
}
