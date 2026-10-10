package admin

import (
	"context"
	"testing"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
)

// reviewingAuthor keeps "look after" with a corrected Uzbek translation, rejects "explain" as
// the wrong kind and says nothing about "give up".
type reviewingAuthor struct{ stubAuthor }

func (*reviewingAuthor) ReviewLexicon(_ context.Context, kind string, _ []ai.LexiconReviewItem) (map[string]ai.LexiconReview, error) {
	return map[string]ai.LexiconReview{
		"look after": {Keep: true, Kind: kind, Definition: "to take care of someone", Uz: "g'amxo'rlik qilmoq", Ru: "заботиться",
			DefUz: "kimgadir g'amxo'rlik qilmoq", DefRu: "заботиться о ком-то"},
		"explain": {Keep: false, Kind: ai.KindWord, Reason: "wrong_kind"},
	}, nil
}

func TestReviewWordsKeepsOnlyWhatTheReviewerKeeps(t *testing.T) {
	m := NewModule(nil, &recordingAudit{}).WithAuthor(&reviewingAuthor{})
	entry := func(term string) checkedWord {
		return checkedWord{GeneratedWord: ai.GeneratedWord{
			Term: term, PartOfSpeech: "phrasal verb", Level: "B1", Definition: "wrong",
			Translations: map[string]string{"uz": "parvarish qilmoq"},
			LevelContent: map[string]ai.LevelText{"B1": {Definition: "wrong"}},
		}, source: "ai"}
	}
	kept, dropped, err := m.reviewWords(context.Background(), ai.KindPhrase, []checkedWord{entry("look after"), entry("explain"), entry("give up")})
	if err != nil {
		t.Fatal(err)
	}
	if len(kept) != 1 || dropped != 2 {
		t.Fatalf("kept %d dropped %d, want 1 and 2", len(kept), dropped)
	}
	w := kept[0]
	if w.Translations["uz"] != "g'amxo'rlik qilmoq" || w.Translations["def_ru"] == "" ||
		w.Definition != "to take care of someone" || w.LevelContent["B1"].Definition != "to take care of someone" {
		t.Errorf("corrections not applied: %+v", w)
	}
}
