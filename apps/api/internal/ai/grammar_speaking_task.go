package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

// A speaking task built around one grammar topic.
//
// The speaking twin of the writing task: something to talk about for a minute or two where
// the topic comes up again and again — describing a room for a / an, a holiday for the past
// simple, plans for going to. Spoken, so it is a situation and a few points to cover, not a
// text to produce.

const (
	GrammarSpeakingTaskPrompt = "grammar_speaking_task.v1"
	SchemaGrammarSpeakingTask = "grammar_speaking_task"
)

// GrammarSpeakingTask is what the learner is asked to talk about.
type GrammarSpeakingTask struct {
	Title  string `json:"title"`
	Prompt string `json:"prompt"`
	// Points are the things to cover, in the order a speaker would.
	Points        []string `json:"points"`
	TargetSeconds int      `json:"target_seconds"`
	Focus         string   `json:"focus"`
}

var grammarSpeakingTaskSchema = json.RawMessage(`{
  "type": "object",
  "additionalProperties": false,
  "required": ["title", "prompt", "points", "target_seconds", "focus"],
  "properties": {
    "title": {"type": "string"},
    "prompt": {"type": "string"},
    "points": {"type": "array", "items": {"type": "string"}},
    "target_seconds": {"type": "integer"},
    "focus": {"type": "string"}
  }
}`)

// WriteGrammarSpeakingTask writes one speaking task that makes the learner use the topic.
func (s *GrammarTutorService) WriteGrammarSpeakingTask(ctx context.Context, req GrammarWritingTaskRequest) (*GrammarSpeakingTask, error) {
	var b strings.Builder
	b.WriteString("You write short speaking tasks for an English-learning app. The learner has just studied one grammar topic and now practises it by speaking for a minute or two; the recording is transcribed and assessed.\n\n")
	b.WriteString("Write ONE task whose subject naturally makes the learner use the topic many times — a situation where avoiding it would be awkward. ")
	b.WriteString("It must be something a person really talks about: describing, telling, explaining, comparing. Not a grammar drill, not 'say sentences using X'.\n\n")
	b.WriteString("- title: 3–7 words.\n")
	b.WriteString("- prompt: 1–2 sentences addressed to the learner, at their CEFR level, that set the situation.\n")
	b.WriteString("- points: exactly 3 short things to talk about, in order; at least one leads straight into the topic.\n")
	b.WriteString("- target_seconds: 45–60 for A1–A2, 60–90 for B1–B2, 90–120 for C1–C2.\n")
	b.WriteString("- focus: one sentence naming the grammar point being practised, in plain words.\n")
	b.WriteString("Write in clear English the learner can read at their level.\n")

	input := fmt.Sprintf("GRAMMAR TOPIC: %s\nWHAT IT COVERS: %s\nLEARNER LEVEL: %s",
		req.Topic, strings.TrimSpace(req.Description), req.Level.BaseCode())

	res, err := s.gateway.AnalyzeText(ctx, CallMeta{
		Task:          TaskContentGeneration,
		UserID:        &req.UserID,
		PromptVersion: GrammarSpeakingTaskPrompt,
		Metadata:      map[string]any{"topic": req.Slug, "level": req.Level.BaseCode(), "kind": "speaking_task"},
	}, AnalysisRequest{
		Model:        s.fastModel,
		Instructions: b.String(),
		Input:        input,
		SchemaName:   SchemaGrammarSpeakingTask,
		Schema:       grammarSpeakingTaskSchema,
	})
	if err != nil {
		return nil, err
	}
	var out GrammarSpeakingTask
	if err := json.Unmarshal(cleanModelJSON(res.Output), &out); err != nil {
		return nil, fmt.Errorf("grammar speaking task is not valid JSON: %w", err)
	}
	if strings.TrimSpace(out.Prompt) == "" || strings.TrimSpace(out.Title) == "" {
		return nil, fmt.Errorf("grammar speaking task came back empty")
	}
	out.TargetSeconds = min(max(out.TargetSeconds, 30), 180)
	if len(out.Points) > 4 {
		out.Points = out.Points[:4]
	}
	return &out, nil
}

// FallbackGrammarSpeakingTask is the task used when no model is available: plain, but about
// the topic.
func FallbackGrammarSpeakingTask(topic string, level cefr.Level) GrammarSpeakingTask {
	seconds := 75
	switch level.BaseCode() {
	case "A1", "A2":
		seconds = 50
	case "C1", "C2":
		seconds = 100
	}
	return GrammarSpeakingTask{
		Title:  "Talk using " + topic,
		Prompt: "Describe a place you know well — your home, your street or your school — as if to a friend who has never been there.",
		Points: []string{
			"Say where it is and what it is like.",
			"Describe what is there, one thing at a time.",
			"Use " + topic + " every time it fits.",
		},
		TargetSeconds: seconds,
		Focus:         "This task practises " + topic + ".",
	}
}
