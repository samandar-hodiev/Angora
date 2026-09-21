// Package ielts serves IELTS mock exams: a timed composition of reading, listening, writing
// and speaking sections drawn from published content, scored section by section and reported
// as band estimates.
//
// The bands here are estimates produced by this platform, never official results. The public
// band tables are an approximation of the real conversion, which varies by paper; the product
// says so wherever a band is shown.
package ielts

import "math"

// Skill is one section of the exam.
type Skill string

const (
	SkillListening Skill = "listening"
	SkillReading   Skill = "reading"
	SkillWriting   Skill = "writing"
	SkillSpeaking  Skill = "speaking"
)

// Skills is the exam's fixed order: the two receptive papers first, then the productive ones.
func Skills() []Skill { return []Skill{SkillListening, SkillReading, SkillWriting, SkillSpeaking} }

// bandStep is one row of a raw-score conversion: at least `correct` right answers out of a
// 40-question paper earns `band`.
type bandStep struct {
	correct int
	band    float64
}

// Academic conversions, widely published and close enough for a practice estimate. Reading is
// marked harder than listening at the same raw score, as it is in the real paper.
var listeningBands = []bandStep{
	{39, 9}, {37, 8.5}, {35, 8}, {32, 7.5}, {30, 7}, {26, 6.5}, {23, 6},
	{18, 5.5}, {16, 5}, {13, 4.5}, {10, 4}, {8, 3.5}, {6, 3}, {4, 2.5}, {0, 0},
}

var readingBands = []bandStep{
	{39, 9}, {37, 8.5}, {35, 8}, {33, 7.5}, {30, 7}, {27, 6.5}, {23, 6},
	{19, 5.5}, {15, 5}, {13, 4.5}, {10, 4}, {8, 3.5}, {6, 3}, {4, 2.5}, {0, 0},
}

// BandForRaw converts a raw score to a band.
//
// Papers are not always 40 questions — a practice exam may be shorter — so the score is
// scaled to 40 first. That keeps a 12-question mock comparable with a full paper instead of
// reporting band 0 for a good performance.
func BandForRaw(skill Skill, correct, total int) float64 {
	if total <= 0 {
		return 0
	}
	if correct < 0 {
		correct = 0
	}
	if correct > total {
		correct = total
	}
	scaled := int(math.Round(float64(correct) / float64(total) * 40))

	table := listeningBands
	if skill == SkillReading {
		table = readingBands
	}
	for _, step := range table {
		if scaled >= step.correct {
			return step.band
		}
	}
	return 0
}

// BandForRubric converts an AI rubric score (0–100) to a band.
//
// The evaluators score writing and speaking out of 100 against their own rubric; IELTS reports
// half-bands out of 9. This is a linear mapping rounded to the nearest half band — deliberately
// simple, because pretending to more precision than the rubric has would be false.
func BandForRubric(score float64) float64 {
	if score <= 0 {
		return 0
	}
	if score > 100 {
		score = 100
	}
	return roundHalf(score / 100 * 9)
}

// Overall is the mean of the four section bands, rounded the way IELTS rounds: .25 goes up to
// the half band, .75 up to the whole band, and anything below .25 down.
//
// Sections that were not sat are not counted, so a partially completed exam still reports the
// average of what was done rather than being dragged towards zero.
func Overall(bands map[Skill]float64) float64 {
	sum, count := 0.0, 0
	for _, skill := range Skills() {
		if band, ok := bands[skill]; ok {
			sum += band
			count++
		}
	}
	if count == 0 {
		return 0
	}
	return roundHalf(sum / float64(count))
}

// roundHalf rounds to the nearest 0.5, which is the only granularity a band has.
func roundHalf(value float64) float64 {
	return math.Round(value*2) / 2
}
