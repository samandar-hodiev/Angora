package admin

import (
	"context"
	"encoding/json"
	"errors"
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
	// Parts is what to write: explanation, test, writing, speaking. Empty is all of them —
	// jobs queued before parts existed meant everything.
	Parts []string `json:"parts,omitempty"`
}

// The parts of a topic one Generate can write.
const (
	PartExplanation = "explanation"
	PartTest        = "test"
	PartWriting     = "writing"
	PartSpeaking    = "speaking"
)

var allParts = []string{PartExplanation, PartTest, PartWriting, PartSpeaking}

func (p generationPlan) languages() []string {
	return append([]string{p.Source}, p.Targets...)
}

func (p generationPlan) wants(part string) bool {
	if len(p.Parts) == 0 {
		return true
	}
	for _, x := range p.Parts {
		if x == part {
			return true
		}
	}
	return false
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

	// Steps, for the progress bar: the explanation, one translation per language, a test
	// per level, a task per level and kind, and storing it all.
	progress := jobs.TrackerFrom(ctx)
	steps := 1
	if plan.wants(PartExplanation) {
		steps += 1 + len(plan.Targets)
	}
	if plan.wants(PartTest) {
		steps += len(levels)
	}
	for _, part := range []string{PartWriting, PartSpeaking} {
		if plan.wants(part) {
			steps += len(levels)
		}
	}
	progress.SetTotal(steps)

	actor := plan.Actor
	failed := []string{}
	languages := []string{}

	// The lessons the test is written against, by level: the ones written now, or — when the
	// explanation is not being rewritten — the English drafts already there.
	var generated *ai.GeneratedGrammarContent
	var aiRequestID *uuid.UUID
	if plan.wants(PartExplanation) {
		var meta *ai.EvaluationMeta
		generated, meta, err = m.author.AuthorGrammarContent(ctx, ai.GrammarAuthorRequest{
			Topic:       current.Topic.Name,
			Slug:        current.Topic.Slug,
			Category:    category,
			Description: current.Topic.Description,
			// The explanation is one lesson for every learner, so it is written for every
			// level whichever ones were picked; the picked levels are the practice's.
			Levels:        everyLevel(),
			Language:      plan.Source,
			RelatedTopics: current.Related,
			ActorID:       &actor,
		})
		if err != nil {
			// The provider's own words are not shown: they can carry prompt text and model
			// internals. The owner needs to know it failed and that retrying is reasonable.
			return nil, apperr.Wrap(err, apperr.CodeUnavailable, "AI content generation failed. Please try again.")
		}
		if meta != nil && meta.AIRequestID != uuid.Nil {
			aiRequestID = &meta.AIRequestID
		}
		for _, code := range generated.Dropped {
			failed = append(failed, plan.Source+":"+code)
		}
		progress.Step()
	}
	lessons, taskLevels, err := m.lessonsFor(ctx, plan, levels, generated)
	if err != nil {
		return nil, err
	}

	// The test and the tasks are written while the translations run: they need only the
	// English, and one after the other would multiply the wait for nothing.
	type testResult struct {
		practice [][]ai.GeneratedPractice
		failed   []string
	}
	tests := make(chan testResult, 1)
	go func() {
		if !plan.wants(PartTest) {
			tests <- testResult{}
			return
		}
		practice, failed := m.writeTests(ctx, current, category, actor, lessons)
		tests <- testResult{practice, failed}
	}()
	type taskResult struct {
		tasks  []PracticeTask
		failed []string
	}
	tasks := make(chan taskResult, 1)
	go func() {
		var kinds []string
		if plan.wants(PartWriting) {
			kinds = append(kinds, TaskWriting)
		}
		if plan.wants(PartSpeaking) {
			kinds = append(kinds, TaskSpeaking)
		}
		written, failed := m.writeTasks(ctx, current, actor, taskLevels, kinds)
		tasks <- taskResult{written, failed}
	}()

	type translation struct {
		target  string
		levels  []ai.GeneratedGrammarLevel
		missing []string
	}
	var translations []translation
	if generated != nil && len(generated.Levels) > 0 && len(plan.Targets) > 0 && m.refiner != nil {
		// Every level shares the one lesson, so it is translated once per language and the
		// translation is shared the same way — not six translations of the same text.
		shared := generated.Levels[:1]
		for _, target := range plan.Targets {
			done, missing := m.translateAll(ctx, current, category, plan.Source, target, actor, shared)
			if len(done) == 1 {
				done = shareTranslation(done[0], generated.Levels)
			}
			translations = append(translations, translation{target, done, missing})
			progress.Step()
		}
	}
	writtenTests := <-tests
	writtenTasks := <-tasks
	failed = append(failed, writtenTests.failed...)
	failed = append(failed, writtenTasks.failed...)

	if generated != nil {
		// Without a new test, the lesson's own few questions do not replace the test there is.
		for i := range generated.Levels {
			generated.Levels[i].Practice = nil
		}
		for i, practice := range writtenTests.practice {
			if practice != nil {
				code := lessons[i].Level
				for j := range generated.Levels {
					if generated.Levels[j].Level == code {
						generated.Levels[j].Practice = practice
					}
				}
			}
		}
		if err := m.storeGenerated(ctx, current.Topic.ID, plan.Source, actor, aiRequestID, generated); err != nil {
			return nil, err
		}
		languages = append(languages, plan.Source)
		for _, t := range translations {
			if err := m.storeTranslated(ctx, current.Topic.ID, t.target, actor, t.levels); err != nil {
				return nil, err
			}
			if len(t.levels) > 0 {
				languages = append(languages, t.target)
			}
			failed = append(failed, t.missing...)
		}
	} else if len(writtenTests.practice) > 0 {
		if err := database.WithTx(ctx, m.pool, func(tx pgx.Tx) error {
			for i, practice := range writtenTests.practice {
				if practice != nil {
					if err := replaceAIPractice(ctx, tx, current.Topic.ID, lessons[i].Level, practice, nil); err != nil {
						return err
					}
				}
			}
			return nil
		}); err != nil {
			return nil, err
		}
	}
	if err := m.storeTasks(ctx, current.Topic.ID, actor, "ai", writtenTasks.tasks); err != nil {
		return nil, err
	}
	progress.Step()

	return map[string]any{
		"slug": plan.Slug, "languages": languages, "levels": plan.Levels, "parts": plan.partsOrAll(), "failed": failed,
	}, nil
}

// shareTranslation gives every level the one translated lesson, each under its own level.
func shareTranslation(lesson ai.GeneratedGrammarLevel, levels []ai.GeneratedGrammarLevel) []ai.GeneratedGrammarLevel {
	out := make([]ai.GeneratedGrammarLevel, 0, len(levels))
	for _, level := range levels {
		copied := lesson
		copied.Level, copied.Applicable, copied.Reason = level.Level, level.Applicable, level.Reason
		out = append(out, copied)
	}
	return out
}

// everyLevel is A1 to C2: where a topic's one explanation is stored.
func everyLevel() []cefr.Level {
	out := make([]cefr.Level, 0, len(cefr.Codes))
	for _, code := range cefr.Codes {
		if level, err := cefr.Parse(code); err == nil {
			out = append(out, level)
		}
	}
	return out
}

func (p generationPlan) partsOrAll() []string {
	if len(p.Parts) == 0 {
		return allParts
	}
	return p.Parts
}

// lessonsFor is what the test and the tasks are written against. With a new explanation it
// is that explanation's applicable levels. Without one it is the English text already
// drafted or live for each asked-for level; a level with none gets no test, and a level an
// editor marked not applicable gets nothing at all.
func (m *Module) lessonsFor(
	ctx context.Context, plan generationPlan, levels []cefr.Level, generated *ai.GeneratedGrammarContent,
) ([]ai.GeneratedGrammarLevel, []cefr.Level, error) {
	var lessons []ai.GeneratedGrammarLevel
	var taskLevels []cefr.Level
	if generated != nil {
		picked := map[string]bool{}
		for _, level := range levels {
			picked[level.BaseCode()] = true
		}
		for _, l := range generated.Levels {
			if !l.Applicable || !picked[l.Level] {
				continue
			}
			lessons = append(lessons, l)
			if parsed, err := cefr.Parse(l.Level); err == nil {
				taskLevels = append(taskLevels, parsed)
			}
		}
		return lessons, taskLevels, nil
	}
	for _, level := range levels {
		var status string
		err := m.pool.QueryRow(ctx, `
			SELECT gc.status FROM grammar_content gc JOIN grammar_topics t ON t.id = gc.grammar_topic_id
			WHERE t.slug = $1 AND gc.language = 'en' AND gc.level_code = $2::cefr_code
			ORDER BY gc.version DESC LIMIT 1`, plan.Slug, level.BaseCode()).Scan(&status)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, err
		}
		if status == ContentNotApplicable {
			continue
		}
		taskLevels = append(taskLevels, level)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		lesson, found, err := m.levelDraft(ctx, plan.Slug, "en", level)
		if err != nil {
			return nil, nil, err
		}
		if found {
			lesson.Practice = nil
			lessons = append(lessons, lesson)
		}
	}
	return lessons, taskLevels, nil
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
			defer jobs.TrackerFrom(ctx).Step()
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
