package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/google/uuid"
)

// Vocabulary beyond the definition: how a word is used, and how it differs from its neighbours.
//
// A definition and a translation tell a learner what a word means. They do not tell them that
// "occupation" is what a form asks for and "job" is what a friend asks about, though both are
// "kasb". WordUsage is written once per word and shared by everyone; a comparison is written
// once per set of words and level, and cached by the caller.

const (
	VocabularyEnrichPrompt  = "vocabulary_enrich.v1"
	VocabularyComparePrompt = "vocabulary_compare.v2"
	SchemaVocabularyEnrich  = "vocabulary_usage"
	SchemaVocabularyCompare = "vocabulary_comparison"

	TaskVocabularyEnrich  Task = "vocabulary_enrich"
	TaskVocabularyCompare Task = "vocabulary_compare"
)

// Registers are the values a word's register may take.
var Registers = []string{"neutral", "formal", "informal", "spoken", "written", "technical", "literary", "slang"}

// WordUsage is how a word is used: what it goes with, how formal it is, what is near it.
type WordUsage struct {
	/** When and how the word is used, in one or two plain sentences. */
	UsageNote string `json:"usage_note"`
	Register  string `json:"register"`
	/** Words it is usually found with: "apply for a job", "full-time job". */
	Collocations []string `json:"collocations"`
	/** Near-synonyms a learner might confuse it with: the words worth comparing. */
	Synonyms []string `json:"synonyms"`
	Antonyms []string `json:"antonyms"`
	/** Related forms: employ, employer, employment. */
	WordFamily []string `json:"word_family"`
	/** The mistake an Uzbek or Russian speaker typically makes with it, with the fix. */
	CommonMistake string `json:"common_mistake"`
}

var wordUsageSchema = map[string]any{
	"type": "object", "additionalProperties": false,
	"required": []string{"usage_note", "register", "collocations", "synonyms", "antonyms", "word_family", "common_mistake"},
	"properties": map[string]any{
		"usage_note":     map[string]any{"type": "string", "description": "When and how the word is used, in one or two plain sentences."},
		"register":       map[string]any{"type": "string", "enum": Registers},
		"collocations":   map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "3 to 6 common word partnerships, e.g. apply for a job."},
		"synonyms":       map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "2 to 4 near-synonyms, single words or short phrases."},
		"antonyms":       map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "0 to 3 opposites; empty when none is natural."},
		"word_family":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Other forms of the same root, e.g. employ, employer, employment."},
		"common_mistake": map[string]any{"type": "string", "description": "One typical mistake an Uzbek or Russian speaker makes with this word, and the correct form; empty if none is typical."},
	},
}

const wordUsageGuide = "usage_note says when and how the word is used, in plain English; register is how formal it is; " +
	"collocations are 3–6 natural partnerships a learner can copy (apply for a job, a full-time job); synonyms are 2–4 near-synonyms " +
	"a learner could confuse it with — the words worth comparing it to; antonyms only where an opposite is natural; " +
	"word_family the other forms of its root; common_mistake one typical error an Uzbek or Russian speaker makes with it, written as " +
	"✗ wrong → ✓ right with a short reason, or empty."

// Clean trims every list, drops the word itself and duplicates, and caps the lists, so a
// sloppy answer cannot fill a page.
func (u WordUsage) Clean(term string) WordUsage {
	term = strings.ToLower(strings.TrimSpace(term))
	list := func(in []string, limit int) []string {
		out := []string{}
		seen := map[string]bool{term: true}
		for _, s := range in {
			s = strings.TrimSpace(s)
			k := strings.ToLower(s)
			if s == "" || seen[k] || len(s) > 80 {
				continue
			}
			seen[k] = true
			out = append(out, s)
			if len(out) == limit {
				break
			}
		}
		return out
	}
	u.UsageNote = strings.TrimSpace(u.UsageNote)
	u.CommonMistake = strings.TrimSpace(u.CommonMistake)
	u.Register = strings.ToLower(strings.TrimSpace(u.Register))
	if !slices.Contains(Registers, u.Register) {
		u.Register = ""
	}
	// Collocations contain the word itself, so only duplicates go.
	seen := map[string]bool{}
	collocations := []string{}
	for _, s := range u.Collocations {
		s = strings.TrimSpace(s)
		if s != "" && !seen[strings.ToLower(s)] && len(s) <= 80 && len(collocations) < 8 {
			seen[strings.ToLower(s)] = true
			collocations = append(collocations, s)
		}
	}
	u.Collocations = collocations
	u.Synonyms = list(u.Synonyms, 6)
	u.Antonyms = list(u.Antonyms, 4)
	u.WordFamily = list(u.WordFamily, 6)
	return u
}

// Empty reports whether nothing about the word's use is known.
func (u WordUsage) Empty() bool {
	return u.UsageNote == "" && len(u.Collocations) == 0 && len(u.Synonyms) == 0
}

// EnrichRequest is a word already in the library that has no usage written for it.
type EnrichRequest struct {
	Term         string
	PartOfSpeech string
	Level        string
	Definition   string
}

// EnrichWord writes how one existing word is used.
func (s *GrammarTutorService) EnrichWord(ctx context.Context, req EnrichRequest) (WordUsage, *EvaluationMeta, error) {
	schema, _ := json.Marshal(map[string]any{
		"type": "object", "additionalProperties": false, "required": []string{"usage"},
		"properties": map[string]any{"usage": wordUsageSchema},
	})
	instructions := "You write vocabulary notes for an English-learning app whose learners speak Uzbek or Russian. " +
		"For the word given, describe how it is used. " + wordUsageGuide + " Write for the sense given by the definition and the part of speech given — collocations and the common mistake use the word as that part of speech."
	input := fmt.Sprintf("WORD: %s\nPART OF SPEECH: %s\nLEVEL: %s\nDEFINITION: %s\n", req.Term, req.PartOfSpeech, req.Level, req.Definition)
	res, err := s.gateway.AnalyzeText(ctx, CallMeta{
		Task:          TaskVocabularyEnrich,
		PromptVersion: VocabularyEnrichPrompt,
		Metadata:      map[string]any{"kind": "vocabulary_enrich", "term": req.Term},
	}, AnalysisRequest{
		Model: s.mainModel, Instructions: instructions, Input: input,
		SchemaName: SchemaVocabularyEnrich, Schema: schema,
	})
	if err != nil {
		return WordUsage{}, nil, err
	}
	var out struct {
		Usage WordUsage `json:"usage"`
	}
	if err := json.Unmarshal(res.Output, &out); err != nil {
		return WordUsage{}, nil, fmt.Errorf("word usage is not valid JSON: %w", err)
	}
	usage := out.Usage.Clean(req.Term)
	if usage.Empty() {
		return WordUsage{}, nil, fmt.Errorf("no usable word usage came back")
	}
	return usage, &EvaluationMeta{
		Versions:    Versions{ModelVersion: res.Model, PromptVersion: VocabularyEnrichPrompt},
		AIRequestID: res.AIRequestID,
	}, nil
}

// CompareRequest is two or three words a learner wants told apart.
type CompareRequest struct {
	Terms []string
	/** The learner's CEFR level: the English of the answer is written for it. */
	Level  string
	UserID *uuid.UUID
}

// WordComparison answers "what is the difference between job and occupation?".
type WordComparison struct {
	/** The answer in one or two sentences. */
	Verdict string `json:"verdict"`
	/** never | sometimes | often: whether one can replace the other. */
	Interchangeable string            `json:"interchangeable"`
	Words           []ComparedWord    `json:"words"`
	Differences     []CompareAspect   `json:"differences"`
	Tip             string            `json:"tip"`
	NativeNote      map[string]string `json:"native_note"`
	Quiz            []CompareQuizItem `json:"quiz"`
	/** Terms that are not English words; when any is set the rest is empty. */
	Invalid []string `json:"invalid"`
}

type ComparedWord struct {
	Term         string            `json:"term"`
	PartOfSpeech string            `json:"part_of_speech"`
	Meaning      string            `json:"meaning"`
	WhenToUse    string            `json:"when_to_use"`
	Register     string            `json:"register"`
	Collocations []string          `json:"collocations"`
	Examples     []string          `json:"examples"`
	Translations map[string]string `json:"translations"`
}

type CompareAspect struct {
	Aspect string `json:"aspect"`
	/** One point per word, in the order of Words. */
	Points []string `json:"points"`
}

type CompareQuizItem struct {
	/** A sentence with ___ where one of the words goes. */
	Sentence    string `json:"sentence"`
	Answer      string `json:"answer"`
	Explanation string `json:"explanation"`
}

var compareSchema = json.RawMessage(`{
  "type": "object", "additionalProperties": false,
  "required": ["invalid", "verdict", "interchangeable", "words", "differences", "tip", "uz", "ru", "quiz"],
  "properties": {
    "invalid": {"type": "array", "items": {"type": "string"}, "description": "Any given term that is not an English word or phrase. Empty when all are."},
    "verdict": {"type": "string", "description": "The difference in one or two plain sentences."},
    "interchangeable": {"type": "string", "enum": ["never", "sometimes", "often"]},
    "words": {"type": "array", "items": {
      "type": "object", "additionalProperties": false,
      "required": ["term", "part_of_speech", "meaning", "when_to_use", "register", "collocations", "examples", "uz", "ru"],
      "properties": {
        "term": {"type": "string"},
        "part_of_speech": {"type": "string"},
        "meaning": {"type": "string", "description": "The core meaning, one sentence."},
        "when_to_use": {"type": "string", "description": "The situations this word is the right choice in."},
        "register": {"type": "string", "enum": ["neutral", "formal", "informal", "spoken", "written", "technical", "literary", "slang"]},
        "collocations": {"type": "array", "items": {"type": "string"}, "description": "3 typical partnerships."},
        "examples": {"type": "array", "items": {"type": "string"}, "description": "2 natural sentences, each using the term as the part_of_speech you give it."},
        "uz": {"type": "string", "description": "The word in Uzbek (Latin script)."},
        "ru": {"type": "string", "description": "The word in Russian."}
      }
    }},
    "differences": {"type": "array", "items": {
      "type": "object", "additionalProperties": false, "required": ["aspect", "points"],
      "properties": {
        "aspect": {"type": "string", "description": "What is compared: meaning, formality, countability, typical context, grammar…"},
        "points": {"type": "array", "items": {"type": "string"}, "description": "One short point per word, in the order of words."}
      }
    }},
    "tip": {"type": "string", "description": "One memorable rule of thumb for choosing."},
    "uz": {"type": "string", "description": "The difference explained in Uzbek (Latin script), two or three sentences."},
    "ru": {"type": "string", "description": "The difference explained in Russian, two or three sentences."},
    "quiz": {"type": "array", "items": {
      "type": "object", "additionalProperties": false, "required": ["sentence", "answer", "explanation"],
      "properties": {
        "sentence": {"type": "string", "description": "A sentence with ___ where exactly one of the words fits best."},
        "answer": {"type": "string", "description": "The word that fits, exactly as given."},
        "explanation": {"type": "string", "description": "Why, in one sentence."}
      }
    }}
  }
}`)

// CompareWords explains how two or three words differ and when to use each.
func (s *GrammarTutorService) CompareWords(ctx context.Context, req CompareRequest) (*WordComparison, *EvaluationMeta, error) {
	level := req.Level
	if level == "" {
		level = "B1"
	}
	var b strings.Builder
	b.WriteString("You are an English teacher for learners who speak Uzbek or Russian. A learner asks how these words differ. ")
	b.WriteString("Often they translate to the same Uzbek or Russian word, which is exactly why the learner is confused.\n")
	fmt.Fprintf(&b, "- Write every English text so a %s learner can read it: short sentences, simple words at A1–A2, more nuance at C1–C2.\n", level)
	b.WriteString("- words: one entry per given term, in the given order, in the sense in which the terms are near each other. Each word's part_of_speech, meaning, collocations and examples must agree: if you call love a noun, its examples use the noun (Love is patient), never the verb (I love you).\n")
	b.WriteString("- differences: 3 to 5 aspects where they genuinely differ (meaning, formality, typical context, countability, grammar patterns, connotation); never invent a difference.\n")
	b.WriteString("- quiz: 4 sentences, each with ___ where exactly one of the words fits best and the others sound wrong or odd; use every word as an answer at least once.\n")
	b.WriteString("- uz and ru: the same difference told in the learner's language, so it cannot be misunderstood.\n")
	b.WriteString("- invalid: any term that is not an English word or phrase (misspelt, another language, nonsense). If any term is invalid, leave everything else empty.\n")

	input := "TERMS: " + strings.Join(req.Terms, " | ") + "\nLEVEL: " + level + "\n"
	res, err := s.gateway.AnalyzeText(ctx, CallMeta{
		Task:          TaskVocabularyCompare,
		UserID:        req.UserID,
		PromptVersion: VocabularyComparePrompt,
		Metadata:      map[string]any{"kind": "vocabulary_compare", "terms": req.Terms, "level": level},
	}, AnalysisRequest{
		Model: s.mainModel, Instructions: b.String(), Input: input,
		SchemaName: SchemaVocabularyCompare, Schema: compareSchema,
	})
	if err != nil {
		return nil, nil, err
	}
	var raw struct {
		Invalid         []string `json:"invalid"`
		Verdict         string   `json:"verdict"`
		Interchangeable string   `json:"interchangeable"`
		Words           []struct {
			ComparedWord
			Uz string `json:"uz"`
			Ru string `json:"ru"`
		} `json:"words"`
		Differences []CompareAspect   `json:"differences"`
		Tip         string            `json:"tip"`
		Uz          string            `json:"uz"`
		Ru          string            `json:"ru"`
		Quiz        []CompareQuizItem `json:"quiz"`
	}
	if err := json.Unmarshal(res.Output, &raw); err != nil {
		return nil, nil, fmt.Errorf("word comparison is not valid JSON: %w", err)
	}
	out := &WordComparison{
		Verdict: strings.TrimSpace(raw.Verdict), Interchangeable: raw.Interchangeable, Tip: strings.TrimSpace(raw.Tip),
		Invalid: trimmedLines(raw.Invalid), NativeNote: map[string]string{},
		Words: []ComparedWord{}, Differences: []CompareAspect{}, Quiz: []CompareQuizItem{},
	}
	if len(out.Invalid) > 0 {
		return out, metaFor(res), nil
	}
	if t := strings.TrimSpace(raw.Uz); t != "" {
		out.NativeNote["uz"] = t
	}
	if t := strings.TrimSpace(raw.Ru); t != "" {
		out.NativeNote["ru"] = t
	}
	for _, w := range raw.Words {
		cw := w.ComparedWord
		cw.Translations = map[string]string{}
		if t := strings.TrimSpace(w.Uz); t != "" {
			cw.Translations["uz"] = t
		}
		if t := strings.TrimSpace(w.Ru); t != "" {
			cw.Translations["ru"] = t
		}
		cw.Collocations = trimmedLines(cw.Collocations)
		cw.Examples = trimmedLines(cw.Examples)
		out.Words = append(out.Words, cw)
	}
	for _, d := range raw.Differences {
		if strings.TrimSpace(d.Aspect) != "" && len(d.Points) == len(out.Words) {
			out.Differences = append(out.Differences, d)
		}
	}
	// A quiz item whose answer is not one of the words cannot be marked.
	for _, q := range raw.Quiz {
		for _, w := range out.Words {
			if strings.EqualFold(strings.TrimSpace(q.Answer), w.Term) && strings.Contains(q.Sentence, "___") {
				q.Answer = w.Term
				out.Quiz = append(out.Quiz, q)
				break
			}
		}
	}
	if len(out.Words) < 2 || out.Verdict == "" {
		return nil, nil, fmt.Errorf("no usable comparison came back")
	}
	return out, metaFor(res), nil
}

func metaFor(res *AnalysisResponse) *EvaluationMeta {
	return &EvaluationMeta{
		Versions:    Versions{ModelVersion: res.Model, PromptVersion: VocabularyComparePrompt},
		AIRequestID: res.AIRequestID,
	}
}

// Level ladders.
//
// "big → large → huge → enormous → immense → colossal": one meaning, and the word a learner
// would use for it at each level. It answers the question a learner moving from B1 to B2
// actually has — what do I say instead? A level with no natural word is left empty rather
// than filled with the same word again.

const (
	VocabularyLadderPrompt = "vocabulary_ladder.v1"
	SchemaVocabularyLadder = "vocabulary_ladder"

	TaskVocabularyLadder Task = "vocabulary_ladder"
)

// LadderRung is the word for the meaning at one level; Term is empty when there is none.
type LadderRung struct {
	Level    string `json:"level"`
	Term     string `json:"term"`
	Register string `json:"register"`
	/** What this word adds over the one below, in Uzbek. */
	NuanceUz string `json:"nuance_uz"`
	Example  string `json:"example"`
}

// Ladder is a word's meaning, climbed level by level.
type Ladder struct {
	Term string `json:"term"`
	/** The meaning the ladder follows, in Uzbek: "katta (o'lchami)". */
	MeaningUz string `json:"meaning_uz"`
	/** How to use the ladder, in Uzbek: one or two sentences. */
	SummaryUz string       `json:"summary_uz"`
	Rungs     []LadderRung `json:"rungs"`
	Invalid   bool         `json:"invalid"`
}

var ladderSchema = json.RawMessage(`{
  "type": "object", "additionalProperties": false,
  "required": ["is_english", "meaning_uz", "summary_uz", "rungs"],
  "properties": {
    "is_english": {"type": "boolean", "description": "False when the given term is not an English word or phrase."},
    "meaning_uz": {"type": "string", "description": "The meaning the ladder follows, in Uzbek (Latin), a few words."},
    "summary_uz": {"type": "string", "description": "In Uzbek (Latin), one or two sentences on how the words differ as the level rises."},
    "rungs": {"type": "array", "description": "Exactly one entry per level, A1 to C2, in order.", "items": {
      "type": "object", "additionalProperties": false,
      "required": ["level", "term", "register", "nuance_uz", "example"],
      "properties": {
        "level": {"type": "string", "enum": ["A1", "A2", "B1", "B2", "C1", "C2"]},
        "term": {"type": "string", "description": "The word or short phrase for this meaning that a learner meets at this level; empty when no natural one exists. Never repeat a word used at another level."},
        "register": {"type": "string", "enum": ["", "neutral", "formal", "informal", "spoken", "written", "technical", "literary", "slang"]},
        "nuance_uz": {"type": "string", "description": "In Uzbek (Latin): what this word means or adds compared with the one below. Empty when term is empty."},
        "example": {"type": "string", "description": "One natural English sentence with the word. Empty when term is empty."}
      }
    }}
  }
}`)

// WriteLadder climbs one meaning of a word through the levels.
func (s *GrammarTutorService) WriteLadder(ctx context.Context, term string, userID *uuid.UUID) (*Ladder, *EvaluationMeta, error) {
	instructions := "You are an English teacher for learners who speak Uzbek. Given an English word, take its main meaning and give, " +
		"for each CEFR level A1 to C2, the word or short phrase a learner meets for that same meaning at that level, by the English " +
		"Vocabulary Profile — from the plainest to the most precise or literary (big → large → huge → enormous → immense → colossal). " +
		"The given word sits at its own level. Every word appears once: when a level has no natural word of its own, leave that rung empty " +
		"rather than repeating one. Explanations are in Uzbek (Latin script); examples in English."
	res, err := s.gateway.AnalyzeText(ctx, CallMeta{
		Task:          TaskVocabularyLadder,
		UserID:        userID,
		PromptVersion: VocabularyLadderPrompt,
		Metadata:      map[string]any{"kind": "vocabulary_ladder", "term": term},
	}, AnalysisRequest{
		Model: s.mainModel, Instructions: instructions, Input: "WORD: " + term + "\n",
		SchemaName: SchemaVocabularyLadder, Schema: ladderSchema,
	})
	if err != nil {
		return nil, nil, err
	}
	var raw struct {
		IsEnglish bool         `json:"is_english"`
		MeaningUz string       `json:"meaning_uz"`
		SummaryUz string       `json:"summary_uz"`
		Rungs     []LadderRung `json:"rungs"`
	}
	if err := json.Unmarshal(res.Output, &raw); err != nil {
		return nil, nil, fmt.Errorf("ladder is not valid JSON: %w", err)
	}
	meta := &EvaluationMeta{
		Versions:    Versions{ModelVersion: res.Model, PromptVersion: VocabularyLadderPrompt},
		AIRequestID: res.AIRequestID,
	}
	if !raw.IsEnglish {
		return &Ladder{Term: term, Invalid: true, Rungs: []LadderRung{}}, meta, nil
	}
	ladder := CleanLadder(term, raw.MeaningUz, raw.SummaryUz, raw.Rungs)
	filled := 0
	for _, r := range ladder.Rungs {
		if r.Term != "" {
			filled++
		}
	}
	if filled < 2 {
		return nil, nil, fmt.Errorf("no usable ladder came back")
	}
	return ladder, meta, nil
}

// CleanLadder puts the rungs in level order, one per level, and empties any rung that repeats
// a word already used lower down — the ladder exists to show different words.
func CleanLadder(term, meaningUz, summaryUz string, rungs []LadderRung) *Ladder {
	byLevel := map[string]LadderRung{}
	for _, r := range rungs {
		if _, ok := byLevel[r.Level]; !ok {
			byLevel[r.Level] = r
		}
	}
	out := &Ladder{Term: term, MeaningUz: strings.TrimSpace(meaningUz), SummaryUz: strings.TrimSpace(summaryUz), Rungs: []LadderRung{}}
	used := map[string]bool{}
	for _, code := range cefrCodes {
		r := byLevel[code]
		r.Level = code
		r.Term = strings.TrimSpace(r.Term)
		key := strings.ToLower(r.Term)
		if r.Term == "" || used[key] {
			r = LadderRung{Level: code}
		} else {
			used[key] = true
			r.NuanceUz = strings.TrimSpace(r.NuanceUz)
			r.Example = strings.TrimSpace(r.Example)
		}
		out.Rungs = append(out.Rungs, r)
	}
	return out
}

// Definitions in the learner's languages.
//
// An entry's definition is written in English. The library shows it in Uzbek and Russian too,
// hidden until the learner looks — so they can check what they think it means. Entries written
// before that are translated in small batches as the library meets them.

const (
	DefinitionTranslatePrompt      = "vocabulary_definition_translate.v1"
	TaskDefinitionTranslate   Task = "vocabulary_definition_translate"
)

// DefinitionItem is an entry whose definition is to be translated.
type DefinitionItem struct {
	ID         string
	Term       string
	Definition string
}

// TranslateDefinitions puts each definition into Uzbek and Russian: id → {"uz", "ru"}.
func (s *GrammarTutorService) TranslateDefinitions(ctx context.Context, items []DefinitionItem) (map[string]map[string]string, error) {
	out := map[string]map[string]string{}
	if len(items) == 0 {
		return out, nil
	}
	schema, _ := json.Marshal(map[string]any{
		"type": "object", "additionalProperties": false, "required": []string{"items"},
		"properties": map[string]any{"items": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object", "additionalProperties": false, "required": []string{"id", "uz", "ru"},
				"properties": map[string]any{
					"id": map[string]any{"type": "string"},
					"uz": map[string]any{"type": "string", "description": "The definition in plain Uzbek (Latin script)."},
					"ru": map[string]any{"type": "string", "description": "The definition in plain Russian."},
				},
			},
		}},
	})
	var in strings.Builder
	for _, it := range items {
		fmt.Fprintf(&in, "%s | %s | %s\n", it.ID, it.Term, it.Definition)
	}
	res, err := s.gateway.AnalyzeText(ctx, CallMeta{
		Task:          TaskDefinitionTranslate,
		PromptVersion: DefinitionTranslatePrompt,
		Metadata:      map[string]any{"kind": "vocabulary_definition_translate", "count": len(items)},
	}, AnalysisRequest{
		Model: s.fastModel,
		Instructions: "Translate each English learner's-dictionary definition into plain Uzbek (Latin script) and plain Russian, " +
			"keeping it as short and simple as the English. Each line is: id | entry | definition. Answer for every id.",
		Input: in.String(), SchemaName: "vocabulary_definitions", Schema: schema,
	})
	if err != nil {
		return nil, err
	}
	var raw struct {
		Items []struct {
			ID string `json:"id"`
			Uz string `json:"uz"`
			Ru string `json:"ru"`
		} `json:"items"`
	}
	if err := json.Unmarshal(res.Output, &raw); err != nil {
		return nil, fmt.Errorf("definition translations are not valid JSON: %w", err)
	}
	for _, it := range raw.Items {
		uz, ru := strings.TrimSpace(it.Uz), strings.TrimSpace(it.Ru)
		if uz != "" && ru != "" {
			out[strings.TrimSpace(it.ID)] = map[string]string{"uz": uz, "ru": ru}
		}
	}
	return out, nil
}

// Irregular verb examples: one sentence for each form, so a learner sees went and gone used,
// not only listed. Written once per verb.

const (
	VerbExamplesPrompt      = "irregular_verb_examples.v1"
	TaskVerbExamples   Task = "irregular_verb_examples"
)

// VerbForms is an irregular verb's three forms, as the table lists them.
type VerbForms struct {
	Base, Past, Participle string
}

// WriteVerbExamples writes a short, natural sentence for each form of each verb:
// base → {"base", "past", "participle"}.
func (s *GrammarTutorService) WriteVerbExamples(ctx context.Context, verbs []VerbForms) (map[string]map[string]string, error) {
	out := map[string]map[string]string{}
	if len(verbs) == 0 {
		return out, nil
	}
	schema, _ := json.Marshal(map[string]any{
		"type": "object", "additionalProperties": false, "required": []string{"verbs"},
		"properties": map[string]any{"verbs": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type": "object", "additionalProperties": false, "required": []string{"base", "base_example", "past_example", "participle_example"},
				"properties": map[string]any{
					"base":               map[string]any{"type": "string"},
					"base_example":       map[string]any{"type": "string", "description": "A sentence using the base form."},
					"past_example":       map[string]any{"type": "string", "description": "A sentence in the past simple using the past form."},
					"participle_example": map[string]any{"type": "string", "description": "A sentence in the present perfect (or passive) using the past participle."},
				},
			},
		}},
	})
	var in strings.Builder
	for _, v := range verbs {
		fmt.Fprintf(&in, "%s | %s | %s\n", v.Base, v.Past, v.Participle)
	}
	res, err := s.gateway.AnalyzeText(ctx, CallMeta{
		Task:          TaskVerbExamples,
		PromptVersion: VerbExamplesPrompt,
		Metadata:      map[string]any{"kind": "irregular_verb_examples", "count": len(verbs)},
	}, AnalysisRequest{
		Model: s.fastModel,
		Instructions: "For each English irregular verb (base | past | past participle), write three short, natural, everyday sentences " +
			"a B1 learner understands: one with the base form, one in the past simple with the past form, one in the present perfect " +
			"(or the passive) with the past participle. Use the first spelling where two are given. Answer for every verb.",
		Input: in.String(), SchemaName: "irregular_verb_examples", Schema: schema,
	})
	if err != nil {
		return nil, err
	}
	var raw struct {
		Verbs []struct {
			Base       string `json:"base"`
			Base1      string `json:"base_example"`
			Past       string `json:"past_example"`
			Participle string `json:"participle_example"`
		} `json:"verbs"`
	}
	if err := json.Unmarshal(res.Output, &raw); err != nil {
		return nil, fmt.Errorf("verb examples are not valid JSON: %w", err)
	}
	for _, v := range raw.Verbs {
		b, p, pp := strings.TrimSpace(v.Base1), strings.TrimSpace(v.Past), strings.TrimSpace(v.Participle)
		if b != "" && p != "" && pp != "" {
			out[strings.ToLower(strings.TrimSpace(v.Base))] = map[string]string{"base": b, "past": p, "participle": pp}
		}
	}
	return out, nil
}
