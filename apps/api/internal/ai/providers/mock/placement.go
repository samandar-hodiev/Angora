package mock

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
)

// placementAssessment returns a deterministic placement evaluation computed from simple,
// measurable text features (length, lexical diversity, sentence length, linking words). It
// lets the full assessment pipeline run locally without an AI provider. It is NOT a real
// language assessment: configure a real provider (AI_PROVIDER=openai) for genuine results.
func placementAssessment(req ai.AnalysisRequest) (json.RawMessage, bool) {
	var marker string
	switch req.SchemaName {
	case ai.SchemaPlacementWriting:
		marker = "LEARNER RESPONSE:"
	case ai.SchemaPlacementSpeaking:
		marker = "TRANSCRIPT:"
	default:
		return nil, false
	}
	text := after(req.Input, marker)
	f := features(text)

	vocabulary := clamp(15+f.diversity*40+f.longRatio*120, 5, 92)
	grammar := clamp(30+math.Min(f.avgSentence, 18)*2.2, 5, 88)
	coherence := clamp(20+math.Min(float64(f.sentences), 8)*5+math.Min(float64(f.connectors), 6)*4, 5, 90)
	if f.words == 0 {
		vocabulary, grammar, coherence = 0, 0, 0
	}

	var result map[string]any
	var mean float64
	if req.SchemaName == ai.SchemaPlacementWriting {
		minWords := number(req.Input, "MIN_WORDS:", 80)
		task := clamp(float64(f.words)/math.Max(minWords, 1)*72, 0, 90)
		mean = (task + grammar + vocabulary + coherence) / 4
		result = map[string]any{"task_response": round(task), "grammar": round(grammar), "vocabulary": round(vocabulary), "coherence": round(coherence)}
	} else {
		fluency := clamp(number(req.Input, "WORDS_PER_MINUTE:", 0)/140*75, 0, 90)
		relevance := clamp(float64(f.words)/1.2, 0, 85)
		mean = (fluency + grammar + vocabulary + relevance) / 4
		result = map[string]any{"fluency": round(fluency), "grammar": round(grammar), "vocabulary": round(vocabulary), "relevance": round(relevance)}
	}

	estimate := "A1"
	for _, band := range []struct {
		min  float64
		code string
	}{{75, "C1"}, {62, "B2"}, {50, "B1"}, {38, "A2"}, {28, "A1+"}} {
		if mean >= band.min {
			estimate = band.code
			break
		}
	}
	result["cefr_estimate"] = estimate
	result["confidence"] = 0.5
	result["mistakes"] = []any{}

	out, err := json.Marshal(result)
	if err != nil {
		return nil, false
	}
	return out, true
}

type textFeatures struct {
	words, sentences, connectors int
	diversity, longRatio         float64
	avgSentence                  float64
}

var linkingWords = map[string]bool{
	"because": true, "however": true, "although": true, "so": true, "but": true, "then": true, "finally": true,
	"first": true, "also": true, "while": true, "therefore": true, "moreover": true, "after": true, "when": true,
}

func features(text string) textFeatures {
	fields := strings.Fields(text)
	var f textFeatures
	unique := map[string]bool{}
	long := 0
	for _, w := range fields {
		lw := strings.ToLower(strings.Trim(w, `.,!?;:"'()`))
		if lw == "" {
			continue
		}
		f.words++
		unique[lw] = true
		if len([]rune(lw)) >= 7 {
			long++
		}
		if linkingWords[lw] {
			f.connectors++
		}
	}
	f.sentences = strings.Count(text, ".") + strings.Count(text, "!") + strings.Count(text, "?")
	if f.sentences == 0 && f.words > 0 {
		f.sentences = 1
	}
	if f.words > 0 {
		f.diversity = float64(len(unique)) / float64(f.words)
		f.longRatio = float64(long) / float64(f.words)
		f.avgSentence = float64(f.words) / float64(f.sentences)
	}
	return f
}

func after(s, marker string) string {
	if i := strings.Index(s, marker); i >= 0 {
		return strings.TrimSpace(s[i+len(marker):])
	}
	return ""
}

func number(s, label string, fallback float64) float64 {
	i := strings.Index(s, label)
	if i < 0 {
		return fallback
	}
	line := strings.TrimSpace(s[i+len(label):])
	if j := strings.IndexByte(line, '\n'); j >= 0 {
		line = line[:j]
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(line), 64)
	if err != nil {
		return fallback
	}
	return v
}

func clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

func round(v float64) float64 { return math.Round(v) }
