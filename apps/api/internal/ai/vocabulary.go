package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

// Writing the lexicon: words, phrases and collocations.
//
// An entry is written once, explained once, at its own level — the level a learner usually
// meets it at. What differs between levels is the senses, not the wording: "run" is A1 for
// moving fast and B2 for running a company, so the other senses are listed, each with its own
// level. The owner asks for a kind and topics, not for levels; the model says each entry's
// level, and a second, independent call (CheckLevels) checks it.

const (
	VocabularyPrompt = "vocabulary_author.v5"
	SchemaVocabulary = "vocabulary_words"
	LevelCheckPrompt = "vocabulary_level_check.v1"
	SchemaLevelCheck = "vocabulary_levels"

	TaskVocabularyLevelCheck Task = "vocabulary_level_check"

	// VocabularyBatch is how many entries one call writes.
	VocabularyBatch = 10
)

// Kinds of lexicon entry.
const (
	KindWord        = "word"
	KindPhrase      = "phrase"
	KindCollocation = "collocation"
)

// KindPartsOfSpeech is what part_of_speech holds for each kind: a word class, a phrase type,
// or a collocation's pattern.
var KindPartsOfSpeech = map[string][]string{
	KindWord:        {"noun", "verb", "adjective", "adverb", "preposition", "conjunction", "pronoun", "determiner"},
	KindPhrase:      {"phrasal verb", "idiom", "phrase"},
	KindCollocation: {"verb + noun", "adjective + noun", "adverb + adjective", "adverb + verb", "noun + noun", "verb + preposition", "noun + preposition", "verb + adverb"},
}

// PartsOfSpeech are every value a part of speech may take, across kinds.
var PartsOfSpeech = func() []string {
	out := []string{}
	for _, k := range []string{KindWord, KindPhrase, KindCollocation} {
		out = append(out, KindPartsOfSpeech[k]...)
	}
	return out
}()

// KindOf is the kind an entry's part of speech belongs to.
func KindOf(partOfSpeech string) string {
	for kind, list := range KindPartsOfSpeech {
		if slices.Contains(list, partOfSpeech) {
			return kind
		}
	}
	return KindWord
}

// VocabularyRequest is one batch to write.
type VocabularyRequest struct {
	Count int
	/** word | phrase | collocation. */
	Kind string
	/** Topics the entries come from — nature, animals, work; empty for a mix. */
	Topics []string
	/** Optional bounds on the entries' own level. */
	MinLevel, MaxLevel string
	/** Entries already in the library, or written earlier in this run, so they are not written again. */
	Exclude []string
	ActorID *uuid.UUID
}

// LevelText is an entry explained for one level. New entries have one, at their own level;
// SameAs is only read on entries written before that.
type LevelText struct {
	Definition string   `json:"definition"`
	Examples   []string `json:"examples"`
	SameAs     string   `json:"same_as,omitempty"`
}

// Sense is one more meaning of an entry, at the level a learner meets that meaning.
type Sense struct {
	Definition string `json:"definition"`
	Level      string `json:"level"`
	Example    string `json:"example"`
}

// GeneratedWord is one entry as the model wrote it.
type GeneratedWord struct {
	Term         string `json:"term"`
	Kind         string `json:"kind"`
	PartOfSpeech string `json:"part_of_speech"`
	/** The level a learner usually meets the entry at, in its main sense. */
	Level            string            `json:"level"`
	PronunciationIPA string            `json:"pronunciation_ipa"`
	Translations     map[string]string `json:"translations"`
	Tags             []string          `json:"tags"`
	/** The explanation at its own level, as {level: text}. */
	LevelContent map[string]LevelText `json:"level_content"`
	Definition   string               `json:"definition"`
	Examples     []string             `json:"examples"`
	Senses       []Sense              `json:"senses"`
	Usage        WordUsage            `json:"usage"`
}

type generatedWords struct {
	Words []struct {
		Term             string    `json:"term"`
		PartOfSpeech     string    `json:"part_of_speech"`
		Level            string    `json:"level"`
		PronunciationIPA string    `json:"pronunciation_ipa"`
		Uz               string    `json:"uz"`
		Ru               string    `json:"ru"`
		RuPronunciation  string    `json:"ru_pronunciation"`
		Topics           []string  `json:"topics"`
		Definition       string    `json:"definition"`
		Examples         []string  `json:"examples"`
		Senses           []Sense   `json:"other_senses"`
		Usage            WordUsage `json:"usage"`
	} `json:"words"`
}

func vocabularySchema(kind string) json.RawMessage {
	pos := KindPartsOfSpeech[kind]
	if pos == nil {
		pos = KindPartsOfSpeech[KindWord]
	}
	posDescription := "The word class."
	switch kind {
	case KindPhrase:
		posDescription = "What kind of phrase it is."
	case KindCollocation:
		posDescription = "The collocation's pattern."
	}
	schema := map[string]any{
		"type": "object", "additionalProperties": false, "required": []string{"words"},
		"properties": map[string]any{
			"words": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object", "additionalProperties": false,
					"required": []string{"term", "part_of_speech", "level", "pronunciation_ipa", "uz", "ru", "ru_pronunciation",
						"topics", "definition", "examples", "other_senses", "usage"},
					"properties": map[string]any{
						"term":              map[string]any{"type": "string", "description": "The entry, lower case unless it is a proper noun."},
						"part_of_speech":    map[string]any{"type": "string", "enum": pos, "description": posDescription},
						"level":             map[string]any{"type": "string", "enum": cefrCodes, "description": "The CEFR level a learner usually meets the entry at in its main sense, by the English Vocabulary Profile."},
						"pronunciation_ipa": map[string]any{"type": "string", "description": "British IPA between slashes."},
						"uz":                map[string]any{"type": "string", "description": "The entry in Uzbek (Latin script)."},
						"ru":                map[string]any{"type": "string", "description": "The entry in Russian."},
						"ru_pronunciation":  map[string]any{"type": "string", "description": "How the Russian is said, in Uzbek Latin letters with the stressed vowel marked by an acute accent, e.g. dastích for достичь."},
						"topics":            map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "One or two topics from the requested ones, lower case."},
						"definition":        map[string]any{"type": "string", "description": "The main meaning only, in English a learner at the entry's level can read."},
						"examples":          map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Two natural sentences at that level."},
						"other_senses": map[string]any{
							"type": "array", "description": "0 to 3 other common meanings, each at the level a learner meets it.",
							"items": map[string]any{
								"type": "object", "additionalProperties": false, "required": []string{"definition", "level", "example"},
								"properties": map[string]any{
									"definition": map[string]any{"type": "string"},
									"level":      map[string]any{"type": "string", "enum": cefrCodes},
									"example":    map[string]any{"type": "string"},
								},
							},
						},
						"usage": wordUsageSchema,
					},
				},
			},
		},
	}
	raw, _ := json.Marshal(schema)
	return raw
}

var kindGuide = map[string]string{
	KindWord:        "single English words",
	KindPhrase:      "phrases learned as a whole: phrasal verbs (look after), idioms (break the ice) and fixed phrases (by the way) — never single words, never free combinations",
	KindCollocation: "collocations: two or three words that naturally go together where another word would sound wrong (make a decision, heavy rain, deeply sorry) — never single words, never idioms",
}

// WriteVocabulary writes one batch of entries of one kind.
func (s *GrammarTutorService) WriteVocabulary(ctx context.Context, req VocabularyRequest) ([]GeneratedWord, *EvaluationMeta, error) {
	count := min(max(req.Count, 1), 20)
	kind := req.Kind
	if kindGuide[kind] == "" {
		kind = KindWord
	}
	var b strings.Builder
	b.WriteString("You choose lexicon for an English-learning app whose learners speak Uzbek or Russian. ")
	fmt.Fprintf(&b, "Write exactly %d useful %s.\n", count, kindGuide[kind])
	b.WriteString("- Each entry is explained once, at its own level: definition is the main meaning only (no example in it), in English a learner at that level can read; examples are two natural sentences at that level.\n")
	b.WriteString("- level: the level a learner usually meets the entry at in its main sense, by the English Vocabulary Profile. Be strict and honest: everyday concrete words (bed, eat, house) are A1–A2 whatever topic they come from; never label an easy entry higher to look advanced.\n")
	b.WriteString("- other_senses: other common meanings that differ from the main one, each with the level it is met at (run: A1 move fast; B2 manage a business). Empty when there are none — never restate the main meaning.\n")
	b.WriteString("- usage.register: formal, informal, neutral and so on — how formal the entry is. " + wordUsageGuide + "\n")
	b.WriteString("- uz and ru: the usual translation in the main sense — a word or two, not a definition; a wrong or loosely related word is worse than none.\n")
	b.WriteString("- ru_pronunciation: how that Russian translation is said, in Uzbek Latin letters as it sounds (unstressed o reads as a), acute accent on the stressed vowel — e.g. достичь → dastích.\n")
	if req.MinLevel != "" || req.MaxLevel != "" {
		fmt.Fprintf(&b, "- Only entries whose own level is between %s and %s.\n", orDefault(req.MinLevel, "A1"), orDefault(req.MaxLevel, "C2"))
	} else {
		b.WriteString("- A natural mix of levels, from everyday to advanced.\n")
	}
	b.WriteString("Never include an entry from the excluded list, in any form, and never the same entry twice.\n")

	input := fmt.Sprintf("COUNT: %d\nKIND: %s\n", count, kind)
	if len(req.Topics) > 0 {
		input += "TOPICS: " + strings.Join(req.Topics, ", ") + "\n"
	}
	if len(req.Exclude) > 0 {
		input += "EXCLUDED (already in the library): " + strings.Join(req.Exclude, ", ") + "\n"
	}

	res, err := s.gateway.AnalyzeText(ctx, CallMeta{
		Task:          TaskContentGeneration,
		UserID:        req.ActorID,
		PromptVersion: VocabularyPrompt,
		Metadata:      map[string]any{"kind": "vocabulary", "entry_kind": kind, "topics": req.Topics, "count": count},
	}, AnalysisRequest{
		Model:        s.mainModel,
		Instructions: b.String(),
		Input:        input,
		SchemaName:   SchemaVocabulary,
		Schema:       vocabularySchema(kind),
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
	words := UsableWords(out.words(kind), excluded)
	if len(words) == 0 {
		return nil, nil, fmt.Errorf("no usable words came back")
	}
	return words, &EvaluationMeta{
		Versions:    Versions{SchemaVersion: GrammarSchemaVersion, ModelVersion: res.Model, PromptVersion: VocabularyPrompt},
		AIRequestID: res.AIRequestID,
	}, nil
}

func orDefault(s, d string) string {
	if s == "" {
		return d
	}
	return s
}

func (g generatedWords) words(kind string) []GeneratedWord {
	out := make([]GeneratedWord, 0, len(g.Words))
	for _, w := range g.Words {
		level := strings.ToUpper(strings.TrimSpace(w.Level))
		word := GeneratedWord{
			Term: w.Term, Kind: kind, PartOfSpeech: w.PartOfSpeech, Level: level, PronunciationIPA: w.PronunciationIPA,
			Tags: w.Topics, Translations: map[string]string{}, Usage: w.Usage, Senses: w.Senses,
			LevelContent: map[string]LevelText{level: {Definition: w.Definition, Examples: w.Examples}},
		}
		if t := strings.TrimSpace(w.Uz); t != "" {
			word.Translations["uz"] = t
		}
		if t := strings.TrimSpace(w.Ru); t != "" {
			word.Translations["ru"] = t
			if r := strings.TrimSpace(w.RuPronunciation); r != "" {
				word.Translations["ru_pron"] = r
			}
		}
		out = append(out, word)
	}
	return out
}

// LevelCheckItem is an entry whose level is to be checked.
type LevelCheckItem struct {
	Term         string
	PartOfSpeech string
	Definition   string
}

// CheckLevels asks, independently of whoever wrote the entries, at which level a learner meets
// each one in the given sense. The writer's level is not shown, so the answer is a second
// opinion rather than an echo. Returns lower-case term → level.
func (s *GrammarTutorService) CheckLevels(ctx context.Context, items []LevelCheckItem) (map[string]string, error) {
	if len(items) == 0 {
		return map[string]string{}, nil
	}
	schema, _ := json.Marshal(map[string]any{
		"type": "object", "additionalProperties": false, "required": []string{"levels"},
		"properties": map[string]any{"levels": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object", "additionalProperties": false, "required": []string{"term", "level"},
				"properties": map[string]any{
					"term":  map[string]any{"type": "string"},
					"level": map[string]any{"type": "string", "enum": cefrCodes},
				},
			},
		}},
	})
	var in strings.Builder
	for _, it := range items {
		fmt.Fprintf(&in, "- %s (%s): %s\n", it.Term, it.PartOfSpeech, it.Definition)
	}
	res, err := s.gateway.AnalyzeText(ctx, CallMeta{
		Task:          TaskVocabularyLevelCheck,
		PromptVersion: LevelCheckPrompt,
		Metadata:      map[string]any{"kind": "vocabulary_level_check", "count": len(items)},
	}, AnalysisRequest{
		Model: s.mainModel,
		Instructions: "You are a CEFR vocabulary examiner. For each English entry, in the sense given, say the level at which a learner " +
			"usually meets it, following the English Vocabulary Profile (and the English Grammar/Phrasal Verb profiles for phrases). " +
			"Be strict: everyday concrete words are A1–A2; a level is about the entry, not the topic it came from. Answer for every entry, in order.",
		Input:      in.String(),
		SchemaName: SchemaLevelCheck,
		Schema:     schema,
	})
	if err != nil {
		return nil, err
	}
	var out struct {
		Levels []struct {
			Term  string `json:"term"`
			Level string `json:"level"`
		} `json:"levels"`
	}
	if err := json.Unmarshal(res.Output, &out); err != nil {
		return nil, fmt.Errorf("level check is not valid JSON: %w", err)
	}
	levels := map[string]string{}
	for _, l := range out.Levels {
		levels[strings.ToLower(strings.TrimSpace(l.Term))] = strings.ToUpper(strings.TrimSpace(l.Level))
	}
	return levels, nil
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
		w.Usage = w.Usage.Clean(key)
		w.Kind = KindOf(w.PartOfSpeech)
		senses := []Sense{}
		for _, sense := range w.Senses {
			sense.Definition = strings.TrimSpace(sense.Definition)
			sense.Example = strings.TrimSpace(sense.Example)
			sense.Level = strings.ToUpper(strings.TrimSpace(sense.Level))
			if _, err := cefr.Parse(sense.Level); sense.Definition != "" && err == nil && len(senses) < 4 {
				senses = append(senses, sense)
			}
		}
		w.Senses = senses
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
