package assessment

import (
	"errors"
	"math/rand/v2"
	"sort"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/assessment/scoring"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

// candidate is a published assessment item considered for a section.
type candidate struct {
	ID         uuid.UUID
	Version    int
	Level      int // CEFR base 1..6
	StimulusID *uuid.UUID
	Position   int
}

type pick struct {
	candidate
	Band string
}

var errNotEnoughContent = errors.New("not enough published assessment content")

var bandOffset = map[string]int{scoring.BandFoundation: -1, scoring.BandCore: 0, scoring.BandChallenge: 1}

// selectItems chooses a fixed test form for one section around the learner's starting level:
// foundation items one level below, core items at the level, challenge items one level above
// (e.g. A2 foundation → B1 core → B2 challenge), so the result can show whether the learner is
// below, at or above where they think they are.
//
// Items that share a stimulus (a passage or an audio clip) are taken together in their authored
// order, so a learner never sees half-related questions scattered across the test. When a level
// has too little content, the nearest level in the band's direction is used. rng varies which
// stimulus is used when several exist, while the chosen form is then stored and never changes.
//
// This fixed-form selection is the MVP; an adaptive engine can replace it by choosing one item
// at a time from the same item bank.
func selectItems(cands []candidate, start cefr.Level, counts map[string]int, rng *rand.Rand) ([]pick, error) {
	type group struct {
		key   uuid.UUID
		level int
		items []candidate
	}
	groups := map[uuid.UUID]*group{}
	var keys []uuid.UUID
	for _, c := range cands {
		key := c.ID
		if c.StimulusID != nil {
			key = *c.StimulusID
		}
		g, ok := groups[key]
		if !ok {
			g = &group{key: key, level: c.Level}
			groups[key] = g
			keys = append(keys, key)
		}
		g.items = append(g.items, c)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i].String() < keys[j].String() })
	byLevel := map[int][]*group{}
	for _, k := range keys {
		g := groups[k]
		sort.SliceStable(g.items, func(i, j int) bool { return g.items[i].Position < g.items[j].Position })
		byLevel[g.level] = append(byLevel[g.level], g)
	}

	used := map[uuid.UUID]bool{}
	chosen := map[string][]pick{}
	// Core first so the learner's own level always gets its best-matching content.
	for _, band := range []string{scoring.BandCore, scoring.BandFoundation, scoring.BandChallenge} {
		need := counts[band]
		if need <= 0 {
			continue
		}
		target := max(cefr.MinBase, min(cefr.MaxBase, start.Base+bandOffset[band]))
		for _, level := range searchOrder(target, band) {
			pool := append([]*group(nil), byLevel[level]...)
			rng.Shuffle(len(pool), func(i, j int) { pool[i], pool[j] = pool[j], pool[i] })
			for _, g := range pool {
				if need == 0 {
					break
				}
				if used[g.key] {
					continue
				}
				used[g.key] = true
				for _, it := range g.items {
					if need == 0 {
						break
					}
					chosen[band] = append(chosen[band], pick{candidate: it, Band: band})
					need--
				}
			}
			if need == 0 {
				break
			}
		}
		if need > 0 {
			return nil, errNotEnoughContent
		}
	}

	// Present easier material first.
	var out []pick
	for _, band := range []string{scoring.BandFoundation, scoring.BandCore, scoring.BandChallenge} {
		out = append(out, chosen[band]...)
	}
	return out, nil
}

// searchOrder lists levels by distance from target; ties go in the band's direction
// (down for foundation and core, up for challenge).
func searchOrder(target int, band string) []int {
	order := []int{target}
	for d := 1; d < cefr.MaxBase; d++ {
		first, second := target-d, target+d
		if band == scoring.BandChallenge {
			first, second = second, first
		}
		for _, l := range []int{first, second} {
			if l >= cefr.MinBase && l <= cefr.MaxBase {
				order = append(order, l)
			}
		}
	}
	return order
}
