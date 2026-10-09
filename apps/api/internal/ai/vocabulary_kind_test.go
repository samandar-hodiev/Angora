package ai

import "testing"

func TestFitsKind(t *testing.T) {
	cases := []struct {
		term, kind string
		want       bool
	}{
		{"explain", KindPhrase, false},
		{"to mention", KindPhrase, false},
		{"together", KindCollocation, false},
		{"look after", KindPhrase, true},
		{"to be honest", KindPhrase, true},
		{"make a decision", KindCollocation, true},
		{"bed", KindWord, true},
		{"bus station", KindWord, true},
	}
	for _, c := range cases {
		if got := FitsKind(c.term, c.kind); got != c.want {
			t.Errorf("FitsKind(%q, %s) = %v, want %v", c.term, c.kind, got, c.want)
		}
	}
}

func TestUsableWordsDropsSingleWordPhrases(t *testing.T) {
	entry := func(term, pos string) GeneratedWord {
		return GeneratedWord{Term: term, PartOfSpeech: pos, Level: "B1", LevelContent: map[string]LevelText{"B1": {Definition: "d"}}}
	}
	kept := UsableWords([]GeneratedWord{
		entry("explain", "phrasal verb"), entry("together", "adverb + verb"), entry("look after", "phrasal verb"),
	}, nil)
	if len(kept) != 1 || kept[0].Term != "look after" {
		t.Errorf("kept %+v, want only look after", kept)
	}
}
