package ai

import "testing"

func TestWordUsageClean(t *testing.T) {
	u := WordUsage{
		UsageNote:    "  Used at work. ",
		Register:     "Formal",
		Collocations: []string{"apply for a job", "Apply for a job", " ", "full-time job"},
		Synonyms:     []string{"Job", "occupation", "occupation", "profession"},
		WordFamily:   []string{"jobless"},
	}.Clean("job")
	if u.UsageNote != "Used at work." || u.Register != "formal" {
		t.Fatalf("trimmed fields: %+v", u)
	}
	if len(u.Collocations) != 2 {
		t.Fatalf("collocations: %v", u.Collocations)
	}
	if len(u.Synonyms) != 2 || u.Synonyms[0] != "occupation" {
		t.Fatalf("synonyms must drop the word itself and repeats: %v", u.Synonyms)
	}
	if (WordUsage{Register: "weird"}).Clean("x").Register != "" {
		t.Fatal("an unknown register must be dropped")
	}
	if !(WordUsage{}).Empty() || u.Empty() {
		t.Fatal("Empty")
	}
}

func TestCleanLadderDropsRepeatsAndFillsEveryLevel(t *testing.T) {
	l := CleanLadder("eat", "yemoq", "", []LadderRung{
		{Level: "B1", Term: "eat", NuanceUz: "x"},
		{Level: "A1", Term: "eat", NuanceUz: "yemoq"},
		{Level: "C2", Term: "devour", NuanceUz: "ochko'zlik bilan"},
		{Level: "C2", Term: "gobble"},
	})
	if len(l.Rungs) != 6 || l.Rungs[0].Level != "A1" || l.Rungs[5].Level != "C2" {
		t.Fatalf("rungs out of order: %+v", l.Rungs)
	}
	if l.Rungs[0].Term != "eat" || l.Rungs[2].Term != "" {
		t.Fatalf("a repeated word must leave its higher rung empty: %+v", l.Rungs)
	}
	if l.Rungs[5].Term != "devour" {
		t.Fatalf("first answer per level wins: %+v", l.Rungs[5])
	}
}

func TestKindOf(t *testing.T) {
	for pos, want := range map[string]string{"noun": KindWord, "phrasal verb": KindPhrase, "verb + noun": KindCollocation, "?": KindWord} {
		if got := KindOf(pos); got != want {
			t.Errorf("KindOf(%q) = %q, want %q", pos, got, want)
		}
	}
}
