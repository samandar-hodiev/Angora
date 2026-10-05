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
