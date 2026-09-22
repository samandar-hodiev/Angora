package ai

import "encoding/json"

// The JSON Schema the model must answer with.
//
// Written out rather than generated from the Go structs because OpenAI's strict mode has
// rules a reflected schema quietly breaks: every object needs additionalProperties:false,
// and every property has to appear in `required` — optional fields do not exist. A schema
// the API rejects is not a worse generation, it is no generation at all, so the shape is
// asserted by a test rather than discovered in production.
var grammarContentSchema = json.RawMessage(`{
  "type": "object",
  "additionalProperties": false,
  "required": ["levels"],
  "properties": {
    "levels": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "level",
          "applicable",
          "reason",
          "title",
          "summary",
          "intro",
          "explanation",
          "usage",
          "formulas",
          "signal_words",
          "examples",
          "common_mistakes",
          "practice"
        ],
        "properties": {
          "level": {
            "type": "string",
            "enum": ["A1", "A2", "B1", "B2", "C1", "C2"],
            "description": "The CEFR level this version is written for."
          },
          "applicable": {
            "type": "boolean",
            "description": "False when the topic cannot be taught honestly at this level."
          },
          "reason": {
            "type": "string",
            "description": "One sentence. Why the topic does not belong at this level; empty when it does."
          },
          "title": {
            "type": "string",
            "description": "What a learner at this level sees at the top of the page."
          },
          "summary": {
            "type": "string",
            "description": "One sentence a learner could repeat back."
          },
          "intro": {
            "type": "string",
            "description": "What this grammar point is, in two or three sentences."
          },
          "explanation": {
            "type": "string",
            "description": "When and why it is used, at this level's depth."
          },
          "usage": {
            "type": "array",
            "items": { "type": "string" },
            "description": "The situations it is used in, one per entry."
          },
          "formulas": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["label", "pattern", "examples"],
              "properties": {
                "label": { "type": "string", "description": "Affirmative, Negative, Question, and so on." },
                "pattern": { "type": "string", "description": "The form, e.g. subject + have/has + past participle." },
                "examples": { "type": "array", "items": { "type": "string" } }
              }
            }
          },
          "signal_words": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Words that hint this form is wanted: already, yet, since."
          },
          "examples": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["text", "note"],
              "properties": {
                "text": { "type": "string", "description": "A sentence somebody would actually say." },
                "note": { "type": "string", "description": "What it shows. Empty when the sentence speaks for itself." }
              }
            }
          },
          "common_mistakes": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["wrong", "right", "why", "rule"],
              "properties": {
                "wrong": { "type": "string", "description": "The form learners actually produce." },
                "right": { "type": "string", "description": "The same sentence, corrected." },
                "why": { "type": "string", "description": "What the rule is, in one sentence." },
                "rule": { "type": "string", "description": "A short slug tying this to practice, e.g. past_participle." }
              }
            }
          },
          "practice": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["prompt", "options", "answer_index", "explanation", "target_rule"],
              "properties": {
                "prompt": { "type": "string" },
                "options": { "type": "array", "items": { "type": "string" } },
                "answer_index": {
                  "type": "integer",
                  "description": "Position of the correct option, counting from zero."
                },
                "explanation": { "type": "string", "description": "Why that option is right." },
                "target_rule": { "type": "string", "description": "The rule slug this question tests." }
              }
            }
          }
        }
      }
    }
  }
}`)
