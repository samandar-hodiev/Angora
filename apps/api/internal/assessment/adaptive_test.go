package assessment

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/jobs"
	"github.com/samandar-hodiev/engora/apps/api/internal/onboarding"
	"github.com/samandar-hodiev/engora/apps/api/internal/personalization"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/storage"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

func TestAdaptiveSkillsSkipsTheFirstSection(t *testing.T) {
	cfg := Config{Sections: []SectionConfig{
		{Skill: "reading"}, {Skill: "listening"}, {Skill: "writing"}, {Skill: "speaking"},
	}}
	got := adaptiveSkills(cfg)
	if got["reading"] {
		t.Error("the first section has nothing to adapt to and must stay fixed")
	}
	for _, skill := range []string{"listening", "writing", "speaking"} {
		if !got[skill] {
			t.Errorf("%s should be chosen adaptively", skill)
		}
	}
}

func TestSectionRNGIsStablePerSectionAndDiffersBetweenThem(t *testing.T) {
	id := uuid.MustParse("6d1f8a2e-9f3c-4a1b-8c7d-2e5f9a0b1c3d")
	a, b := sectionRNG(id, "listening").Uint64(), sectionRNG(id, "listening").Uint64()
	if a != b {
		t.Error("refilling the same section must produce the same form, not a different test")
	}
	if c := sectionRNG(id, "writing").Uint64(); a == c {
		t.Error("two sections of one test should not draw the same sequence")
	}
	other := uuid.MustParse("11111111-2222-3333-4444-555555555555")
	if d := sectionRNG(other, "listening").Uint64(); a == d {
		t.Error("two learners should not get the identical form")
	}
}

// TestAdaptivePlacementPostgres proves the point of adaptive mode: a learner who declares
// C1 and then reads at A2 is not handed a C1 listening section. Run with:
//
//	TEST_DATABASE_URL=... go test -p 1 -run TestAdaptivePlacement ./internal/assessment/
func TestAdaptivePlacementPostgres(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	if err := database.MigrateUp(dbURL); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Connect(ctx, database.Options{URL: dbURL, MaxConns: 4})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	var items int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM assessment_items WHERE status = 'published'`).Scan(&items)
	if items == 0 {
		t.Skip("placement content not seeded (go run ./cmd/seed placement)")
	}

	// Turn the active configuration adaptive for the duration of this test, then put the
	// original back: every other test in this package expects fixed forms.
	var configID uuid.UUID
	var original json.RawMessage
	if err := pool.QueryRow(ctx,
		`SELECT id, config FROM assessment_configs WHERE kind = $1 AND status = 'active'`, KindPlacement).
		Scan(&configID, &original); err != nil {
		t.Skip("no active placement configuration")
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `UPDATE assessment_configs SET config = $2 WHERE id = $1`, configID, original)
	})
	if _, err := pool.Exec(ctx,
		`UPDATE assessment_configs SET config = config || '{"adaptive": true}'::jsonb WHERE id = $1`, configID); err != nil {
		t.Fatal(err)
	}

	user, err := users.NewPostgresRepository(pool).CreateAccount(ctx, users.NewAccount{
		Email: fmt.Sprintf("adaptive-%d@example.com", time.Now().UnixNano()), DisplayName: "Adaptive", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, user.ID) })

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	tracker := &analytics.Memory{}
	plans := personalization.NewService(pool, tracker)
	onb := onboarding.NewService(pool, plans, tracker)
	svc := NewService(Deps{Pool: pool, Storage: store, Queue: jobs.NewMemoryQueue(8), Evaluator: stubEvaluator{},
		Plans: plans, Progress: onb, Tracker: tracker, Log: slog.New(slog.DiscardHandler), MaxUploadBytes: 5 << 20})
	onb.SetPlacement(svc)

	id, err := svc.StartPlacement(ctx, user.ID, cefr.MustParse("C1"), "profile", "web")
	if err != nil {
		t.Fatal(err)
	}

	countItems := func(skill string) int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM assessment_section_items si
			JOIN assessment_sections s ON s.id = si.section_id
			WHERE s.assessment_id = $1 AND s.skill = $2`, id, skill).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	avgLevel := func(skill string) float64 {
		t.Helper()
		var avg *float64
		if err := pool.QueryRow(ctx, `
			SELECT avg(l.rank)::float8 FROM assessment_section_items si
			JOIN assessment_sections s ON s.id = si.section_id
			JOIN assessment_items i ON i.id = si.item_id
			JOIN levels l ON l.id = i.level_id
			WHERE s.assessment_id = $1 AND s.skill = $2`, id, skill).Scan(&avg); err != nil {
			t.Fatal(err)
		}
		if avg == nil {
			return -1
		}
		return *avg
	}

	t.Run("only the first section is fixed up front", func(t *testing.T) {
		if countItems("reading") == 0 {
			t.Error("the first section must be ready before the learner starts")
		}
		if n := countItems("listening"); n != 0 {
			t.Errorf("listening already has %d items; an adaptive section is chosen when it starts", n)
		}
	})

	t.Run("the overview still says how long an unfilled section is", func(t *testing.T) {
		view, err := svc.Get(ctx, user.ID, id)
		if err != nil {
			t.Fatal(err)
		}
		for _, sec := range view.Sections {
			if sec.Skill == "listening" && sec.ItemCount == 0 {
				t.Error("a locked adaptive section must still report its configured length")
			}
		}
	})

	// The learner reads far below what they claimed. This is what the reading section
	// would have written when it was scored.
	if _, err := pool.Exec(ctx, `
		INSERT INTO assessment_skill_results (assessment_id, skill, score, cefr, confidence, subscores, scoring_version)
		VALUES ($1, 'reading', 30, 'A2', 0.9, '{}', 'test')`, id); err != nil {
		t.Fatal(err)
	}
	// Reading finished, so listening opens — the same transition submitting reading makes.
	if _, err := pool.Exec(ctx, `
		UPDATE assessment_sections SET status = 'completed', completed_at = now()
		WHERE assessment_id = $1 AND skill = 'reading'`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE assessment_sections SET status = 'available' WHERE assessment_id = $1 AND skill = 'listening'`, id); err != nil {
		t.Fatal(err)
	}

	t.Run("the next section is chosen around what was measured, not what was claimed", func(t *testing.T) {
		if _, err := svc.StartSection(ctx, user.ID, id, "listening"); err != nil {
			t.Fatal(err)
		}
		if countItems("listening") == 0 {
			t.Fatal("starting an adaptive section must fill it")
		}
		readingLevel := avgLevel("reading")
		listeningLevel := avgLevel("listening")
		if listeningLevel < 0 {
			t.Fatal("no listening items")
		}
		if listeningLevel >= readingLevel {
			t.Errorf("listening averaged level rank %.2f against reading's %.2f — a learner who read at A2 "+
				"should not then be tested at the C1 they declared", listeningLevel, readingLevel)
		}
	})

	t.Run("restarting a filled section does not re-fill it", func(t *testing.T) {
		before := countItems("listening")
		if _, err := svc.StartSection(ctx, user.ID, id, "listening"); err != nil {
			t.Fatal(err)
		}
		if after := countItems("listening"); after != before {
			t.Errorf("items = %d, want them unchanged at %d", after, before)
		}
	})
}
