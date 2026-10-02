package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

// A writing task built around one grammar topic.
//
// A learner who has just studied A / An and presses "Writing" should be asked to write
// something where they will need a / an again and again — not handed the library's first
// task, which may never call for it. The task is short, at the learner's level, and says
// plainly what it is practising.

const (
	GrammarWritingTaskPrompt = "grammar_writing_task.v1"
	SchemaGrammarWritingTask = "grammar_writing_task"
)

// GrammarWritingTaskRequest is the topic being practised and who is practising it.
type GrammarWritingTaskRequest struct {
	Topic       string
	Slug        string
	Description string
	Level       cefr.Level
	UserID      uuid.UUID
}

// GrammarWritingTask is what the learner is asked to write.
type GrammarWritingTask struct {
	Title        string   `json:"title"`
	Prompt       string   `json:"prompt"`
	Instructions []string `json:"instructions"`
	MinWords     int      `json:"min_words"`
	Minutes      int      `json:"recommended_minutes"`
	// Focus is the one sentence the page shows as "what this practises".
	Focus string `json:"focus"`
}

var grammarWritingTaskSchema = json.RawMessage(`{
  "type": "object",
  "additionalProperties": false,
  "required": ["title", "prompt", "instructions", "min_words", "recommended_minutes", "focus"],
  "properties": {
    "title": {"type": "string"},
    "prompt": {"type": "string"},
    "instructions": {"type": "array", "items": {"type": "string"}},
    "min_words": {"type": "integer"},
    "recommended_minutes": {"type": "integer"},
    "focus": {"type": "string"}
  }
}`)

// WriteGrammarTask writes one writing task that makes the learner use the topic.
func (s *GrammarTutorService) WriteGrammarTask(ctx context.Context, req GrammarWritingTaskRequest) (*GrammarWritingTask, error) {
	var b strings.Builder
	b.WriteString("You write short writing tasks for an English-learning app. The learner has just studied one grammar topic and now practises it in their own writing.\n\n")
	b.WriteString("Write ONE task whose subject naturally makes the learner use the topic many times — a situation where avoiding it would be awkward. ")
	b.WriteString("It must be something a real person writes: a message, a short description, a story, a review. Not a grammar exercise, not 'write sentences using X'.\n\n")
	b.WriteString("- title: 3–7 words.\n")
	b.WriteString("- prompt: 1–3 sentences addressed to the learner, at their CEFR level.\n")
	b.WriteString("- instructions: exactly 3 short bullet points; at least one says how to use the topic (e.g. 'Use a or an before each new thing you mention').\n")
	b.WriteString("- min_words: 60 for A1–A2, 90 for B1–B2, 140 for C1–C2.\n")
	b.WriteString("- recommended_minutes: 10–25.\n")
	b.WriteString("- focus: one sentence naming the grammar point being practised, in plain words.\n")
	b.WriteString("Write in clear English the learner can read at their level.\n")

	input := fmt.Sprintf("GRAMMAR TOPIC: %s\nWHAT IT COVERS: %s\nLEARNER LEVEL: %s",
		req.Topic, strings.TrimSpace(req.Description), req.Level.BaseCode())

	res, err := s.gateway.AnalyzeText(ctx, CallMeta{
		Task:          TaskContentGeneration,
		UserID:        &req.UserID,
		PromptVersion: GrammarWritingTaskPrompt,
		Metadata:      map[string]any{"topic": req.Slug, "level": req.Level.BaseCode(), "kind": "writing_task"},
	}, AnalysisRequest{
		Model:        s.fastModel,
		Instructions: b.String(),
		Input:        input,
		SchemaName:   SchemaGrammarWritingTask,
		Schema:       grammarWritingTaskSchema,
	})
	if err != nil {
		return nil, err
	}
	var out GrammarWritingTask
	if err := json.Unmarshal(res.Output, &out); err != nil {
		return nil, fmt.Errorf("grammar writing task is not valid JSON: %w", err)
	}
	if strings.TrimSpace(out.Prompt) == "" || strings.TrimSpace(out.Title) == "" {
		return nil, fmt.Errorf("grammar writing task came back empty")
	}
	out.MinWords = min(max(out.MinWords, 40), 250)
	out.Minutes = min(max(out.Minutes, 5), 40)
	if len(out.Instructions) > 4 {
		out.Instructions = out.Instructions[:4]
	}
	return &out, nil
}

// FallbackGrammarTask is the task used when no model is available: plainer than a written
// one, but still about the topic, so the learner is never sent to an unrelated task.
func FallbackGrammarTask(topic string, level cefr.Level) GrammarWritingTask {
	minWords := 90
	switch level.BaseCode() {
	case "A1", "A2":
		minWords = 60
	case "C1", "C2":
		minWords = 140
	}
	return GrammarWritingTask{
		Title:  "Use " + topic + " in your own words",
		Prompt: "Write about a place you know well — your home, your street or your school — and describe what is there.",
		Instructions: []string{
			"Use " + topic + " every time it fits.",
			"Write in full sentences, not a list.",
			"Read it back once and check each " + topic + " before you submit.",
		},
		MinWords: minWords,
		Minutes:  15,
		Focus:    "This task practises " + topic + ".",
	}
}
