package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// The Grammar Content Builder: generate, edit, validate, publish.
//
// The model writes; the owner decides. Everything generated here lands as a draft, and the
// only thing that puts text in front of a learner is an owner pressing publish on a version
// that passed validation. That ordering is the whole design — an AI that can publish is an
// AI that can teach something wrong to every learner at once.

// Author is the slice of the AI layer this file needs. Declared here rather than imported
// as a concrete type so the module can be built without one, and tested without a model.
type Author interface {
	AuthorGrammarContent(ctx context.Context, req ai.GrammarAuthorRequest) (*ai.GeneratedGrammarContent, *ai.EvaluationMeta, error)
}

type generateInput struct {
	Language string   `json:"language" binding:"omitempty,oneof=en uz ru"`
	Levels   []string `json:"levels" binding:"required,min=1,max=6,dive,max=4"`
	/** Regenerating a level that already has an owner-edited draft needs saying so twice. */
	Overwrite bool `json:"overwrite"`
}

// generateGrammarContent writes the requested levels in one call and stores them as drafts.
//
// Nothing published is touched. A level that already has a published version keeps serving
// it; the generated text becomes the next version, waiting for review.
func (m *Module) generateGrammarContent(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if m.author == nil {
		httpx.Fail(c, apperr.New(apperr.CodeUnavailable, "AI content generation is not configured"))
		return
	}
	var in generateInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	language := editorLanguage(in.Language)
	levels, err := parseLevels(in.Levels)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	slug := c.Param("slug")
	ctx := c.Request.Context()
	current, err := m.loadTopicContent(ctx, slug, language)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	// Refuse to overwrite work somebody did by hand unless they say so again. An owner who
	// spent an hour on B2 should not lose it to a mis-click on a button labelled Generate.
	if !in.Overwrite {
		if edited := handEditedLevels(current, levels); len(edited) > 0 {
			httpx.Fail(c, apperr.Conflict("This would replace content that was edited by hand").
				WithDetails(map[string]any{"levels": edited}))
			return
		}
	}

	category := ""
	if current.Topic.CategoryName != nil {
		category = *current.Topic.CategoryName
	}
	generated, meta, err := m.author.AuthorGrammarContent(ctx, ai.GrammarAuthorRequest{
		Topic:         current.Topic.Name,
		Slug:          current.Topic.Slug,
		Category:      category,
		Description:   current.Topic.Description,
		Levels:        levels,
		Language:      language,
		RelatedTopics: current.Related,
		ActorID:       &p.UserID,
	})
	if err != nil {
		// The provider's own words are not shown: they can carry prompt text and model
		// internals. The owner needs to know it failed and that retrying is reasonable.
		httpx.Fail(c, apperr.Wrap(err, apperr.CodeUnavailable,
			"AI content generation failed. Please try again."))
		return
	}

	var aiRequestID *uuid.UUID
	if meta != nil && meta.AIRequestID != uuid.Nil {
		aiRequestID = &meta.AIRequestID
	}
	if err := m.storeGenerated(ctx, current.Topic.ID, language, p.UserID, aiRequestID, generated); err != nil {
		httpx.Fail(c, err)
		return
	}

	recordGrammarAudit(ctx, m.audit, p.UserID, ActionGrammarGenerated, slug, map[string]any{
		"language": language, "levels": in.Levels, "overwrite": in.Overwrite,
	})

	out, err := m.loadTopicContent(ctx, slug, language)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, out)
}

// handEditedLevels are the levels whose newest version a person wrote, not a model.
func handEditedLevels(current TopicContent, levels []cefr.Level) []string {
	wanted := map[string]bool{}
	for _, level := range levels {
		wanted[level.BaseCode()] = true
	}
	var edited []string
	for _, level := range current.Levels {
		if !wanted[level.Level] || level.Status == ContentNotCreated {
			continue
		}
		if level.Source == "curated" {
			edited = append(edited, level.Level)
		}
	}
	return edited
}

// storeGenerated writes each level as a new draft version, in one transaction: a partial
// generation that left three levels written and three missing would be worse than none.
func (m *Module) storeGenerated(
	ctx context.Context, topicID uuid.UUID, language string, actor uuid.UUID,
	aiRequestID *uuid.UUID, generated *ai.GeneratedGrammarContent,
) error {
	return database.WithTx(ctx, m.pool, func(tx pgx.Tx) error {
		for _, level := range generated.Levels {
			status := "draft"
			body := json.RawMessage(`{}`)
			if !level.Applicable {
				status = ContentNotApplicable
			} else {
				encoded, err := json.Marshal(grammarBody(level))
				if err != nil {
					return err
				}
				body = encoded
			}

			summary := level.Summary
			if !level.Applicable {
				summary = level.Reason
			}

			var contentID uuid.UUID
			if err := tx.QueryRow(ctx, `
				INSERT INTO grammar_content (grammar_topic_id, language, level_code, body, title, summary,
				                             version, status, source, ai_request_id, created_by)
				SELECT $1, $2, $3::cefr_code, $4, $5, $6,
				       coalesce((SELECT max(version) FROM grammar_content
				                  WHERE grammar_topic_id = $1 AND language = $2
				                    AND level_code = $3::cefr_code), 0) + 1,
				       $7, 'ai', $8, $9
				RETURNING id`,
				topicID, language, level.Level, body, level.Title, summary, status, aiRequestID, actor).
				Scan(&contentID); err != nil {
				return err
			}

			if !level.Applicable || len(level.Practice) == 0 {
				continue
			}
			// Practice is regenerated wholesale for the level: the questions belong to the
			// explanation they were written against, and keeping the old ones beside a
			// rewritten lesson is how a question ends up testing a rule the page no longer
			// mentions. Only this level's generated questions go; curated ones stay.
			if _, err := tx.Exec(ctx, `
				DELETE FROM grammar_questions
				WHERE grammar_topic_id = $1 AND source = 'ai' AND status <> 'published'
				  AND level_id = (SELECT id FROM levels WHERE code = $2)`, topicID, level.Level); err != nil {
				return err
			}
			for _, q := range level.Practice {
				payload, err := json.Marshal(map[string]any{"options": q.Options})
				if err != nil {
					return err
				}
				// correct_index, not index: this is the marking key, and internal/grammar's
				// scorer reads correct_index. Writing the other name produced questions that
				// looked fine in the console and could not be marked right by a learner.
				answer, err := json.Marshal(map[string]any{"correct_index": q.AnswerIndex})
				if err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `
					INSERT INTO grammar_questions (grammar_topic_id, type, level_id, prompt, payload, answer,
					                               explanation, target_rule, source, status, ai_request_id)
					VALUES ($1, 'multiple_choice', (SELECT id FROM levels WHERE code = $2), $3, $4, $5, $6, $7,
					        'ai', 'draft', $8)`,
					topicID, level.Level, q.Prompt, payload, answer, q.Explanation, q.TargetRule, aiRequestID); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

// grammarBody maps a generated level onto the shape the learner page already renders, so
// generated and hand-written content are the same document to everything downstream.
func grammarBody(level ai.GeneratedGrammarLevel) map[string]any {
	formulas := make([]map[string]any, 0, len(level.Formulas))
	for _, f := range level.Formulas {
		formulas = append(formulas, map[string]any{"label": f.Label, "pattern": f.Pattern, "examples": f.Examples})
	}
	examples := make([]map[string]any, 0, len(level.Examples))
	for _, e := range level.Examples {
		examples = append(examples, map[string]any{"text": e.Text, "note": e.Note})
	}
	mistakes := make([]map[string]any, 0, len(level.CommonMistakes))
	for _, mistake := range level.CommonMistakes {
		mistakes = append(mistakes, map[string]any{
			"wrong": mistake.Wrong, "right": mistake.Right, "why": mistake.Why, "rule": mistake.Rule,
		})
	}
	return map[string]any{
		"intro":           level.Intro,
		"explanation":     level.Explanation,
		"usage":           orEmptyStrings(level.Usage),
		"formulas":        formulas,
		"signal_words":    orEmptyStrings(level.SignalWords),
		"examples":        examples,
		"common_mistakes": mistakes,
	}
}

func orEmptyStrings(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

// ---- saving an edit --------------------------------------------------------------------

type levelInput struct {
	Language string           `json:"language" binding:"omitempty,oneof=en uz ru"`
	Title    *string          `json:"title" binding:"omitempty,max=200"`
	Summary  *string          `json:"summary" binding:"omitempty,max=600"`
	Body     *json.RawMessage `json:"body"`
	/** draft | review | not_applicable. Publishing goes through its own endpoint. */
	Status *string `json:"status" binding:"omitempty,oneof=draft review not_applicable"`
	/**
	 * The level's practice, in full. Present means "these are the questions now": the ones
	 * not yet published are replaced by this list. Absent means the owner did not touch
	 * practice on this save, and it is left alone — a builder that quietly deleted the
	 * questions every time somebody fixed a typo in the intro would be worse than one that
	 * could not edit them at all.
	 */
	Questions *[]levelQuestionInput `json:"questions" binding:"omitempty,max=50,dive"`
}

type levelQuestionInput struct {
	Prompt      string   `json:"prompt" binding:"required,min=3,max=600"`
	Options     []string `json:"options" binding:"required,min=2,max=6,dive,required,max=300"`
	AnswerIndex int      `json:"answer_index" binding:"min=0,max=5"`
	Explanation string   `json:"explanation" binding:"omitempty,max=800"`
	TargetRule  string   `json:"target_rule" binding:"omitempty,max=200"`
}

// saveGrammarLevel stores an owner's edit as a new draft version.
//
// It never edits a published row in place. A learner reading the topic keeps reading the
// version that was reviewed, until somebody publishes the new one.
func (m *Module) saveGrammarLevel(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	slug := c.Param("slug")
	level, err := cefr.Parse(strings.ToUpper(c.Param("level")))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid CEFR level"))
		return
	}
	var in levelInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	language := editorLanguage(in.Language)
	ctx := c.Request.Context()

	var topicID uuid.UUID
	if err := m.pool.QueryRow(ctx, `SELECT id FROM grammar_topics WHERE slug = $1`, slug).Scan(&topicID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Fail(c, apperr.NotFound("Grammar topic"))
			return
		}
		httpx.Fail(c, err)
		return
	}

	status := "draft"
	if in.Status != nil {
		status = *in.Status
	}
	body := json.RawMessage(`{}`)
	if in.Body != nil {
		body = *in.Body
	}

	// Carried forward from the newest version so an edit to one field does not blank the
	// others. `source` becomes curated: a person touched it, and the next Generate has to
	// ask before overwriting that.
	if _, err := m.pool.Exec(ctx, `
		INSERT INTO grammar_content (grammar_topic_id, language, level_code, body, title, summary,
		                             version, status, source, created_by)
		SELECT $1, $2, $3::cefr_code,
		       COALESCE($4::jsonb, previous.body, '{}'::jsonb),
		       COALESCE($5::text, previous.title, ''),
		       COALESCE($6::text, previous.summary, ''),
		       COALESCE(previous.version, 0) + 1, $7, 'curated', $8
		FROM (SELECT NULL::jsonb AS body, NULL::text AS title, NULL::text AS summary, NULL::int AS version) empty
		LEFT JOIN LATERAL (
		    SELECT body, title, summary, version FROM grammar_content
		    WHERE grammar_topic_id = $1 AND language = $2 AND level_code = $3::cefr_code
		    ORDER BY version DESC LIMIT 1
		) previous ON true`,
		topicID, language, level.BaseCode(), nullRaw(in.Body, body), in.Title, in.Summary, status, p.UserID); err != nil {
		httpx.Fail(c, err)
		return
	}

	if in.Questions != nil {
		if err := m.replaceLevelQuestions(ctx, topicID, level, *in.Questions); err != nil {
			httpx.Fail(c, err)
			return
		}
	}

	out, err := m.loadTopicContent(ctx, slug, language)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, out)
}

// replaceLevelQuestions swaps the level's unpublished practice for the list the owner saved.
//
// Published questions are left where they are: learners may be mid-attempt on them, and a
// draft edit is not a publication. They are replaced when the topic is published, by the
// same rule that replaces the text.
func (m *Module) replaceLevelQuestions(ctx context.Context, topicID uuid.UUID, level cefr.Level, questions []levelQuestionInput) error {
	return database.WithTx(ctx, m.pool, func(tx pgx.Tx) error {
		// Scoped to multiple choice: the builder shows that type and only that type, and a
		// save must not delete a gap-fill or a rewrite task it never put on the screen.
		if _, err := tx.Exec(ctx, `
			DELETE FROM grammar_questions
			WHERE grammar_topic_id = $1 AND status <> 'published' AND type = 'multiple_choice'
			  AND level_id = (SELECT id FROM levels WHERE code = $2)`, topicID, level.BaseCode()); err != nil {
			return err
		}
		for _, q := range questions {
			if q.AnswerIndex < 0 || q.AnswerIndex >= len(q.Options) {
				return apperr.Validation(map[string]any{
					"reason": "answer_out_of_range",
					"fields": map[string]any{"answer_index": "the correct answer must be one of the options"},
				})
			}
			payload, err := json.Marshal(map[string]any{"options": q.Options})
			if err != nil {
				return err
			}
			answer, err := json.Marshal(map[string]any{"correct_index": q.AnswerIndex})
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO grammar_questions (grammar_topic_id, type, level_id, prompt, payload, answer,
				                               explanation, target_rule, source, status)
				VALUES ($1, 'multiple_choice', (SELECT id FROM levels WHERE code = $2), $3, $4, $5, $6, $7,
				        'curated', 'draft')`,
				topicID, level.BaseCode(), q.Prompt, payload, answer, q.Explanation, q.TargetRule); err != nil {
				return err
			}
		}
		return nil
	})
}

func nullRaw(in *json.RawMessage, fallback json.RawMessage) any {
	if in == nil {
		return nil
	}
	_ = fallback
	return []byte(*in)
}

// ---- validation and publishing ----------------------------------------------------------

// Issue is one reason the content cannot go live, named precisely enough to fix.
type Issue struct {
	Level   string `json:"level"`
	Field   string `json:"field"`
	Message string `json:"message"`
}

type ValidationResult struct {
	Language   string   `json:"language"`
	Levels     []string `json:"levels"`
	Issues     []Issue  `json:"issues"`
	CanPublish bool     `json:"can_publish"`
}

func (m *Module) validateGrammarContent(c *gin.Context) {
	language := editorLanguage(c.Query("lang"))
	result, _, err := m.checkTopic(c.Request.Context(), c.Param("slug"), language, nil)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, result)
}

// checkTopic reports what stands between the current drafts and a learner reading them.
//
// It checks the things that break a page or mislead a learner, not style: an empty
// explanation, a lesson with nothing to show, a question that cannot be marked. Everything
// else is the owner's judgement, and a validator that argues about prose is a validator
// people learn to ignore.
func (m *Module) checkTopic(ctx context.Context, slug, language string, only []cefr.Level) (ValidationResult, TopicContent, error) {
	out := ValidationResult{Language: language, Issues: []Issue{}, Levels: []string{}}
	content, err := m.loadTopicContent(ctx, slug, language)
	if err != nil {
		return out, content, err
	}

	wanted := map[string]bool{}
	for _, level := range only {
		wanted[level.BaseCode()] = true
	}

	for _, level := range content.Levels {
		if len(wanted) > 0 && !wanted[level.Level] {
			continue
		}
		// Nothing written and nothing asked for: not an error, just not ready.
		if level.Status == ContentNotCreated || level.Status == ContentNotApplicable {
			continue
		}
		out.Levels = append(out.Levels, level.Level)

		var body struct {
			Intro       string            `json:"intro"`
			Explanation string            `json:"explanation"`
			Examples    []json.RawMessage `json:"examples"`
			Formulas    []json.RawMessage `json:"formulas"`
		}
		_ = json.Unmarshal(level.Body, &body)

		if strings.TrimSpace(body.Explanation) == "" && strings.TrimSpace(body.Intro) == "" {
			out.Issues = append(out.Issues, Issue{
				Level: level.Level, Field: "explanation",
				Message: fmt.Sprintf("%s explanation is empty", level.Level),
			})
		}
		if len(body.Examples) == 0 && len(body.Formulas) == 0 {
			out.Issues = append(out.Issues, Issue{
				Level: level.Level, Field: "examples",
				Message: fmt.Sprintf("%s has neither examples nor a formula", level.Level),
			})
		}
		if strings.TrimSpace(level.Title) == "" {
			out.Issues = append(out.Issues, Issue{
				Level: level.Level, Field: "title",
				Message: fmt.Sprintf("%s has no title", level.Level),
			})
		}
	}

	// Practice questions are checked against what actually marks them: an answer index that
	// points outside its own options marks a correct learner wrong.
	//
	// Two things this used to get wrong, both of which reported problems that were not there.
	// It read answer->>'index', while internal/grammar marks on answer->>'correct_index'. And
	// it checked every question type for options, so a gap-fill — which correctly has none —
	// was reported as broken on every topic that had one.
	rows, err := m.pool.Query(ctx, `
		SELECT COALESCE(l.code, ''), q.prompt,
		       COALESCE(jsonb_array_length(q.payload -> 'options'), 0),
		       COALESCE((q.answer ->> 'correct_index')::int, (q.answer ->> 'index')::int, -1)
		FROM grammar_questions q
		LEFT JOIN levels l ON l.id = q.level_id
		WHERE q.grammar_topic_id = $1 AND q.status <> 'archived'
		  AND q.type IN ('multiple_choice', 'contextual')`, content.Topic.ID)
	if err != nil {
		return out, content, err
	}
	defer rows.Close()
	index := 0
	for rows.Next() {
		index++
		var code, prompt string
		var options, answer int
		if err := rows.Scan(&code, &prompt, &options, &answer); err != nil {
			return out, content, err
		}
		if len(wanted) > 0 && code != "" && !wanted[code] {
			continue
		}
		if options < 2 {
			out.Issues = append(out.Issues, Issue{
				Level: code, Field: "practice",
				Message: fmt.Sprintf("Question %d has fewer than two options", index),
			})
			continue
		}
		if answer < 0 || answer >= options {
			out.Issues = append(out.Issues, Issue{
				Level: code, Field: "practice",
				Message: fmt.Sprintf("Question %d has no correct answer", index),
			})
		}
	}
	if err := rows.Err(); err != nil {
		return out, content, err
	}

	out.CanPublish = len(out.Issues) == 0 && len(out.Levels) > 0
	return out, content, nil
}

type publishInput struct {
	Language string `json:"language" binding:"omitempty,oneof=en uz ru"`
	/** Empty publishes every level that has a draft. */
	Levels []string `json:"levels" binding:"omitempty,max=6,dive,max=4"`
}

// publishGrammarContent puts the current drafts in front of learners.
//
// Validation runs first and a failure stops everything: publishing four good levels and
// refusing the fifth would leave the topic half-live with no clear way back.
func (m *Module) publishGrammarContent(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var in publishInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	language := editorLanguage(in.Language)
	levels, err := parseLevels(in.Levels)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	slug := c.Param("slug")
	ctx := c.Request.Context()
	result, content, err := m.checkTopic(ctx, slug, language, levels)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if !result.CanPublish {
		message := "Content cannot be published yet"
		if len(result.Levels) == 0 {
			message = "There is nothing to publish yet"
		}
		httpx.Fail(c, apperr.New(apperr.CodeConflict, message).
			WithDetails(map[string]any{"issues": result.Issues}))
		return
	}

	publishing := result.Levels
	err = database.WithTx(ctx, m.pool, func(tx pgx.Tx) error {
		for _, code := range publishing {
			// Retire the live version before promoting the new one: the unique index allows
			// exactly one published row per topic, language and level, and that constraint
			// is what stops two versions being live at once.
			if _, err := tx.Exec(ctx, `
				UPDATE grammar_content SET status = 'archived'
				WHERE grammar_topic_id = $1 AND language = $2 AND level_code = $3::cefr_code
				  AND status = 'published'`,
				content.Topic.ID, language, code); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				UPDATE grammar_content SET status = 'published', published_at = now(), reviewed_by = $4
				WHERE id = (SELECT id FROM grammar_content
				             WHERE grammar_topic_id = $1 AND language = $2 AND level_code = $3::cefr_code
				               AND status IN ('draft', 'review')
				             ORDER BY version DESC LIMIT 1)`,
				content.Topic.ID, language, code, p.UserID); err != nil {
				return err
			}
			// Anything older than what just went live is history, not pending work. Left
			// as drafts they would sit on the map for ever as "still to do", which is the
			// opposite of what they are.
			if _, err := tx.Exec(ctx, `
				UPDATE grammar_content SET status = 'archived'
				WHERE grammar_topic_id = $1 AND language = $2 AND level_code = $3::cefr_code
				  AND status IN ('draft', 'review')
				  AND version < (SELECT version FROM grammar_content
				                  WHERE grammar_topic_id = $1 AND language = $2
				                    AND level_code = $3::cefr_code AND status = 'published')`,
				content.Topic.ID, language, code); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				UPDATE grammar_questions SET status = 'published'
				WHERE grammar_topic_id = $1 AND status = 'draft'
				  AND level_id = (SELECT id FROM levels WHERE code = $2)`, content.Topic.ID, code); err != nil {
				return err
			}
		}
		// A topic with published content belongs in the library; leaving it a draft would
		// publish text nobody can reach.
		_, err := tx.Exec(ctx, `
			UPDATE grammar_topics
			SET status = 'published', published_at = COALESCE(published_at, now())
			WHERE id = $1 AND status <> 'published'`, content.Topic.ID)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	recordGrammarAudit(ctx, m.audit, p.UserID, ActionGrammarPublished, slug, map[string]any{
		"language": language, "levels": publishing,
	})

	out, err := m.loadTopicContent(ctx, slug, language)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, out)
}
