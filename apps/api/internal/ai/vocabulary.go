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
// One call per level: a list of words a learner at that level should learn next, each with a
// definition written at that level, examples, pronunciation and the word in Uzbek and Russian.
// The words already in the library are passed in so the model does not hand back the same
// twenty words every time it is asked.

const (
	VocabularyPrompt = "vocabulary_author.v1"
	SchemaVocabulary = "vocabulary_words"
)

// VocabularyRequest is one level's batch to write.
type VocabularyRequest struct {
	Level cefr.Level
	Count int
	/** Optional: a theme the words should come from — travel, work, feelings. */
	Theme string
	/** Words already in the library at any level, so they are not written again. */
	Exclude []string
	ActorID *uuid.UUID
}

// GeneratedWord is one word as the model wrote it.
type GeneratedWord struct {
	Term             string            `json:"term"`
	PartOfSpeech     string            `json:"part_of_speech"`
	Definition       string            `json:"definition"`
	Examples         []string          `json:"examples"`
	PronunciationIPA string            `json:"pronunciation_ipa"`
	Translations     map[string]string `json:"translations"`
	Tags             []string          `json:"tags"`
}

type generatedWords struct {
	Words []struct {
		GeneratedWord
		Uz string `json:"uz"`
		Ru string `json:"ru"`
	} `json:"words"`
}

// PartsOfSpeech are the values a word's part of speech may take.
var PartsOfSpeech = []string{"noun", "verb", "adjective", "adverb", "phrasal verb", "idiom", "phrase", "preposition", "conjunction", "pronoun", "determiner"}

var vocabularySchema = json.RawMessage(`{
  "type": "object",
  "additionalProperties": false,
  "required": ["words"],
  "properties": {
    "words": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["term", "part_of_speech", "definition", "examples", "pronunciation_ipa", "uz", "ru", "tags"],
        "properties": {
          "term": {"type": "string", "description": "The word or fixed phrase, lower case unless it is a proper noun."},
          "part_of_speech": {"type": "string", "enum": ["noun", "verb", "adjective", "adverb", "phrasal verb", "idiom", "phrase", "preposition", "conjunction", "pronoun", "determiner"]},
          "definition": {"type": "string", "description": "One sentence in English a learner at this level can read."},
          "examples": {"type": "array", "items": {"type": "string"}, "description": "Two natural sentences using the word."},
          "pronunciation_ipa": {"type": "string", "description": "British IPA between slashes, e.g. /ɪˈvɛntʃuəli/."},
          "uz": {"type": "string", "description": "The word in Uzbek (Latin script)."},
          "ru": {"type": "string", "description": "The word in Russian."},
          "tags": {"type": "array", "items": {"type": "string"}, "description": "One or two topic tags, e.g. travel, work."}
        }
      }
    }
  }
}`)

// WriteVocabulary writes one level's words.
func (s *GrammarTutorService) WriteVocabulary(ctx context.Context, req VocabularyRequest) ([]GeneratedWord, *EvaluationMeta, error) {
	count := min(max(req.Count, 5), 50)
	var b strings.Builder
	b.WriteString("You choose vocabulary for an English-learning app whose learners speak Uzbek or Russian. ")
	fmt.Fprintf(&b, "Write exactly %d words or fixed phrases that a learner at CEFR %s should learn next: ", count, req.Level.BaseCode())
	b.WriteString("genuinely at that level (the English Vocabulary Profile is a good guide), useful in everyday or exam English, and varied — not twenty words from one family.\n")
	b.WriteString("- definition: one sentence in English using only words simpler than the term itself; at A1/A2 very short.\n")
	b.WriteString("- examples: exactly two natural sentences a person would say, at the level.\n")
	b.WriteString("- uz and ru: the usual translation of the word in that sense — a word or two, not a definition.\n")
	b.WriteString("Never include a word from the excluded list, in any form.\n")

	input := fmt.Sprintf("LEVEL: %s\nCOUNT: %d\n", req.Level.BaseCode(), count)
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
		Metadata:      map[string]any{"kind": "vocabulary", "level": req.Level.BaseCode(), "count": count},
	}, AnalysisRequest{
		Model:        s.mainModel,
		Instructions: b.String(),
		Input:        input,
		SchemaName:   SchemaVocabulary,
		Schema:       vocabularySchema,
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
		word := w.GeneratedWord
		word.Translations = map[string]string{}
		if t := strings.TrimSpace(w.Uz); t != "" {
			word.Translations["uz"] = t
		}
		if t := strings.TrimSpace(w.Ru); t != "" {
			word.Translations["ru"] = t
		}
		out = append(out, word)
	}
	return out
}

// UsableWords keeps the words that can go in the library: a term and a definition, a known
// part of speech, nothing excluded, and no term twice.
func UsableWords(words []GeneratedWord, excluded map[string]bool) []GeneratedWord {
	known := map[string]bool{}
	for _, p := range PartsOfSpeech {
		known[p] = true
	}
	seen := map[string]bool{}
	kept := make([]GeneratedWord, 0, len(words))
	for _, w := range words {
		w.Term = strings.TrimSpace(w.Term)
		w.Definition = strings.TrimSpace(w.Definition)
		key := strings.ToLower(w.Term)
		if w.Term == "" || w.Definition == "" || !known[w.PartOfSpeech] || excluded[key] || seen[key] {
			continue
		}
		seen[key] = true
		examples := w.Examples[:0:0]
		for _, e := range w.Examples {
			if e = strings.TrimSpace(e); e != "" {
				examples = append(examples, e)
			}
		}
		w.Examples = examples
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
