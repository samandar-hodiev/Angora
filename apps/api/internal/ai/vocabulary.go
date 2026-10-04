package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

// Writing vocabulary.
//
// A word is written once and explained for every level asked for: "consequence" is one entry,
// with a plain sentence and an everyday example for A1 and the collocations and register for
// C1. One call writes a small batch — a dozen words, each explained six ways, is about as much
// as a model writes carefully at once — and the words already in the library are passed in so
// the model does not hand back the same words every time it is asked.

const (
	VocabularyPrompt = "vocabulary_author.v2"
	SchemaVocabulary = "vocabulary_words"

	// VocabularyBatch is how many words one call writes.
	VocabularyBatch = 10
)

// VocabularyRequest is one batch to write.
type VocabularyRequest struct {
	Count int
	/** The levels each word is explained for. */
	Levels []cefr.Level
	/** Optional: a theme the words should come from — travel, work, feelings. */
	Theme string
	/** Words already in the library, or written earlier in this run, so they are not written again. */
	Exclude []string
	ActorID *uuid.UUID
}

// LevelText is a word explained for one level.
type LevelText struct {
	Definition string   `json:"definition"`
	Examples   []string `json:"examples"`
}

// GeneratedWord is one word as the model wrote it.
type GeneratedWord struct {
	Term         string `json:"term"`
	PartOfSpeech string `json:"part_of_speech"`
	/** How hard the word itself is: the level a learner usually meets it at. */
	Level            string            `json:"level"`
	PronunciationIPA string            `json:"pronunciation_ipa"`
	Translations     map[string]string `json:"translations"`
	Tags             []string          `json:"tags"`
	/** The explanation per CEFR level. */
	LevelContent map[string]LevelText `json:"level_content"`
	// Definition and Examples are the explanation at the word's own level — what a reader
	// that knows nothing of levels shows.
	Definition string   `json:"definition"`
	Examples   []string `json:"examples"`
}

type generatedWords struct {
	Words []struct {
		Term             string               `json:"term"`
		PartOfSpeech     string               `json:"part_of_speech"`
		Level            string               `json:"level"`
		PronunciationIPA string               `json:"pronunciation_ipa"`
		Uz               string               `json:"uz"`
		Ru               string               `json:"ru"`
		Tags             []string             `json:"tags"`
		Explanations     map[string]LevelText `json:"explanations"`
	} `json:"words"`
}

// PartsOfSpeech are the values a word's part of speech may take.
var PartsOfSpeech = []string{"noun", "verb", "adjective", "adverb", "phrasal verb", "idiom", "phrase", "preposition", "conjunction", "pronoun", "determiner"}

// vocabularySchema is the answer's shape for one set of levels. Each requested level is its
// own required key under "explanations" — a list of explanations could come back with one in
// it, and did, nineteen times in twenty; a required key cannot be left out.
func vocabularySchema(levels []string) json.RawMessage {
	explanation := map[string]any{
		"type": "object", "additionalProperties": false, "required": []string{"definition", "examples"},
		"properties": map[string]any{
			"definition": map[string]any{"type": "string", "description": "The meaning only, in English a learner at this level can read. No examples in it."},
			"examples":   map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Two natural sentences at this level."},
		},
	}
	perLevel := map[string]any{}
	for _, code := range levels {
		perLevel[code] = explanation
	}
	schema := map[string]any{
		"type": "object", "additionalProperties": false, "required": []string{"words"},
		"properties": map[string]any{
			"words": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object", "additionalProperties": false,
					"required": []string{"term", "part_of_speech", "level", "pronunciation_ipa", "uz", "ru", "tags", "explanations"},
					"properties": map[string]any{
						"term":              map[string]any{"type": "string", "description": "The word or fixed phrase, lower case unless it is a proper noun."},
						"part_of_speech":    map[string]any{"type": "string", "enum": PartsOfSpeech},
						"level":             map[string]any{"type": "string", "enum": cefrCodes, "description": "The CEFR level a learner usually meets this word at."},
						"pronunciation_ipa": map[string]any{"type": "string", "description": "British IPA between slashes, e.g. /ɪˈvɛntʃuəli/."},
						"uz":                map[string]any{"type": "string", "description": "The word in Uzbek (Latin script)."},
						"ru":                map[string]any{"type": "string", "description": "The word in Russian."},
						"tags":              map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "One or two topic tags, e.g. travel, work."},
						"explanations": map[string]any{
							"type": "object", "additionalProperties": false, "required": levels, "properties": perLevel,
							"description": "The word explained separately for each of these levels.",
						},
					},
				},
			},
		},
	}
	raw, _ := json.Marshal(schema)
	return raw
}

// WriteVocabulary writes one batch of words, each explained for every requested level.
func (s *GrammarTutorService) WriteVocabulary(ctx context.Context, req VocabularyRequest) ([]GeneratedWord, *EvaluationMeta, error) {
	count := min(max(req.Count, 1), 20)
	levels := levelCodes(req.Levels)
	if len(levels) == 0 {
		levels = []string{"A1", "A2", "B1", "B2", "C1", "C2"}
	}
	var b strings.Builder
	b.WriteString("You choose vocabulary for an English-learning app whose learners speak Uzbek or Russian. ")
	fmt.Fprintf(&b, "Write exactly %d useful words or fixed phrases, varied in topic and part of speech, and explain each one separately for every one of these CEFR levels: %s.\n", count, strings.Join(levels, ", "))
	b.WriteString("- level: the level a learner usually meets the word at, by the English Vocabulary Profile — everyday words like dusk or campground are not A1. Mix levels across the batch.\n")
	b.WriteString("- explanations: an entry for every requested level, none left out. The definition is the meaning only — never put an example in it. The explanations must genuinely differ: A1/A2 one very short sentence in the simplest words, with everyday examples; B1/B2 the main senses and common collocations; C1/C2 nuance, register, collocations and less common senses. Each has exactly two natural example sentences written at that level.\n")
	b.WriteString("- uz and ru: the usual translation of the word in its main sense — a word or two, not a definition.\n")
	b.WriteString("Never include a word from the excluded list, in any form, and never the same word twice.\n")

	input := fmt.Sprintf("COUNT: %d\nLEVELS: %s\n", count, strings.Join(levels, ", "))
	if t := strings.TrimSpace(req.Theme); t != "" {
		input += "THEME: " + t + "\n"
	}
	if len(req.Exclude) > 0 {
		input += "EXCLUDED (already in the library): " + strings.Join(req.Exclude, ", ") + "\n"
	}

	res, err := s.gateway.AnalyzeText(ctx, CallMeta{
		Task:          TaskContentGeneration,
		UserID:        req.ActorID,
		PromptVersion: VocabularyPrompt,
		Metadata:      map[string]any{"kind": "vocabulary", "levels": levels, "count": count},
	}, AnalysisRequest{
		Model:        s.mainModel,
		Instructions: b.String(),
		Input:        input,
		SchemaName:   SchemaVocabulary,
		Schema:       vocabularySchema(levels),
	})
	if err != nil {
		return nil, nil, err
	}
	var out generatedWords
	if err := json.Unmarshal(res.Output, &out); err != nil {
		return nil, nil, fmt.Errorf("generated vocabulary is not valid JSON: %w", err)
	}
	excluded := map[string]bool{}
	for _, e := range req.Exclude {
		excluded[strings.ToLower(strings.TrimSpace(e))] = true
	}
	words := UsableWords(out.words(), excluded)
	// A word missing a level it was asked for is half a word: dropped, and the run asks again.
	kept := words[:0]
	for _, w := range words {
		complete := true
		for _, code := range levels {
			if _, ok := w.LevelContent[code]; !ok {
				complete = false
			}
		}
		if complete {
			kept = append(kept, w)
		}
	}
	words = kept
	if len(words) == 0 {
		return nil, nil, fmt.Errorf("no usable words came back")
	}
	return words, &EvaluationMeta{
		Versions:    Versions{SchemaVersion: GrammarSchemaVersion, ModelVersion: res.Model, PromptVersion: VocabularyPrompt},
		AIRequestID: res.AIRequestID,
	}, nil
}

func (g generatedWords) words() []GeneratedWord {
	out := make([]GeneratedWord, 0, len(g.Words))
	for _, w := range g.Words {
		word := GeneratedWord{
			Term: w.Term, PartOfSpeech: w.PartOfSpeech, Level: w.Level, PronunciationIPA: w.PronunciationIPA,
			Tags: w.Tags, Translations: map[string]string{}, LevelContent: map[string]LevelText{},
		}
		if t := strings.TrimSpace(w.Uz); t != "" {
			word.Translations["uz"] = t
		}
		if t := strings.TrimSpace(w.Ru); t != "" {
			word.Translations["ru"] = t
		}
		for code, e := range w.Explanations {
			word.LevelContent[strings.ToUpper(strings.TrimSpace(code))] = e
		}
		out = append(out, word)
	}
	return out
}

var cefrCodes = []string{"A1", "A2", "B1", "B2", "C1", "C2"}

// UsableWords keeps the words that can go in the library — a term, a known part of speech,
// at least one explanation, nothing excluded, no term twice — and tidies what is kept: empty
// explanations and examples dropped, the word's own level checked, and Definition and
// Examples taken from the explanation at that level.
func UsableWords(words []GeneratedWord, excluded map[string]bool) []GeneratedWord {
	known := map[string]bool{}
	for _, p := range PartsOfSpeech {
		known[p] = true
	}
	seen := map[string]bool{}
	kept := make([]GeneratedWord, 0, len(words))
	for _, w := range words {
		w.Term = strings.TrimSpace(w.Term)
		key := strings.ToLower(w.Term)
		if w.Term == "" || !known[w.PartOfSpeech] || excluded[key] || seen[key] {
			continue
		}
		content := map[string]LevelText{}
		for _, code := range cefrCodes {
			t, ok := w.LevelContent[code]
			if !ok {
				continue
			}
			t.Definition = strings.TrimSpace(t.Definition)
			t.Examples = trimmedLines(t.Examples)
			if t.Definition != "" {
				content[code] = t
			}
		}
		// A word written by hand may come with only the plain definition: that is its
		// explanation at its own level.
		if len(content) == 0 && strings.TrimSpace(w.Definition) != "" {
			code := strings.ToUpper(strings.TrimSpace(w.Level))
			if code == "" {
				code = "B1"
			}
			content[code] = LevelText{Definition: strings.TrimSpace(w.Definition), Examples: trimmedLines(w.Examples)}
		}
		if len(content) == 0 {
			continue
		}
		w.LevelContent = content
		w.Level = strings.ToUpper(strings.TrimSpace(w.Level))
		if _, ok := cefr.Parse(w.Level); ok != nil || w.Level == "" {
			w.Level = nearestLevel(content, "B1")
		}
		own := content[nearestLevel(content, w.Level)]
		w.Definition, w.Examples = own.Definition, own.Examples
		seen[key] = true
		if w.Tags == nil {
			w.Tags = []string{}
		}
		if w.Translations == nil {
			w.Translations = map[string]string{}
		}
		kept = append(kept, w)
	}
	return kept
}

// nearestLevel is the level in content closest to want, the lower one first on a tie.
func nearestLevel(content map[string]LevelText, want string) string {
	if _, ok := content[want]; ok {
		return want
	}
	at := 2
	for i, c := range cefrCodes {
		if c == want {
			at = i
		}
	}
	for d := 1; d < len(cefrCodes); d++ {
		for _, i := range []int{at - d, at + d} {
			if i >= 0 && i < len(cefrCodes) {
				if _, ok := content[cefrCodes[i]]; ok {
					return cefrCodes[i]
				}
			}
		}
	}
	return want
}

func trimmedLines(in []string) []string {
	out := []string{}
	for _, s := range in {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}
