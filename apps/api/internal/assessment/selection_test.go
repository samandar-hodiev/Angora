package assessment

import (
	"math/rand/v2"
	"testing"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/assessment/scoring"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

// bank builds one stimulus with `per` questions for every level A1..C2.
func bank(per int) []candidate {
	var out []candidate
	for level := 1; level <= 6; level++ {
		stim := uuid.New()
		for p := 1; p <= per; p++ {
			out = append(out, candidate{ID: uuid.New(), Version: 1, Level: level, StimulusID: &stim, Position: p})
		}
	}
	return out
}

func tasks() []candidate {
	var out []candidate
	for level := 1; level <= 6; level++ {
		out = append(out, candidate{ID: uuid.New(), Version: 1, Level: level, Position: 1})
	}
	return out
}

var objectiveCounts = map[string]int{scoring.BandFoundation: 3, scoring.BandCore: 4, scoring.BandChallenge: 3}

func levelsByBand(picks []pick) map[string][]int {
	out := map[string][]int{}
	for _, p := range picks {
		out[p.Band] = append(out[p.Band], p.Level)
	}
	return out
}

func TestSelectObjectiveAroundStartLevel(t *testing.T) {
	picks, err := selectItems(bank(4), cefr.MustParse("B1"), objectiveCounts, rand.New(rand.NewPCG(1, 2)))
	if err != nil {
		t.Fatal(err)
	}
	if len(picks) != 10 {
		t.Fatalf("got %d items", len(picks))
	}
	got := levelsByBand(picks)
	for band, want := range map[string]int{scoring.BandFoundation: 2, scoring.BandCore: 3, scoring.BandChallenge: 4} {
		for _, l := range got[band] {
			if l != want {
				t.Errorf("%s items should be level %d, got %v", band, want, got[band])
			}
		}
	}
	// Easier first, and questions of one passage stay in authored order.
	if picks[0].Band != scoring.BandFoundation || picks[9].Band != scoring.BandChallenge {
		t.Errorf("order: first %s, last %s", picks[0].Band, picks[9].Band)
	}
	for i := 1; i < len(picks); i++ {
		if picks[i].Band == picks[i-1].Band && picks[i].Position < picks[i-1].Position {
			t.Errorf("positions out of order at %d", i)
		}
	}
}

func TestSelectAtEdgesFallsBackToNearestLevels(t *testing.T) {
	a1, err := selectItems(bank(4), cefr.MustParse("A1"), objectiveCounts, rand.New(rand.NewPCG(1, 2)))
	if err != nil {
		t.Fatal(err)
	}
	seen := map[uuid.UUID]bool{}
	for _, p := range a1 {
		if seen[p.ID] {
			t.Fatal("an item was selected twice")
		}
		seen[p.ID] = true
	}
	if got := levelsByBand(a1)[scoring.BandCore]; got[0] != 1 {
		t.Errorf("A1 core should be A1, got %v", got)
	}

	c1, err := selectItems(bank(4), cefr.MustParse("C1"), objectiveCounts, rand.New(rand.NewPCG(1, 2)))
	if err != nil {
		t.Fatal(err)
	}
	if got := levelsByBand(c1)[scoring.BandChallenge]; got[0] != 6 {
		t.Errorf("C1 challenge should be C2, got %v", got)
	}
}

func TestSelectTasks(t *testing.T) {
	picks, err := selectItems(tasks(), cefr.MustParse("B1"), map[string]int{scoring.BandCore: 1, scoring.BandChallenge: 1}, rand.New(rand.NewPCG(3, 4)))
	if err != nil {
		t.Fatal(err)
	}
	if len(picks) != 2 || picks[0].Level != 3 || picks[1].Level != 4 {
		t.Errorf("speaking picks = %+v", picks)
	}
}

func TestSelectFailsWithoutContent(t *testing.T) {
	if _, err := selectItems(tasks()[:1], cefr.MustParse("B1"), objectiveCounts, rand.New(rand.NewPCG(1, 1))); err == nil {
		t.Error("expected errNotEnoughContent")
	}
}

func TestConfigValidate(t *testing.T) {
	good := Config{GraceSeconds: 30, Sections: []SectionConfig{{Skill: "reading", TimeLimitSeconds: 60, Items: map[string]int{"core": 1}}}}
	if err := good.Validate(); err != nil {
		t.Errorf("valid config rejected: %v", err)
	}
	bad := Config{Sections: []SectionConfig{{Skill: "maths", TimeLimitSeconds: 0, Items: map[string]int{"extreme": 1}}}}
	if err := bad.Validate(); err == nil {
		t.Error("invalid config accepted")
	}
}
