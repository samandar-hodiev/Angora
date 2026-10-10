package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"strings"
	"sync"
)

// Lexicon review.
//
// The writer of a batch is not trusted to grade itself. Every generated entry goes past a
// second, separate call — an editor who has not seen the writer's reasoning — that answers
// three questions: is this really an entry of the kind it was filed under (a single word in
// Vocabulary, a phrasal verb, idiom or fixed phrase in Phrases, a natural word partnership in
// Collocations); is it fit to teach; and are its English definition and its Uzbek and Russian
// translations right in meaning and spelling. It corrects what is wrong and rejects what
// cannot be put right. Only what it keeps reaches the library.

const (
	LexiconReviewPrompt      = "lexicon_review.v1"
	TaskLexiconReview   Task = "lexicon_review"
)

// LexiconReviewItem is one entry for the editor to check.
type LexiconReviewItem struct {
	Term         string
	PartOfSpeech string
	Definition   string
	Examples     []string
	Uz, Ru       string
	RuPron       string
	DefUz, DefRu string
}

// LexiconReview is the editor's verdict on one entry. When Keep is true, the fields hold the
// entry as it should be stored — corrected where the writer was wrong, unchanged where not.
type LexiconReview struct {
	Keep       bool
	Kind       string
	Reason     string
	Definition string
	Uz, Ru     string
	RuPron     string
	DefUz      string
	DefRu      string
}

var kindDefinitionForReview = map[string]string{
	KindWord: "Vocabulary: exactly one English word (a hyphenated word counts as one). Anything of two or more words is NOT a word.",
	KindPhrase: "Phrases: a phrasal verb (look after, give up), an idiom (break the ice) or a fixed phrase learned as a whole (by the way, " +
		"as soon as). Never a single word; never a free combination or a collocation such as make a decision.",
	KindCollocation: "Collocations: two or three words that natively go together, where a synonym would sound wrong (make a decision, " +
		"heavy rain, deeply sorry, strong coffee). Never a single word, never a phrasal verb or idiom, never a combination any two words " +
		"could make (love someone, desire love).",
}

// reviewChunk is how many entries one review call reads. The reviewer is the strongest and
// slowest model; a few entries a call keep each call well inside the gateway's time limit, and
// the calls for a batch run side by side.
const reviewChunk = 3

// ReviewLexicon checks generated entries of one kind and returns a verdict for each, keyed by
// lower-case term. An entry missing from the answer has no verdict and must not be kept. If
// any part of the review fails, the whole review fails: nothing unreviewed is kept.
func (s *GrammarTutorService) ReviewLexicon(ctx context.Context, kind string, items []LexiconReviewItem) (map[string]LexiconReview, error) {
	out := map[string]LexiconReview{}
	var (
		mu       sync.Mutex
		wg       sync.WaitGroup
		firstErr error
	)
	for start := 0; start < len(items); start += reviewChunk {
		chunk := items[start:min(start+reviewChunk, len(items))]
		wg.Add(1)
		go func() {
			defer wg.Done()
			got, err := s.reviewLexiconChunk(ctx, kind, chunk)
			if err != nil && ctx.Err() == nil {
				// One more try: a slow answer now and then is the model, not the entries.
				got, err = s.reviewLexiconChunk(ctx, kind, chunk)
			}
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				if firstErr == nil {
					firstErr = err
				}
				return
			}
			maps.Copy(out, got)
		}()
	}
	wg.Wait()
	if firstErr != nil {
		return nil, firstErr
	}
	return out, nil
}

func (s *GrammarTutorService) reviewLexiconChunk(ctx context.Context, kind string, items []LexiconReviewItem) (map[string]LexiconReview, error) {
	out := map[string]LexiconReview{}
	if len(items) == 0 {
		return out, nil
	}
	str := map[string]any{"type": "string"}
	schema, _ := json.Marshal(map[string]any{
		"type": "object", "additionalProperties": false, "required": []string{"entries"},
		"properties": map[string]any{"entries": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object", "additionalProperties": false,
				"required": []string{"term", "actual_kind", "verdict", "reason", "definition", "uz", "ru", "ru_pronunciation", "uz_definition", "ru_definition"},
				"properties": map[string]any{
					"term":        str,
					"actual_kind": map[string]any{"type": "string", "enum": []string{KindWord, KindPhrase, KindCollocation, "none"}, "description": "What the entry really is, by the definitions given — not what it was filed as. none: not a standard English entry at all."},
					"verdict":     map[string]any{"type": "string", "enum": []string{"keep", "reject"}},
					"reason": map[string]any{"type": "string", "enum": []string{"ok", "wrong_kind", "not_standard", "inappropriate", "cannot_fix"},
						"description": "ok when kept."},
					"definition":       map[string]any{"type": "string", "description": "The English definition, corrected if it was wrong, unclear or circular (never define a word with itself)."},
					"uz":               map[string]any{"type": "string", "description": "The correct, natural Uzbek equivalent in the entry's main sense — what an Uzbek speaker actually says, never a word-for-word calque."},
					"ru":               map[string]any{"type": "string", "description": "The correct, natural Russian equivalent in the main sense."},
					"ru_pronunciation": map[string]any{"type": "string", "description": "How that Russian is said, in Uzbek Latin letters as it sounds (unstressed o reads as a), acute accent on the stressed vowel — e.g. достичь → dastích."},
					"uz_definition":    map[string]any{"type": "string", "description": "The (corrected) definition in plain, correct Uzbek."},
					"ru_definition":    map[string]any{"type": "string", "description": "The (corrected) definition in plain, correct Russian."},
				},
			},
		}},
	})
	var in strings.Builder
	for _, it := range items {
		fmt.Fprintf(&in, "TERM: %s\nPART OF SPEECH: %s\nDEFINITION: %s\nEXAMPLES: %s\nUZ: %s\nRU: %s\nRU_PRON: %s\nUZ_DEFINITION: %s\nRU_DEFINITION: %s\n\n",
			it.Term, it.PartOfSpeech, it.Definition, strings.Join(it.Examples, " | "), it.Uz, it.Ru, it.RuPron, it.DefUz, it.DefRu)
	}
	instructions := "You are the senior editor of a dictionary for Uzbek and Russian speakers learning English for IELTS. A junior writer " +
		"filed the entries below under " + kindDefinitionForReview[kind] + "\n" +
		"For every entry:\n" +
		"1. actual_kind: decide what the entry really is. If it is not the kind above, verdict reject, reason wrong_kind.\n" +
		"2. Reject (not_standard) an entry that is not a standard, commonly used English entry in this exact form (a sentence fragment " +
		"such as \"what time does\" or \"where is the\" is not an entry, nor is a whole sentence or question such as \"how much does it " +
		"cost\"), or that duplicates " +
		"another entry here in a different spelling (traveller / traveler).\n" +
		"3. Reject (inappropriate) anything sexual, vulgar, offensive or unsuitable for a family learning app.\n" +
		"4. Check the English definition against the term and the examples; rewrite it if it is wrong, vague or circular.\n" +
		"5. Check uz and ru with great care, in meaning first: they must be the equivalent a native speaker uses in this sense, a word or " +
		"two, not a definition and not a literal calque (break the ice is not \"muzni buzmoq\"; by the way is \"aytgancha\"; fall in love is " +
		"\"sevib qolmoq\"). Then spelling: " + UzbekOrthography + " Correct anything wrong; reject (cannot_fix) only when no good " +
		"equivalent exists.\n" +
		"6. uz_definition and ru_definition translate the final English definition faithfully, in correct, natural language.\n" +
		"Return every field for every entry, corrected or unchanged. Answer every term exactly as given."
	res, err := s.gateway.AnalyzeText(ctx, CallMeta{
		Task:          TaskLexiconReview,
		PromptVersion: LexiconReviewPrompt,
		Metadata:      map[string]any{"kind": "lexicon_review", "entry_kind": kind, "count": len(items)},
	}, AnalysisRequest{
		Model: s.lexiconReviewer(), Instructions: instructions, Input: in.String(), SchemaName: "lexicon_review", Schema: schema,
	})
	if err != nil {
		return nil, err
	}
	var raw struct {
		Entries []struct {
			Term       string `json:"term"`
			ActualKind string `json:"actual_kind"`
			Verdict    string `json:"verdict"`
			Reason     string `json:"reason"`
			Definition string `json:"definition"`
			Uz         string `json:"uz"`
			Ru         string `json:"ru"`
			RuPron     string `json:"ru_pronunciation"`
			DefUz      string `json:"uz_definition"`
			DefRu      string `json:"ru_definition"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(cleanModelJSON(res.Output), &raw); err != nil {
		return nil, fmt.Errorf("lexicon review is not valid JSON: %w", err)
	}
	for _, e := range raw.Entries {
		r := LexiconReview{
			Kind: e.ActualKind, Reason: e.Reason,
			Definition: strings.TrimSpace(e.Definition), Uz: NormalizeUzbek(e.Uz), Ru: strings.TrimSpace(e.Ru),
			RuPron: strings.TrimSpace(e.RuPron), DefUz: NormalizeUzbek(e.DefUz), DefRu: strings.TrimSpace(e.DefRu),
		}
		// Kept only when the editor kept it as the kind it was filed under, with every field
		// written, and Uzbek in Latin letters.
		r.Keep = e.Verdict == "keep" && e.ActualKind == kind && r.Definition != "" && r.Uz != "" && r.Ru != "" &&
			r.DefUz != "" && r.DefRu != "" && latinOnly(r.Uz) && latinOnly(r.DefUz)
		out[strings.ToLower(strings.TrimSpace(e.Term))] = r
	}
	return out, nil
}
