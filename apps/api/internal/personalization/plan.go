// Package personalization turns what Engora knows about a learner — level, goals, daily
// time, assessment strengths and focus areas, recurring mistakes — into a structured
// learning plan (learning_plans + learning_plan_items).
//
// Generation is rule-based and deterministic today (Version). Plan items are product data
// (skill, focus code, activity, minutes); clients decide how to display them. An AI or
// teacher-authored plan can later be written through the same tables with generated_by.
package personalization

import (
	"strings"

	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

const Version = "plan-rules.v1"

// Goal codes accepted in onboarding and stored in profiles.learning_goals.
const (
	GoalImproveEnglish   = "improve_english"
	GoalSpeakConfidently = "speak_confidently"
	GoalIELTS            = "ielts"
	GoalWork             = "work"
	GoalUniversity       = "university"
	GoalTravel           = "travel"
)

var Goals = []string{GoalImproveEnglish, GoalSpeakConfidently, GoalIELTS, GoalWork, GoalUniversity, GoalTravel}

// Area is a skill ("writing") or a criterion ("writing.grammar") from an assessment.
type Area struct {
	Type string
	Code string
}

type Input struct {
	Level        cefr.Level
	DailyMinutes int
	Goals        []string
	FocusAreas   []Area
	// MistakeCategories are recurring mistake categories, most frequent first
	// (e.g. grammar.tense.past_simple).
	MistakeCategories []string
}

type Item struct {
	Position     int        `json:"position"`
	Skill        string     `json:"skill"`
	Focus        string     `json:"focus"`
	ActivityCode string     `json:"activity_code"`
	Title        string     `json:"title"`
	Description  string     `json:"description"`
	Minutes      int        `json:"minutes"`
	Level        cefr.Level `json:"level"`
	ReasonCode   string     `json:"reason_code"` // weakness | goal | balance
}

type Plan struct {
	Goal         string
	Level        cefr.Level
	TargetLevel  cefr.Level
	DailyMinutes int
	Items        []Item
}

type candidate struct {
	skill, focus, reason string
}

var goalSkills = map[string][]string{
	GoalSpeakConfidently: {"speaking", "listening"},
	GoalIELTS:            {"writing", "speaking", "reading", "listening"},
	GoalWork:             {"speaking", "writing"},
	GoalUniversity:       {"reading", "writing"},
	GoalTravel:           {"speaking", "listening"},
	GoalImproveEnglish:   {"speaking", "listening", "reading", "writing"},
}

var balance = []string{"speaking", "listening", "reading", "writing", "vocabulary"}

// Generate builds today's plan. Weak areas come first, then the learner's goals, then
// balance across skills, so every plan trains real weaknesses without neglecting others.
func Generate(in Input) Plan {
	level := in.Level
	if !level.Valid() {
		level = cefr.Level{Base: 2}
	}
	minutes := in.DailyMinutes
	if minutes < 5 {
		minutes = 15
	}
	goal := GoalImproveEnglish
	if len(in.Goals) > 0 {
		goal = in.Goals[0]
	}

	var candidates []candidate
	seen := map[string]bool{}
	add := func(skill, focus, reason string) {
		if skill == "" || seen[skill] {
			return
		}
		seen[skill] = true
		candidates = append(candidates, candidate{skill: skill, focus: focus, reason: reason})
	}

	grammarFocus := ""
	for _, m := range in.MistakeCategories {
		if strings.HasPrefix(m, "grammar.") {
			grammarFocus = m
			break
		}
	}
	for _, a := range in.FocusAreas {
		switch a.Type {
		case "skill":
			add(a.Code, "", "weakness")
		case "criterion":
			skill, criterion, _ := strings.Cut(a.Code, ".")
			if criterion == "grammar" {
				if grammarFocus == "" {
					grammarFocus = "grammar"
				}
				add("grammar", grammarFocus, "weakness")
			} else {
				add(skill, a.Code, "weakness")
			}
		}
	}
	if grammarFocus != "" {
		add("grammar", grammarFocus, "weakness")
	}
	for _, g := range in.Goals {
		for _, s := range goalSkills[g] {
			add(s, "", "goal")
		}
	}
	for _, s := range balance {
		add(s, "", "balance")
	}

	count := 4
	switch {
	case minutes <= 20:
		count = 2
	case minutes <= 30:
		count = 3
	}
	if count > len(candidates) {
		count = len(candidates)
	}
	per := minutes / count
	remainder := minutes - per*count

	plan := Plan{Goal: goal, Level: level, TargetLevel: level.Shift(1), DailyMinutes: minutes}
	for i, c := range candidates[:count] {
		m := per
		if i == 0 {
			m += remainder
		}
		act := activity(c.skill, c.focus, level, in.Goals)
		plan.Items = append(plan.Items, Item{
			Position: i + 1, Skill: c.skill, Focus: c.focus, ActivityCode: act.code,
			Title: act.title, Description: act.description, Minutes: m,
			Level: cefr.Level{Base: level.Base}, ReasonCode: c.reason,
		})
	}
	return plan
}

type act struct{ code, title, description string }

func hasGoal(goals []string, g string) bool {
	for _, x := range goals {
		if x == g {
			return true
		}
	}
	return false
}

func activity(skill, focus string, level cefr.Level, goals []string) act {
	band := "B"
	switch {
	case level.Base <= 2:
		band = "A"
	case level.Base >= 5:
		band = "C"
	}
	code := level.BaseCode()

	switch skill {
	case "speaking":
		switch {
		case hasGoal(goals, GoalIELTS) && band != "A":
			return act{"speaking.ielts_style", "IELTS-style speaking questions", "Practise answering exam-style questions with extended, organised answers."}
		case hasGoal(goals, GoalWork):
			return act{"speaking.work", "Talk about your work", "Describe your role, your tasks and your plans in connected sentences."}
		case hasGoal(goals, GoalTravel) && band == "A":
			return act{"speaking.travel", "Travel conversations", "Ask and answer simple questions you need when travelling."}
		case band == "A":
			return act{"speaking.daily_routine", "Talk about your daily routine", "Answer simple questions about yourself and your day."}
		case band == "C":
			return act{"speaking.opinions", "Discuss opinions on real issues", "Give and support your opinion in longer, well-organised answers."}
		default:
			return act{"speaking.everyday_experiences", "Talk about everyday experiences", "Describe recent experiences in a few connected sentences."}
		}
	case "writing":
		switch {
		case hasGoal(goals, GoalIELTS) && band != "A":
			return act{"writing.ielts_style", "IELTS-style writing practice", "Plan and write a structured answer to an exam-style task."}
		case band == "A":
			return act{"writing.short_messages", "Write short messages", "Write simple notes and emails about familiar topics."}
		case band == "C":
			return act{"writing.structured_essay", "Structured essay practice", "Organise an argument across several clear paragraphs."}
		default:
			return act{"writing.paragraph", "Short paragraph practice", "Write a clear paragraph with a main idea and supporting examples."}
		}
	case "reading":
		switch {
		case hasGoal(goals, GoalUniversity) && band != "A":
			return act{"reading.academic", "Academic-style reading", "Read longer texts and identify arguments and evidence."}
		case band == "A":
			return act{"reading.everyday_texts", "Short everyday texts", "Read short notices, messages and descriptions."}
		case band == "C":
			return act{"reading.long_articles", "Longer articles and opinion pieces", "Follow complex arguments and understand implied meaning."}
		default:
			return act{"reading.articles", code + " articles on familiar topics", "Read articles and check your understanding of main ideas and details."}
		}
	case "listening":
		switch band {
		case "A":
			return act{"listening.simple_conversations", "Simple everyday conversations", "Listen to short, clear conversations about daily life."}
		case "C":
			return act{"listening.talks", "Talks and discussions", "Follow longer talks and discussions at natural speed."}
		default:
			return act{"listening.everyday_conversations", code + " everyday conversations", "Listen to natural conversations and answer questions."}
		}
	case "grammar":
		if title, ok := grammarTitles[focus]; ok {
			return act{"grammar." + strings.TrimPrefix(focus, "grammar."), title, "Short, focused practice on a pattern that is holding you back."}
		}
		switch band {
		case "A":
			return act{"grammar.basic_tenses", "Present and past simple", "Practise the tenses you need most for everyday situations."}
		case "C":
			return act{"grammar.complex_sentences", "Complex sentence structures", "Use advanced structures accurately in context."}
		default:
			return act{"grammar.sentence_structure", "Grammar and sentence structure", "Build accurate sentences with the tenses and structures at your level."}
		}
	case "vocabulary":
		return act{"vocabulary.review", "Useful words for your level", "Learn and review words you will use in real conversations."}
	case "pronunciation":
		return act{"pronunciation.sounds", "Clear pronunciation", "Practise the sounds and stress patterns that affect clarity."}
	}
	return act{skill + ".practice", strings.ToUpper(skill[:1]) + skill[1:] + " practice", ""}
}

var grammarTitles = map[string]string{
	"grammar.tense.past_simple":      "Past tense practice",
	"grammar.tense.present_perfect":  "Present perfect practice",
	"grammar.tense.present_simple":   "Present simple practice",
	"grammar.tense.future":           "Talking about the future",
	"grammar.articles":               "Articles: a, an and the",
	"grammar.prepositions":           "Prepositions practice",
	"grammar.subject_verb_agreement": "Subject–verb agreement",
	"grammar.word_order":             "Word order practice",
	"grammar.conditionals":           "Conditionals practice",
	"grammar.passive":                "Passive voice practice",
}
