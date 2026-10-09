package practice

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

// What the coach says after an answer, and how it decides.
//
// One cheap call does both halves of the coach's turn: a spoken reaction to the answer —
// the one correction worth making, or specific praise — in the learner's feedback language,
// and the next question, always in English. It runs alongside the full judging (scores and
// the mistake list for the panel), so the learner waits for the slower of the two.

type coachReply struct {
	Say string // feedback language; may be empty
	Ask string // English, never empty
}

func liveMode(m string) string {
	switch m {
	case "part1", "part2", "part3":
		return m
	default:
		return "free"
	}
}

func feedbackLang(l string) string {
	if l == "uz" {
		return "uz"
	}
	return "en"
}

// cleanTopic keeps a client-supplied topic title to one short line: it goes into a prompt.
func cleanTopic(t string) string {
	t = strings.Join(strings.Fields(t), " ")
	if utf8.RuneCountInString(t) > 120 {
		t = string([]rune(t)[:120])
	}
	return t
}

// openingLine is the coach's first question. A published task speaks for itself; a topic
// title becomes an invitation to talk about it; with neither the coach just starts a chat.
func openingLine(mode, topic, taskPrompt string, hasTask bool) string {
	switch {
	case mode == "part2" && hasTask:
		return "Here is your cue card. " + taskPrompt + " Take a moment to think, then talk for up to two minutes."
	case mode == "part2" && topic != "":
		return "Here is your cue card: " + topic + ". Take a moment to think, then talk for up to two minutes."
	case hasTask:
		return taskPrompt
	case topic != "" && mode == "part1":
		return "Let's start with some questions about you. Our topic is " + topic + ". What can you tell me about it from your own life?"
	case topic != "" && mode == "part3":
		return "Let's discuss " + topic + ". In general, why do you think it matters to people?"
	case topic != "":
		return "Today let's talk about " + topic + ". To warm up — what's the first thing that comes to mind?"
	default:
		return "Hi! Let's just chat. How has your week been so far?"
	}
}

var modeBrief = map[string]string{
	"free":  "a relaxed conversation",
	"part1": "IELTS Speaking Part 1 — short questions about the learner's own life",
	"part2": "IELTS Speaking Part 2 — a long turn on a cue card, then a short follow-up",
	"part3": "IELTS Speaking Part 3 — abstract discussion asking for opinions and reasons",
}

// coachTurn asks the model for the coach's turn. Without a model, or when its answer cannot
// be read, the conversation still moves on: no spoken feedback, and an open question from a
// fixed set.
func (m *Module) coachTurn(ctx context.Context, userID uuid.UUID, level cefr.Level,
	mode, topic, lang, question, answer string) coachReply {
	fallback := coachReply{Ask: fallbackFollowUps[len(answer)%len(fallbackFollowUps)]}
	if m.conversation == nil {
		return fallback
	}

	language := "English"
	if lang == "uz" {
		language = "Uzbek (Latin script, natural and simple)"
	}
	about := ""
	if topic != "" {
		about = " The topic is: " + topic + "."
	}
	instructions := "You are a warm, encouraging English speaking coach in a live spoken conversation with a CEFR " +
		level.String() + " learner. The practice is " + modeBrief[mode] + "." + about + "\n" +
		"The learner has just answered your question out loud. Return two fields:\n" +
		"- say: what you say about the answer, in " + language + ": one or two short spoken sentences, at most 35 words. " +
		"If there is a clear grammar or word-choice mistake, quote the wrong English words and give the correct English " +
		"form, briefly saying why; otherwise praise one specific thing they did well. Keep English examples in English. " +
		"Do not ask a question here.\n" +
		"- ask: your next question, in simple English at or just below their level, about what they said and on the " +
		"topic. One open question, never a yes/no question."

	res, err := m.conversation.AnalyzeText(ctx,
		ai.CallMeta{Task: ai.TaskRealtimeConversation, UserID: &userID, PromptVersion: "live_speaking.v2"},
		ai.AnalysisRequest{
			Instructions: instructions,
			Input:        "You asked: " + question + "\nThey answered: " + answer,
			SchemaName:   "live_coach_turn",
			Schema:       coachTurnSchema,
		})
	if err != nil || res == nil {
		return fallback
	}
	var out struct {
		Say string `json:"say"`
		Ask string `json:"ask"`
	}
	if json.Unmarshal(res.Output, &out) != nil {
		return fallback
	}
	reply := coachReply{Say: clip(tidy(out.Say), 300), Ask: clip(tidy(out.Ask), 240)}
	if reply.Ask == "" {
		reply.Ask = fallback.Ask
	}
	return reply
}

// coachTurnSchema makes the model return exactly the two halves of the coach's turn. Asked
// for in prose, models merge them into one paragraph often enough to matter.
var coachTurnSchema = json.RawMessage(`{
	"type": "object",
	"properties": {
		"say": {"type": "string"},
		"ask": {"type": "string"}
	},
	"required": ["say", "ask"],
	"additionalProperties": false
}`)

func tidy(s string) string {
	return strings.TrimSpace(strings.Join(strings.Fields(s), " "))
}

func clip(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
