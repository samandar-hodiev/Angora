package admin

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Working on a draft, one part at a time.
//
// Generate writes a topic and saves it. These two do not save anything: they hand the owner
// a proposed version of one section and let them look at it next to what they had. An editor
// who asked for better examples and got worse ones should be able to close the dialog and
// still have their work, which is not true of an endpoint that writes as it goes.

const (
	ActionGrammarRefined    = "grammar_content.refined"
	ActionGrammarTranslated = "grammar_content.translated"
)

// Refiner is the half of the AI service that edits existing drafts.
type Refiner interface {
	RefineGrammarLevel(ctx context.Context, req ai.GrammarRefineRequest) (*ai.GeneratedGrammarLevel, *ai.EvaluationMeta, error)
	TranslateGrammarLevel(ctx context.Context, req ai.GrammarTranslateRequest) (*ai.GeneratedGrammarLevel, *ai.EvaluationMeta, error)
}

type refineInput struct {
	Language string `json:"language" binding:"omitempty,oneof=en uz ru"`
	Action   string `json:"action" binding:"required,oneof=improve regenerate expand adapt"`
	/** One of ai.RefineSections. Empty means the whole level. */
	Section string `json:"section" binding:"omitempty,max=32"`
	/** For adapt: the level the current draft was written for. */
	AdaptFrom string `json:"adapt_from" binding:"omitempty,max=4"`
}

type translateInput struct {
	/** The language to read from. Defaults to English, which is where lessons are written. */
	From string `json:"from" binding:"omitempty,oneof=en uz ru"`
	To   string `json:"to" binding:"required,oneof=en uz ru"`
}

// ProposedLevel is a suggestion, not a saved version. The client shows it, the owner keeps
// or discards it, and only Save writes anything.
type ProposedLevel struct {
	Level      string                 `json:"level"`
	Applicable bool                   `json:"applicable"`
	Reason     string                 `json:"reason,omitempty"`
	Title      string                 `json:"title"`
	Summary    string                 `json:"summary"`
	Body       map[string]any         `json:"body"`
	Practice   []ai.GeneratedPractice `json:"practice"`
	/** The section that was asked for, echoed back so the client merges only that one. */
	Section string `json:"section,omitempty"`
}

func (m *Module) refineGrammarLevel(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if m.refiner == nil {
		httpx.Fail(c, apperr.New(apperr.CodeUnavailable, "AI content generation is not configured"))
		return
	}
	var in refineInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	if in.Section != "" && !ai.IsRefineSection(in.Section) {
		httpx.Fail(c, apperr.Validation(map[string]any{
			"reason": "unknown_section", "fields": map[string]any{"section": "not a section of a lesson"},
		}))
		return
	}
	level, err := cefr.Parse(strings.ToUpper(c.Param("level")))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid CEFR level"))
		return
	}
	language := editorLanguage(in.Language)
	slug := c.Param("slug")
	ctx := c.Request.Context()

	current, found, err := m.levelDraft(ctx, slug, language, level)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if !found {
		httpx.Fail(c, apperr.NotFound("There is nothing written at this level yet"))
		return
	}
	topic, err := m.loadTopicContent(ctx, slug, language)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	category := ""
	if topic.Topic.CategoryName != nil {
		category = *topic.Topic.CategoryName
	}

	proposed, _, err := m.refiner.RefineGrammarLevel(ctx, ai.GrammarRefineRequest{
		Topic: topic.Topic.Name, Slug: topic.Topic.Slug, Category: category,
		Description: topic.Topic.Description, Level: level, Language: language,
		Action: ai.RefineAction(in.Action), Section: in.Section,
		Current: current, AdaptFrom: strings.ToUpper(in.AdaptFrom), ActorID: &p.UserID,
	})
	if err != nil {
		httpx.Fail(c, apperr.Wrap(err, apperr.CodeUnavailable, "AI content generation failed. Please try again."))
		return
	}

	recordGrammarAudit(ctx, m.audit, p.UserID, ActionGrammarRefined, slug, map[string]any{
		"language": language, "level": level.BaseCode(), "action": in.Action, "section": in.Section,
	})
	httpx.OK(c, proposedFrom(*proposed, in.Section))
}

func (m *Module) translateGrammarLevel(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if m.refiner == nil {
		httpx.Fail(c, apperr.New(apperr.CodeUnavailable, "AI content generation is not configured"))
		return
	}
	var in translateInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	from := editorLanguage(in.From)
	if from == in.To {
		httpx.Fail(c, apperr.Validation(map[string]any{
			"reason": "same_language", "fields": map[string]any{"to": "pick a different language to translate into"},
		}))
		return
	}
	level, err := cefr.Parse(strings.ToUpper(c.Param("level")))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid CEFR level"))
		return
	}
	slug := c.Param("slug")
	ctx := c.Request.Context()

	source, found, err := m.levelDraft(ctx, slug, from, level)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if !found {
		httpx.Fail(c, apperr.NotFound("There is nothing to translate at this level in that language"))
		return
	}
	topic, err := m.loadTopicContent(ctx, slug, from)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	proposed, _, err := m.refiner.TranslateGrammarLevel(ctx, ai.GrammarTranslateRequest{
		Topic: topic.Topic.Name, Slug: topic.Topic.Slug, Level: level,
		From: from, To: in.To, Source: source, ActorID: &p.UserID,
	})
	if err != nil {
		httpx.Fail(c, apperr.Wrap(err, apperr.CodeUnavailable, "AI translation failed. Please try again."))
		return
	}

	recordGrammarAudit(ctx, m.audit, p.UserID, ActionGrammarTranslated, slug, map[string]any{
		"from": from, "to": in.To, "level": level.BaseCode(),
	})
	httpx.OK(c, proposedFrom(*proposed, ""))
}

func proposedFrom(level ai.GeneratedGrammarLevel, section string) ProposedLevel {
	return ProposedLevel{
		Level: level.Level, Applicable: level.Applicable, Reason: level.Reason,
		Title: level.Title, Summary: level.Summary,
		Body: grammarBody(level), Practice: level.Practice, Section: section,
	}
}

// levelDraft reads the newest version of one level back into the shape the model works in.
//
// The round trip through the learner's document shape is deliberate: it is the only shape
// that exists, so a refinement is applied to exactly what an editor sees, not to a parallel
// copy that could drift from it.
func (m *Module) levelDraft(ctx context.Context, slug, language string, level cefr.Level) (ai.GeneratedGrammarLevel, bool, error) {
	var (
		out     ai.GeneratedGrammarLevel
		body    []byte
		topicID uuid.UUID
	)
	err := m.pool.QueryRow(ctx, `
		SELECT t.id, gc.title, gc.summary, gc.body
		FROM grammar_topics t
		JOIN grammar_content gc ON gc.grammar_topic_id = t.id
		WHERE t.slug = $1 AND gc.language = $2 AND gc.level_code = $3::cefr_code
		ORDER BY gc.version DESC
		LIMIT 1`, slug, language, level.BaseCode()).Scan(&topicID, &out.Title, &out.Summary, &body)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, false, nil
	}
	if err != nil {
		return out, false, err
	}

	var doc struct {
		Intro          string                `json:"intro"`
		Explanation    string                `json:"explanation"`
		Usage          []string              `json:"usage"`
		Formulas       []ai.GeneratedFormula `json:"formulas"`
		SignalWords    []string              `json:"signal_words"`
		Examples       []ai.GeneratedExample `json:"examples"`
		CommonMistakes []ai.GeneratedMistake `json:"common_mistakes"`
	}
	if len(body) > 0 {
		if err := json.Unmarshal(body, &doc); err != nil {
			return out, false, err
		}
	}
	out.Level = level.BaseCode()
	out.Applicable = true
	out.Intro, out.Explanation = doc.Intro, doc.Explanation
	out.Usage, out.Formulas, out.SignalWords = doc.Usage, doc.Formulas, doc.SignalWords
	out.Examples, out.CommonMistakes = doc.Examples, doc.CommonMistakes

	practice, err := m.levelQuestions(ctx, topicID, level)
	if err != nil {
		return out, false, err
	}
	out.Practice = practice
	return out, true, nil
}

// levelQuestions reads the practice attached to one level, newest first.
func (m *Module) levelQuestions(ctx context.Context, topicID uuid.UUID, level cefr.Level) ([]ai.GeneratedPractice, error) {
	rows, err := m.pool.Query(ctx, `
		SELECT q.prompt, q.payload, q.answer, q.explanation, q.target_rule
		FROM grammar_questions q
		JOIN levels l ON l.id = q.level_id
		WHERE q.grammar_topic_id = $1 AND l.code = $2 AND q.status <> 'archived'
		  AND q.type = 'multiple_choice'
		ORDER BY q.created_at`, topicID, level.BaseCode())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []ai.GeneratedPractice{}
	for rows.Next() {
		var (
			q               ai.GeneratedPractice
			payload, answer []byte
		)
		if err := rows.Scan(&q.Prompt, &payload, &answer, &q.Explanation, &q.TargetRule); err != nil {
			return nil, err
		}
		var options struct {
			Options []string `json:"options"`
		}
		_ = json.Unmarshal(payload, &options)
		var index struct {
			CorrectIndex *int `json:"correct_index"`
			// Rows written before the key was corrected. Read, never written.
			Legacy *int `json:"index"`
		}
		_ = json.Unmarshal(answer, &index)
		// A list is a list even when it is empty. Sending null here put a crash in the
		// editor for any question whose payload lost its options.
		q.Options = options.Options
		switch {
		case index.CorrectIndex != nil:
			q.AnswerIndex = *index.CorrectIndex
		case index.Legacy != nil:
			q.AnswerIndex = *index.Legacy
		default:
			q.AnswerIndex = -1
		}
		if q.Options == nil {
			q.Options = []string{}
		}
		out = append(out, q)
	}
	return out, rows.Err()
}
