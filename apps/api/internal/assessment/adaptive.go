package assessment

import (
	"context"
	"encoding/binary"
	"hash/fnv"
	"math/rand/v2"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

// Multi-stage adaptive placement.
//
// The fixed form picks all four sections when the test is created, around the level the
// learner said they were. That level is a guess by someone who, by definition, does not
// know their own level — it is why they are taking the test. A learner who says B1 and
// reads at A2 spends the rest of the test on material they cannot attempt, and the result
// is measured mostly by how far they fell off the bottom.
//
// Adaptive mode fixes that without changing a single client endpoint. Reading is still
// chosen up front from the self-declared level, because nothing better is known yet. Every
// later section is chosen when it starts, around what the completed sections actually
// measured. This is multi-stage (testlet) adaptation rather than item-by-item: the learner
// still gets a coherent block of questions around one passage, which is what makes reading
// and listening tests readable, and the client still receives a whole section at once.
//
// What it deliberately does not do is re-open scoring. The bands, the combination rules and
// the level each item targets are unchanged; only which items are shown moves.

// abilityEstimate is what the test knows about the learner so far.
//
// Sections that have already been scored outrank the self-declared level completely — a
// measurement beats a guess — and are averaged on the CEFR scale weighted by each one's
// confidence, the same way scoring.Combine treats skills. With nothing scored yet, the
// declared level stands.
func abilityEstimate(ctx context.Context, q interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, assessmentID uuid.UUID, declared cefr.Level) (cefr.Level, int, error) {
	rows, err := q.Query(ctx, `
		SELECT cefr, confidence::float8 FROM assessment_skill_results WHERE assessment_id = $1`, assessmentID)
	if err != nil {
		return declared, 0, err
	}
	defer rows.Close()

	var weighted, weight float64
	measured := 0
	for rows.Next() {
		var code string
		var confidence float64
		if err := rows.Scan(&code, &confidence); err != nil {
			return declared, 0, err
		}
		level, err := cefr.Parse(code)
		if err != nil {
			continue
		}
		// A result with no stated confidence still counts; it is evidence, just weak.
		w := max(0.1, confidence)
		weighted += level.Value() * w
		weight += w
		measured++
	}
	if err := rows.Err(); err != nil {
		return declared, 0, err
	}
	if measured == 0 || weight == 0 {
		return declared, 0, nil
	}
	return cefr.FromValue(weighted / weight), measured, nil
}

// fillSection chooses this section's items now, around the ability measured so far.
//
// Called when an adaptive section starts and has no items yet. If the item bank cannot
// serve the measured level, the declared level is tried before giving up: a learner who has
// begun a test must not be stopped halfway because one level is thin, and a fixed-form
// section is a far better outcome than an abandoned test.
func (s *Service) fillSection(ctx context.Context, tx pgx.Tx, a assessmentRow, sec sectionRow) error {
	sc, ok := a.Config.Section(sec.Skill)
	if !ok {
		return errUnavailable
	}
	cands, err := publishedCandidates(ctx, tx, sec.Skill)
	if err != nil {
		return err
	}

	target, _, err := abilityEstimate(ctx, tx, a.ID, a.StartLevel)
	if err != nil {
		return err
	}

	rng := sectionRNG(a.ID, sec.Skill)
	picks, err := selectItems(cands, target, sc.Items, rng)
	if err != nil && target != a.StartLevel {
		picks, err = selectItems(cands, a.StartLevel, sc.Items, sectionRNG(a.ID, sec.Skill))
	}
	if err != nil {
		return errUnavailable
	}

	for pos, p := range picks {
		if _, err := tx.Exec(ctx, `
			INSERT INTO assessment_section_items (section_id, item_id, item_version, position, band)
			VALUES ($1, $2, $3, $4, $5)`, sec.ID, p.ID, p.Version, pos+1, p.Band); err != nil {
			return err
		}
	}
	return nil
}

// publishedCandidates reads the item bank for one skill.
func publishedCandidates(ctx context.Context, q interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, skill string) ([]candidate, error) {
	rows, err := q.Query(ctx, `
		SELECT i.id, i.version, l.rank, i.stimulus_id, i.position
		FROM assessment_items i JOIN levels l ON l.id = i.level_id
		WHERE i.kind = $1 AND i.status = 'published' AND i.skill = $2`, KindPlacement, skill)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []candidate
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.ID, &c.Version, &c.Level, &c.StimulusID, &c.Position); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// sectionRNG is seeded from the assessment and the skill, so a section that is filled
// twice — a retry, a reconnect — produces the same form rather than a different test.
func sectionRNG(assessmentID uuid.UUID, skill string) *rand.Rand {
	h := fnv.New64a()
	_, _ = h.Write([]byte(skill))
	return rand.New(rand.NewPCG(binary.BigEndian.Uint64(assessmentID[:8])^h.Sum64(),
		binary.BigEndian.Uint64(assessmentID[8:])))
}

// adaptiveSkills are the sections that can be chosen adaptively: everything after the
// first. The first has nothing to adapt to.
func adaptiveSkills(cfg Config) map[string]bool {
	out := map[string]bool{}
	for i, sec := range cfg.Sections {
		if i > 0 {
			out[sec.Skill] = true
		}
	}
	return out
}
