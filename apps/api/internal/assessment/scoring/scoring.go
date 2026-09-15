// Package scoring is Engora's placement scoring engine.
//
// It is deterministic and pure: given what a learner answered (objective items) or how their
// productive tasks were evaluated (structured AI criteria plus measured evidence such as word
// counts), it produces per-skill scores, CEFR estimates and an overall estimated level. It
// never trusts client-provided scores and holds no I/O, so it is unit-tested exhaustively and
// can be replaced by a more sophisticated model (IRT, adaptive) behind the same outputs.
//
// Results are *estimates*. Nothing here represents an official CEFR certification or an
// IELTS score.
package scoring

import (
	"math"
	"sort"

	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

// Version is stored with every result so estimates can be compared across engine changes.
const Version = "placement-scoring.v1"

const (
	SkillReading   = "reading"
	SkillListening = "listening"
	SkillWriting   = "writing"
	SkillSpeaking  = "speaking"
)

// Bands relative to the learner's starting level.
const (
	BandFoundation = "foundation"
	BandCore       = "core"
	BandChallenge  = "challenge"
)

// SkillResult is the estimate for one skill.
type SkillResult struct {
	Skill      string             `json:"skill"`
	Score      float64            `json:"score"` // 0..100
	Level      cefr.Level         `json:"cefr"`
	Confidence float64            `json:"confidence"` // 0..1
	Subscores  map[string]float64 `json:"subscores"`
	Evidence   map[string]any     `json:"evidence"`
}

// ---- Objective sections (reading, listening) ----------------------------------------------

type ObjectiveResponse struct {
	ItemType   string // multiple_choice | true_false_not_given | vocabulary_in_context
	Level      cefr.Level
	Difficulty int // 1..10
	Correct    bool
	Answered   bool
}

const (
	passAccuracy = 0.6
	// partialAccuracy is reachable with one right answer out of three.
	partialAccuracy = 0.3
)

// ScoreObjective estimates a receptive skill from item responses.
//
// Score weights each item by difficulty, so answering harder items correctly counts more.
// The level is the highest tested level passed (≥60%) without failing an easier one; a
// partial pass (≥30%) of the next level adds "+". Failing even the easiest tested level
// estimates below it. Confidence grows with the number of items and drops when the
// pattern is inconsistent or the estimate sits at the edge of the tested range.
func ScoreObjective(skill string, responses []ObjectiveResponse) SkillResult {
	res := SkillResult{Skill: skill, Subscores: map[string]float64{}, Evidence: map[string]any{}}
	if len(responses) == 0 {
		res.Level = cefr.Level{Base: cefr.MinBase}
		res.Confidence = 0.1
		res.Evidence["total"] = 0
		return res
	}

	type tally struct{ correct, total int }
	byLevel := map[int]*tally{}
	byGroup := map[string]*tally{}
	var weighted, weights float64
	correct := 0
	for _, r := range responses {
		w := 0.5 + float64(clampInt(r.Difficulty, 1, 10))/10
		weights += w
		ok := r.Answered && r.Correct
		if ok {
			weighted += w
			correct++
		}
		if byLevel[r.Level.Base] == nil {
			byLevel[r.Level.Base] = &tally{}
		}
		byLevel[r.Level.Base].total++
		group := "comprehension"
		if r.ItemType == "vocabulary_in_context" {
			group = "vocabulary"
		}
		if byGroup[group] == nil {
			byGroup[group] = &tally{}
		}
		byGroup[group].total++
		if ok {
			byLevel[r.Level.Base].correct++
			byGroup[group].correct++
		}
	}
	res.Score = round1(weighted / weights * 100)

	levels := make([]int, 0, len(byLevel))
	accuracy := map[string]float64{}
	for base, t := range byLevel {
		levels = append(levels, base)
		accuracy[cefr.Level{Base: base}.String()] = round2(float64(t.correct) / float64(t.total))
	}
	sort.Ints(levels)
	acc := func(base int) float64 { t := byLevel[base]; return float64(t.correct) / float64(t.total) }

	passedIdx := -1
	for i, base := range levels {
		if acc(base) < passAccuracy {
			break
		}
		passedIdx = i
	}

	edge := false
	switch {
	case passedIdx == -1:
		lowest := levels[0]
		edge = lowest > cefr.MinBase
		if acc(lowest) >= partialAccuracy && lowest > cefr.MinBase {
			res.Level = cefr.Level{Base: lowest - 1, Plus: true}
		} else {
			res.Level = cefr.Level{Base: lowest}.Shift(-1)
		}
	default:
		base := levels[passedIdx]
		res.Level = cefr.Level{Base: base}
		if passedIdx+1 < len(levels) {
			res.Level.Plus = acc(levels[passedIdx+1]) >= partialAccuracy
		} else {
			// Passed the hardest level tested: the true level may be higher.
			edge = base < cefr.MaxBase
			res.Level.Plus = acc(base) >= 0.9 && base < cefr.MaxBase
		}
	}

	confidence := math.Min(0.9, 0.4+0.05*float64(len(responses)))
	for i := 1; i < len(levels); i++ {
		if acc(levels[i])-acc(levels[i-1]) > 0.25 {
			confidence -= 0.15 // harder items went better than easier ones
			break
		}
	}
	if edge {
		confidence -= 0.1
	}
	res.Confidence = round2(clamp(confidence, 0.2, 0.95))

	for group, t := range byGroup {
		res.Subscores[group] = round1(float64(t.correct) / float64(t.total) * 100)
	}
	res.Evidence["correct"] = correct
	res.Evidence["total"] = len(responses)
	res.Evidence["accuracy_by_level"] = accuracy
	return res
}

// ---- Productive sections (writing, speaking) ----------------------------------------------

// ProductiveTask is one evaluated writing or speaking task.
type ProductiveTask struct {
	Band  string
	Level cefr.Level // the level the task targets
	// Criteria are AI-evaluated 0..100 scores; nil means the criterion was not available
	// (e.g. pronunciation when no pronunciation analyzer is configured).
	Criteria map[string]*float64
	// AIEstimate is the evaluator's own CEFR estimate, blended in proportionally to its confidence.
	AIEstimate   *cefr.Level
	AIConfidence float64
	// Measured evidence. Writing: Words vs MinWords. Speaking: SpeechSeconds vs ExpectedSeconds and Words.
	Words           int
	MinWords        int
	SpeechSeconds   float64
	ExpectedSeconds float64
	// Missing is true when the learner submitted nothing for this task.
	Missing bool
}

var (
	WritingCriteria  = map[string]float64{"task_response": 0.25, "grammar": 0.25, "vocabulary": 0.25, "coherence": 0.25}
	SpeakingCriteria = map[string]float64{"fluency": 0.25, "grammar": 0.20, "vocabulary": 0.20, "pronunciation": 0.15, "relevance": 0.20}
)

func ScoreWriting(tasks []ProductiveTask) SkillResult {
	return scoreProductive(SkillWriting, WritingCriteria, tasks)
}

func ScoreSpeaking(tasks []ProductiveTask) SkillResult {
	return scoreProductive(SkillSpeaking, SpeakingCriteria, tasks)
}

func scoreProductive(skill string, weights map[string]float64, tasks []ProductiveTask) SkillResult {
	res := SkillResult{Skill: skill, Subscores: map[string]float64{}, Evidence: map[string]any{}}
	if len(tasks) == 0 {
		res.Level = cefr.Level{Base: cefr.MinBase}
		res.Confidence = 0.1
		return res
	}

	var scoreSum, valueSum, confSum, weightSum float64
	criterionSum := map[string]float64{}
	criterionN := map[string]int{}
	taskEvidence := make([]map[string]any, 0, len(tasks))
	unavailable := map[string]bool{}

	for _, t := range tasks {
		bandWeight := 1.0
		if t.Band == BandChallenge {
			bandWeight = 0.8
		}
		score, conf := 0.0, 0.6
		ev := map[string]any{"band": t.Band, "target": t.Level.String()}

		if t.Missing {
			conf = 0.5 // no response is clear evidence, but only about this task
			ev["missing"] = true
		} else {
			var sum, w float64
			for name, cw := range weights {
				v := t.Criteria[name]
				if v == nil {
					unavailable[name] = true
					conf -= 0.05
					continue
				}
				c := clamp(*v, 0, 100)
				sum += c * cw
				w += cw
				criterionSum[name] += c
				criterionN[name]++
			}
			if w > 0 {
				score = sum / w
			}

			// Measured length caps: a very short answer cannot score well, whatever the AI said.
			ratio := 1.0
			switch {
			case t.MinWords > 0:
				ratio = float64(t.Words) / float64(t.MinWords)
				ev["words"], ev["min_words"] = t.Words, t.MinWords
			case t.ExpectedSeconds > 0:
				ratio = t.SpeechSeconds / t.ExpectedSeconds
				ev["speech_seconds"], ev["expected_seconds"] = round1(t.SpeechSeconds), round1(t.ExpectedSeconds)
				ev["words"] = t.Words
			}
			if ratio < 1 {
				score *= 0.4 + 0.6*clamp(ratio, 0, 1)
			}
			tooShort := (skill == SkillWriting && t.Words < 10) || (skill == SkillSpeaking && t.Words < 8)
			if tooShort {
				score = math.Min(score, 10)
			}
			if t.AIEstimate != nil {
				conf = 0.3 + 0.6*clamp(t.AIConfidence, 0, 1)
			}
		}

		ruleValue := ruleLevel(score, t.Level)
		value := ruleValue
		if t.AIEstimate != nil && !t.Missing {
			ai := clamp(t.AIEstimate.Value(), t.Level.Shift(-2).Value(), float64(t.Level.Base)+1.5)
			a := 0.5 * clamp(t.AIConfidence, 0, 1)
			value = ruleValue*(1-a) + ai*a
		}

		ev["score"] = round1(score)
		ev["estimate"] = cefr.FromValue(value).String()
		taskEvidence = append(taskEvidence, ev)

		scoreSum += score * bandWeight
		valueSum += value * bandWeight
		confSum += conf * bandWeight
		weightSum += bandWeight
	}

	res.Score = round1(scoreSum / weightSum)
	res.Level = cefr.FromValue(valueSum / weightSum)
	res.Confidence = round2(clamp(confSum/weightSum, 0.2, 0.9))
	for name, sum := range criterionSum {
		res.Subscores[name] = round1(sum / float64(criterionN[name]))
	}
	res.Evidence["tasks"] = taskEvidence
	if len(unavailable) > 0 {
		names := make([]string, 0, len(unavailable))
		for n := range unavailable {
			names = append(names, n)
		}
		sort.Strings(names)
		res.Evidence["unavailable_criteria"] = names
	}
	return res
}

// ruleLevel maps a task score to a level relative to the level the task targets.
func ruleLevel(score float64, target cefr.Level) float64 {
	t := float64(target.Base)
	var v float64
	switch {
	case score >= 85:
		v = t + 1
	case score >= 70:
		v = t + 0.5
	case score >= 55:
		v = t
	case score >= 40:
		v = t - 0.5
	case score >= 25:
		v = t - 1
	default:
		v = t - 2
	}
	return clamp(v, cefr.MinBase, cefr.MaxBase)
}

// ---- Overall ------------------------------------------------------------------------------

// Area is a strength or focus area: a whole skill or one criterion of a skill
// (code "writing.grammar"). Clients translate codes into words.
type Area struct {
	Type  string  `json:"type"` // skill | criterion
	Code  string  `json:"code"`
	Score float64 `json:"score"`
}

type Summary struct {
	Code   string            `json:"code"`
	Params map[string]string `json:"params"`
	Text   string            `json:"text"`
}

type Overall struct {
	Level      cefr.Level `json:"cefr"`
	Score      float64    `json:"score"`
	Confidence float64    `json:"confidence"`
	Strengths  []Area     `json:"strengths"`
	FocusAreas []Area     `json:"focus_areas"`
	Summary    Summary    `json:"summary"`
}

// Combine produces the overall estimate. It is not a plain average of percentages:
//   - skill levels are averaged on the CEFR scale, weighted by each estimate's confidence;
//   - the overall level cannot exceed the weakest skill by more than 1.5 steps, because a
//     single very weak skill limits real-world communication;
//   - the result is rounded down to a half step (conservative).
func Combine(skills []SkillResult) Overall {
	out := Overall{Strengths: []Area{}, FocusAreas: []Area{}}
	if len(skills) == 0 {
		out.Level = cefr.Level{Base: cefr.MinBase}
		return out
	}

	var valueSum, scoreSum, weightSum, confSum float64
	minValue, maxValue := math.Inf(1), math.Inf(-1)
	for _, s := range skills {
		w := math.Max(s.Confidence, 0.2)
		v := s.Level.Value()
		valueSum += v * w
		scoreSum += s.Score * w
		weightSum += w
		confSum += s.Confidence
		minValue = math.Min(minValue, v)
		maxValue = math.Max(maxValue, v)
	}
	value := math.Min(valueSum/weightSum, minValue+1.5)
	out.Level = cefr.FromValue(value)
	out.Score = round1(scoreSum / weightSum)
	confidence := confSum / float64(len(skills))
	if maxValue-minValue > 2 {
		confidence -= 0.1
	}
	out.Confidence = round2(clamp(confidence, 0.1, 0.95))

	out.Strengths, out.FocusAreas = areas(skills, out.Level.Value())
	out.Summary = summarize(out)
	return out
}

func areas(skills []SkillResult, overall float64) (strengths, focus []Area) {
	sorted := append([]SkillResult(nil), skills...)
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].Level.Value() != sorted[j].Level.Value() {
			return sorted[i].Level.Value() > sorted[j].Level.Value()
		}
		return sorted[i].Score > sorted[j].Score
	})

	strengths, focus = []Area{}, []Area{}
	for _, s := range sorted {
		if s.Level.Value() >= overall+0.5 {
			strengths = append(strengths, Area{Type: "skill", Code: s.Skill, Score: s.Score})
		}
	}
	for i := len(sorted) - 1; i >= 0; i-- {
		s := sorted[i]
		if s.Level.Value() <= overall-0.5 {
			focus = append(focus, Area{Type: "skill", Code: s.Skill, Score: s.Score})
		}
	}
	// With an even profile, still name the clearly best and weakest skills.
	if len(sorted) > 1 {
		best, worst := sorted[0], sorted[len(sorted)-1]
		if len(strengths) == 0 && best.Score >= 50 && best.Score-worst.Score >= 5 {
			strengths = append(strengths, Area{Type: "skill", Code: best.Skill, Score: best.Score})
		}
		if len(focus) == 0 && best.Score-worst.Score >= 5 {
			focus = append(focus, Area{Type: "skill", Code: worst.Skill, Score: worst.Score})
		}
	}

	var criteria []Area
	for _, s := range skills {
		for name, v := range s.Subscores {
			criteria = append(criteria, Area{Type: "criterion", Code: s.Skill + "." + name, Score: v})
		}
	}
	sort.SliceStable(criteria, func(i, j int) bool {
		if criteria[i].Score != criteria[j].Score {
			return criteria[i].Score > criteria[j].Score
		}
		return criteria[i].Code < criteria[j].Code
	})
	for _, c := range criteria {
		if len(strengths) >= 3 || c.Score < 70 {
			break
		}
		strengths = append(strengths, c)
	}
	for i := len(criteria) - 1; i >= 0 && len(focus) < 3; i-- {
		if criteria[i].Score >= 55 {
			break
		}
		focus = append(focus, criteria[i])
	}
	return strengths, focus
}

var skillNames = map[string]string{
	SkillReading: "reading", SkillListening: "listening", SkillWriting: "writing", SkillSpeaking: "speaking",
}

var criterionNames = map[string]string{
	"grammar": "grammar", "vocabulary": "vocabulary", "coherence": "organisation", "task_response": "answering the task fully",
	"fluency": "fluency", "pronunciation": "pronunciation", "relevance": "staying on topic", "comprehension": "understanding the main ideas",
}

// summarize builds the coach summary from structured results only (no free-form AI text).
func summarize(o Overall) Summary {
	params := map[string]string{"level": o.Level.String()}
	var opening string
	switch {
	case o.Level.Base <= 2:
		opening = "You can handle simple, familiar situations in English"
	case o.Level.Base <= 4:
		opening = "You're comfortable communicating about familiar topics"
	default:
		opening = "You can use English flexibly in most situations"
	}

	var strength, focusSkill, focusCriterion string
	for _, a := range o.Strengths {
		if a.Type == "skill" {
			strength = skillNames[a.Code]
			break
		}
	}
	for _, a := range o.FocusAreas {
		if a.Type == "skill" && focusSkill == "" {
			focusSkill = skillNames[a.Code]
		}
		if a.Type == "criterion" && focusCriterion == "" {
			skill, name := splitCode(a.Code)
			focusCriterion = criterionNames[name]
			if focusSkill == "" {
				focusSkill = skillNames[skill]
			}
		}
	}

	text := opening
	switch {
	case focusSkill != "" && focusCriterion != "":
		text += ", but " + focusCriterion + " is limiting your " + focusSkill
		params["focus_skill"], params["focus_criterion"] = focusSkill, focusCriterion
	case focusSkill != "":
		text += ", and " + focusSkill + " is the skill with the most room to grow"
		params["focus_skill"] = focusSkill
	}
	text += "."
	if strength != "" {
		text += " Your " + strength + " is a strength to build on."
		params["strength_skill"] = strength
	}
	text += " We'll use this in your personalised plan."
	return Summary{Code: "placement.summary.v1", Params: params, Text: text}
}

func splitCode(code string) (string, string) {
	for i := 0; i < len(code); i++ {
		if code[i] == '.' {
			return code[:i], code[i+1:]
		}
	}
	return code, ""
}

func clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

func clampInt(v, lo, hi int) int { return max(lo, min(hi, v)) }

func round1(v float64) float64 { return math.Round(v*10) / 10 }

func round2(v float64) float64 { return math.Round(v*100) / 100 }
