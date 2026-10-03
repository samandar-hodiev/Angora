package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/jobs"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

// Generating a topic in every language, in the background.
//
// English is written first and the other languages are translated from it, rather than each
// being generated on its own: three independent generations are three lessons that disagree
// about what the topic teaches, and a learner switching language would notice. Translations
// run in parallel, a few at a time, once English exists.

// JobGrammarGenerate is the job type a queued generation runs as.
const JobGrammarGenerate = "grammar.generate_content"

// translationConcurrency bounds how many levels are translated at once: enough to finish
// six levels × two languages in about the time of one, few enough not to trip rate limits.
const translationConcurrency = 4

// generationPlan is the job payload and the synchronous path's input alike.
type generationPlan struct {
	Slug   string   `json:"slug"`
	Levels []string `json:"levels"`
	// Source is the language the model writes in. Targets are translated from it.
	Source    string    `json:"source"`
	Targets   []string  `json:"targets,omitempty"`
	Actor     uuid.UUID `json:"actor"`
	Overwrite bool      `json:"overwrite"`
}

func (p generationPlan) languages() []string {
	return append([]string{p.Source}, p.Targets...)
}

// translationTargets is every requested language other than English, in a stable order.
func translationTargets(requested []string) []string {
	want := map[string]bool{}
	for _, language := range requested {
		want[language] = true
	}
	var out []string
	for _, language := range []string{"uz", "ru"} {
		if want[language] {
			out = append(out, language)
		}
	}
	return out
}

func levelCodes(levels []cefr.Level) []string {
	out := make([]string, len(levels))
	for i, level := range levels {
		out[i] = level.BaseCode()
	}
	return out
}

// HandleGenerateJob is the worker side of a queued generation.
func (m *Module) HandleGenerateJob(ctx context.Context, job *jobs.Job) (map[string]any, error) {
	var plan generationPlan
	if err := json.Unmarshal(job.Payload, &plan); err != nil {
		return nil, jobs.Permanent("bad_payload", err)
	}
	result, err := m.runGeneration(ctx, plan)
	if err != nil {
		return nil, jobs.Permanent("generation_failed", err)
	}
	return result, nil
}

// runGeneration writes the plan's levels in the source language, stores them, then
// translates every applicable level into each target language and stores those too.
//
// A failed translation does not undo the English: the owner gets what was written, and the
// result names what is missing so it can be translated again from the editor.
func (m *Module) runGeneration(ctx context.Context, plan generationPlan) (map[string]any, error) {
	if m.author == nil {
		return nil, apperr.New(apperr.CodeUnavailable, "AI content generation is not configured")
	}
	levels, err := parseLevels(plan.Levels)
	if err != nil {
		return nil, err
	}
	current, err := m.loadTopicContent(ctx, plan.Slug, plan.Source)
	if err != nil {
		return nil, err
	}
	category := ""
	if current.Topic.CategoryName != nil {
		category = *current.Topic.CategoryName
	}

	actor := plan.Actor
	generated, meta, err := m.author.AuthorGrammarContent(ctx, ai.GrammarAuthorRequest{
		Topic:         current.Topic.Name,
		Slug:          current.Topic.Slug,
		Category:      category,
		Description:   current.Topic.Description,
		Levels:        levels,
		Language:      plan.Source,
		RelatedTopics: current.Related,
		ActorID:       &actor,
	})
	if err != nil {
		// The provider's own words are not shown: they can carry prompt text and model
		// internals. The owner needs to know it failed and that retrying is reasonable.
		return nil, apperr.Wrap(err, apperr.CodeUnavailable, "AI content generation failed. Please try again.")
	}

	var aiRequestID *uuid.UUID
	if meta != nil && meta.AIRequestID != uuid.Nil {
		aiRequestID = &meta.AIRequestID
	}

	// The tests are written while the translations run: both need only the English, and
	// one after the other would double the wait for nothing.
	type testResult struct {
		practice [][]ai.GeneratedPractice
		failed   []string
	}
	tests := make(chan testResult, 1)
	go func() {
		practice, failed := m.writeTests(ctx, current, category, actor, generated.Levels)
		tests <- testResult{practice, failed}
	}()

	type translation struct {
		target  string
		levels  []ai.GeneratedGrammarLevel
		missing []string
	}
	var translations []translation
	if len(plan.Targets) > 0 && m.refiner != nil {
		for _, target := range plan.Targets {
			done, missing := m.translateAll(ctx, current, category, plan.Source, target, actor, generated.Levels)
			translations = append(translations, translation{target, done, missing})
		}
	}
	written := <-tests
	failed := written.failed
	for i, practice := range written.practice {
		if practice != nil {
			generated.Levels[i].Practice = practice
		}
	}

	if err := m.storeGenerated(ctx, current.Topic.ID, plan.Source, actor, aiRequestID, generated); err != nil {
		return nil, err
	}
	languages := []string{plan.Source}
	for _, t := range translations {
		if err := m.storeTranslated(ctx, current.Topic.ID, t.target, actor, t.levels); err != nil {
			return nil, err
		}
		if len(t.levels) > 0 {
			languages = append(languages, t.target)
		}
		failed = append(failed, t.missing...)
	}

	return map[string]any{"slug": plan.Slug, "languages": languages, "levels": plan.Levels, "failed": failed}, nil
}

// PracticeWriter writes a level's test. The content author implements it; an author that
// does not keeps the few questions the lesson call wrote.
type PracticeWriter interface {
	WriteGrammarPractice(ctx context.Context, req ai.GrammarPracticeRequest) ([]ai.GeneratedPractice, *ai.EvaluationMeta, error)
}

// writeTests writes a full test for each applicable level, a few levels at a time, and
// returns them by level index. It only reads levels — the translations read them at the same
// time — and the caller swaps the tests in once both are done. A level whose test could not
// be written gets nil, keeps the lesson's questions, and is named in the second result
// ("test:B1"), so the owner knows to add more by hand.
func (m *Module) writeTests(
	ctx context.Context, topic TopicContent, category string, actor uuid.UUID, levels []ai.GeneratedGrammarLevel,
) ([][]ai.GeneratedPractice, []string) {
	writer, ok := m.author.(PracticeWriter)
	if !ok {
		return nil, nil
	}
	written := make([][]ai.GeneratedPractice, len(levels))
	failed := make([]bool, len(levels))
	sem := make(chan struct{}, translationConcurrency)
	var wg sync.WaitGroup
	for i := range levels {
		if !levels[i].Applicable {
			continue
		}
		parsed, err := cefr.Parse(levels[i].Level)
		if err != nil {
			continue
		}
		wg.Add(1)
		go func(i int, parsed cefr.Level) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			questions, _, err := writer.WriteGrammarPractice(ctx, ai.GrammarPracticeRequest{
				Topic: topic.Topic.Name, Slug: topic.Topic.Slug, Category: category,
				Description: topic.Topic.Description, Level: parsed, Lesson: levels[i], ActorID: &actor,
			})
			if err != nil {
				failed[i] = true
				return
			}
			written[i] = questions
		}(i, parsed)
	}
	wg.Wait()

	var out []string
	for i, f := range failed {
		if f {
			out = append(out, "test:"+levels[i].Level)
		}
	}
	return written, out
}

// translateAll translates every applicable level into one language, a few at a time.
// Levels the model refused stay refused in every language, without a call. It returns
// what was translated and "language:level" for each one that was not.
func (m *Module) translateAll(
	ctx context.Context, topic TopicContent, category, from, to string, actor uuid.UUID,
	levels []ai.GeneratedGrammarLevel,
) ([]ai.GeneratedGrammarLevel, []string) {
	out := make([]ai.GeneratedGrammarLevel, len(levels))
	ok := make([]bool, len(levels))
	sem := make(chan struct{}, translationConcurrency)
	var wg sync.WaitGroup

	for i, level := range levels {
		if !level.Applicable {
			out[i], ok[i] = level, true
			continue
		}
		parsed, err := cefr.Parse(level.Level)
		if err != nil {
			continue
		}
		wg.Add(1)
		go func(i int, level ai.GeneratedGrammarLevel, parsed cefr.Level) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			// Questions are not translated: they belong to the level, not to a language, and
			// storeTranslated would drop them anyway. Leaving them out keeps the call short.
			level.Practice = nil
			req := ai.GrammarTranslateRequest{
				Topic: topic.Topic.Name, Slug: topic.Topic.Slug, Category: category, Level: parsed,
				From: from, To: to, Source: level, ActorID: &actor,
			}
			// One more try: a single level failing is usually one bad response, and a gap
			// in one language is work the owner would otherwise have to notice and redo.
			translated, _, err := m.refiner.TranslateGrammarLevel(ctx, req)
			if err != nil && ctx.Err() == nil {
				translated, _, err = m.refiner.TranslateGrammarLevel(ctx, req)
			}
			if err != nil {
				return
			}
			out[i], ok[i] = *translated, true
		}(i, level, parsed)
	}
	wg.Wait()

	var done []ai.GeneratedGrammarLevel
	var missing []string
	for i := range levels {
		if ok[i] {
			done = append(done, out[i])
		} else {
			missing = append(missing, fmt.Sprintf("%s:%s", to, levels[i].Level))
		}
	}
	return done, missing
}

// storeTranslated writes translated levels as new draft versions. Practice is not touched:
// questions belong to a level, not to a language, and were written with the source.
func (m *Module) storeTranslated(
	ctx context.Context, topicID uuid.UUID, language string, actor uuid.UUID, levels []ai.GeneratedGrammarLevel,
) error {
	if len(levels) == 0 {
		return nil
	}
	return database.WithTx(ctx, m.pool, func(tx pgx.Tx) error {
		for _, level := range levels {
			status, body, summary := "draft", json.RawMessage(`{}`), level.Summary
			if !level.Applicable {
				status, summary = ContentNotApplicable, level.Reason
			} else {
				encoded, err := json.Marshal(grammarBody(level))
				if err != nil {
					return err
				}
				body = encoded
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO grammar_content (grammar_topic_id, language, level_code, body, title, summary,
				                             version, status, source, created_by)
				SELECT $1, $2, $3::cefr_code, $4, $5, $6,
				       coalesce((SELECT max(version) FROM grammar_content
				                  WHERE grammar_topic_id = $1 AND language = $2
				                    AND level_code = $3::cefr_code), 0) + 1,
				       $7, 'ai', $8`,
				topicID, language, level.Level, body, level.Title, summary, status, actor); err != nil {
				return err
			}
		}
		return nil
	})
}
