package admin

import (
	"encoding/json"
	"testing"

	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
)

// The question bank decides how learners are marked, so the rules that keep an item
// answerable are tested directly rather than through the HTTP layer.

func raw(s string) json.RawMessage { return json.RawMessage(s) }

func TestValidateQuestionObjective(t *testing.T) {
	opts := raw(`[{"id":"a","text":"went"},{"id":"b","text":"go"}]`)

	t.Run("accepts a key naming a real option", func(t *testing.T) {
		if err := validateQuestion("multiple_choice", opts, raw(`{"option_id":"b"}`)); err != nil {
			t.Fatalf("want valid, got %v", err)
		}
	})

	t.Run("rejects a key naming an option that does not exist", func(t *testing.T) {
		err := validateQuestion("multiple_choice", opts, raw(`{"option_id":"z"}`))
		if !apperr.Is(err, apperr.CodeValidation) {
			t.Fatalf("want validation error, got %v", err)
		}
	})

	t.Run("rejects a missing key", func(t *testing.T) {
		if err := validateQuestion("multiple_choice", opts, nil); err == nil {
			t.Fatal("an objective question without an answer key must be rejected")
		}
		if err := validateQuestion("multiple_choice", opts, raw(`null`)); err == nil {
			t.Fatal("a null answer key must be rejected")
		}
	})

	t.Run("rejects fewer than two options", func(t *testing.T) {
		if err := validateQuestion("multiple_choice", raw(`[{"id":"a","text":"only"}]`), raw(`{"option_id":"a"}`)); err == nil {
			t.Fatal("a single-option question must be rejected")
		}
	})

	t.Run("rejects duplicate option ids", func(t *testing.T) {
		dupes := raw(`[{"id":"a","text":"one"},{"id":"a","text":"two"}]`)
		if err := validateQuestion("multiple_choice", dupes, raw(`{"option_id":"a"}`)); err == nil {
			t.Fatal("duplicate option ids must be rejected")
		}
	})

	t.Run("rejects an option missing its text", func(t *testing.T) {
		blank := raw(`[{"id":"a","text":""},{"id":"b","text":"go"}]`)
		if err := validateQuestion("multiple_choice", blank, raw(`{"option_id":"b"}`)); err == nil {
			t.Fatal("an empty option must be rejected")
		}
	})

	t.Run("rejects malformed options", func(t *testing.T) {
		if err := validateQuestion("multiple_choice", raw(`{"a":1}`), raw(`{"option_id":"a"}`)); err == nil {
			t.Fatal("options that are not a list must be rejected")
		}
	})
}

func TestValidateQuestionTasks(t *testing.T) {
	t.Run("a task needs no options or key", func(t *testing.T) {
		if err := validateQuestion("writing_task", nil, nil); err != nil {
			t.Fatalf("want valid, got %v", err)
		}
		if err := validateQuestion("speaking_task", raw(`[]`), raw(`null`)); err != nil {
			t.Fatalf("want valid, got %v", err)
		}
	})

	t.Run("a task must not carry an answer key", func(t *testing.T) {
		err := validateQuestion("writing_task", nil, raw(`{"option_id":"a"}`))
		if !apperr.Is(err, apperr.CodeValidation) {
			t.Fatalf("want validation error, got %v", err)
		}
	})
}

func TestValidateQuestionUnknownType(t *testing.T) {
	if err := validateQuestion("essay_maybe", nil, nil); err == nil {
		t.Fatal("an unknown item type must be rejected")
	}
}

func TestPublishableRequiresPrompt(t *testing.T) {
	d := QuestionDetail{
		QuestionRow: QuestionRow{ItemType: "writing_task", Prompt: "   "},
	}
	if err := publishable(d); err == nil {
		t.Fatal("publishing an item with a blank prompt must be rejected")
	}

	d.Prompt = "Describe a journey you remember."
	if err := publishable(d); err != nil {
		t.Fatalf("want publishable, got %v", err)
	}
}

func TestPublishableRejectsUnanswerableItem(t *testing.T) {
	// The case this guard exists for: an item that looks finished but would mis-mark every
	// learner who meets it, because its key points at an option that was removed.
	d := QuestionDetail{
		QuestionRow: QuestionRow{ItemType: "multiple_choice", Prompt: "Choose the past form."},
		Options:     raw(`[{"id":"a","text":"went"},{"id":"b","text":"go"}]`),
		AnswerKey:   raw(`{"option_id":"c"}`),
	}
	if err := publishable(d); err == nil {
		t.Fatal("publishing an item whose key names no option must be rejected")
	}
}

func TestValidateConfig(t *testing.T) {
	valid := raw(`{"grace_seconds":30,"sections":[
		{"skill":"reading","time_limit_seconds":720,"items":{"core":4}},
		{"skill":"writing","time_limit_seconds":1200,"items":{"core":1}}]}`)
	if err := validateConfig(valid); err != nil {
		t.Fatalf("want valid, got %v", err)
	}

	cases := map[string]json.RawMessage{
		"no sections":      raw(`{"sections":[]}`),
		"unknown skill":    raw(`{"sections":[{"skill":"singing","time_limit_seconds":60,"items":{"core":1}}]}`),
		"duplicate skill":  raw(`{"sections":[{"skill":"reading","time_limit_seconds":60,"items":{"core":1}},{"skill":"reading","time_limit_seconds":60,"items":{"core":1}}]}`),
		"no time limit":    raw(`{"sections":[{"skill":"reading","time_limit_seconds":0,"items":{"core":1}}]}`),
		"no items":         raw(`{"sections":[{"skill":"reading","time_limit_seconds":60,"items":{"core":0}}]}`),
		"negative items":   raw(`{"sections":[{"skill":"reading","time_limit_seconds":60,"items":{"core":-2}}]}`),
		"not an object":    raw(`"placement"`),
		"missing sections": raw(`{"grace_seconds":30}`),
	}
	for name, cfg := range cases {
		t.Run(name, func(t *testing.T) {
			if err := validateConfig(cfg); err == nil {
				t.Fatalf("%s must be rejected", name)
			}
		})
	}
}
