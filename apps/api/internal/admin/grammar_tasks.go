package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/jobs"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Writing and speaking tasks for a grammar topic.
//
// A learner who finishes a topic is sent on to write with it and to speak with it. Those
// tasks are part of the topic, written with it, one per level, and published with it — so an
// owner sees them in the builder beside the explanation and the test, and can fix them
// before any learner does.

const (
	TaskWriting  = "writing"
	TaskSpeaking = "speaking"
)

// PracticeTask is one level's writing or speaking task, as the builder edits it.
type PracticeTask struct {
	Kind   string `json:"kind"`
	Level  string `json:"level"`
	Title  string `json:"title"`
	Prompt string `json:"prompt"`
	/** writing: what to include; speaking: the points to talk about. */
	Instructions  []string `json:"instructions"`
	MinWords      int      `json:"min_words"`
	TargetSeconds int      `json:"target_seconds"`
	Minutes       int      `json:"minutes"`
	Focus         string   `json:"focus"`
	/** draft or published: the newest version, and whether learners have it yet. */
	Status string `json:"status"`
	Source string `json:"source"`
	/** A live version exists behind this draft. */
	Live bool `json:"live"`
}

// TaskWriter writes a topic's writing and speaking tasks. The content author implements
// it; an author that does not simply generates no tasks.
type TaskWriter interface {
	WriteGrammarTask(ctx context.Context, req ai.GrammarWritingTaskRequest) (*ai.GrammarWritingTask, error)
	WriteGrammarSpeakingTask(ctx context.Context, req ai.GrammarWritingTaskRequest) (*ai.GrammarSpeakingTask, error)
}

func taskFromWriting(level string, t ai.GrammarWritingTask) PracticeTask {
	return PracticeTask{
		Kind: TaskWriting, Level: level, Title: t.Title, Prompt: t.Prompt,
		Instructions: orEmptyStrings(t.Instructions), MinWords: t.MinWords, Minutes: max(t.Minutes, 1), Focus: t.Focus,
	}
}

func taskFromSpeaking(level string, t ai.GrammarSpeakingTask) PracticeTask {
	return PracticeTask{
		Kind: TaskSpeaking, Level: level, Title: t.Title, Prompt: t.Prompt,
		Instructions: orEmptyStrings(t.Points), TargetSeconds: t.TargetSeconds,
		Minutes: max((t.TargetSeconds+59)/60, 1), Focus: t.Focus,
	}
}

// writeTasks writes the asked-for kinds of task for each level, a few at a time. It returns
// what was written and "writing:B1" / "speaking:B1" for each one that was not.
func (m *Module) writeTasks(
	ctx context.Context, topic TopicContent, actor uuid.UUID, levels []cefr.Level, kinds []string,
) ([]PracticeTask, []string) {
	writer, ok := m.author.(TaskWriter)
	if !ok || len(kinds) == 0 {
		return nil, nil
	}
	type job struct {
		kind  string
		level cefr.Level
	}
	var todo []job
	for _, level := range levels {
		for _, kind := range kinds {
			todo = append(todo, job{kind, level})
		}
	}
	out := make([]*PracticeTask, len(todo))
	sem := make(chan struct{}, translationConcurrency)
	var wg sync.WaitGroup
	for i, j := range todo {
		wg.Add(1)
		go func(i int, j job) {
			defer wg.Done()
			defer jobs.TrackerFrom(ctx).Step()
			sem <- struct{}{}
			defer func() { <-sem }()
			req := ai.GrammarWritingTaskRequest{
				Topic: topic.Topic.Name, Slug: topic.Topic.Slug, Description: topic.Topic.Description,
				Level: j.level, UserID: actor,
			}
			switch j.kind {
			case TaskWriting:
				if t, err := writer.WriteGrammarTask(ctx, req); err == nil {
					task := taskFromWriting(j.level.BaseCode(), *t)
					out[i] = &task
				}
			case TaskSpeaking:
				if t, err := writer.WriteGrammarSpeakingTask(ctx, req); err == nil {
					task := taskFromSpeaking(j.level.BaseCode(), *t)
					out[i] = &task
				}
			}
		}(i, j)
	}
	wg.Wait()

	var written []PracticeTask
	var failed []string
	for i, j := range todo {
		if out[i] == nil {
			failed = append(failed, j.kind+":"+j.level.BaseCode())
			continue
		}
		written = append(written, *out[i])
	}
	return written, failed
}

// storeTasks writes tasks as the level's new drafts, replacing any draft already there.
func (m *Module) storeTasks(ctx context.Context, topicID uuid.UUID, actor uuid.UUID, source string, tasks []PracticeTask) error {
	if len(tasks) == 0 {
		return nil
	}
	return database.WithTx(ctx, m.pool, func(tx pgx.Tx) error {
		for _, t := range tasks {
			if err := insertTaskDraft(ctx, tx, topicID, actor, source, t); err != nil {
				return err
			}
		}
		return nil
	})
}

func insertTaskDraft(ctx context.Context, tx pgx.Tx, topicID, actor uuid.UUID, source string, t PracticeTask) error {
	instructions, err := json.Marshal(orEmptyStrings(t.Instructions))
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM grammar_practice_tasks
		WHERE grammar_topic_id = $1 AND kind = $2 AND level_code = $3::cefr_code AND status = 'draft'`,
		topicID, t.Kind, t.Level); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO grammar_practice_tasks (grammar_topic_id, kind, level_code, title, prompt, instructions,
		                                    min_words, target_seconds, minutes, focus, status, source, created_by)
		VALUES ($1, $2, $3::cefr_code, $4, $5, $6, $7, $8, $9, $10, 'draft', $11, $12)`,
		topicID, t.Kind, t.Level, t.Title, t.Prompt, instructions,
		max(t.MinWords, 0), max(t.TargetSeconds, 0), max(t.Minutes, 1), t.Focus, source, actor)
	return err
}

// tasksByLevel reads each level's newest writing and speaking task: the draft when there is
// one, otherwise the live one.
func (m *Module) tasksByLevel(ctx context.Context, topicID uuid.UUID) (map[string][]PracticeTask, error) {
	rows, err := m.pool.Query(ctx, `
		SELECT DISTINCT ON (t.level_code, t.kind)
		       t.level_code, t.kind, t.title, t.prompt, t.instructions, t.min_words, t.target_seconds,
		       t.minutes, t.focus, t.status, t.source,
		       EXISTS (SELECT 1 FROM grammar_practice_tasks l
		               WHERE l.grammar_topic_id = t.grammar_topic_id AND l.kind = t.kind
		                 AND l.level_code = t.level_code AND l.status = 'published')
		FROM grammar_practice_tasks t
		WHERE t.grammar_topic_id = $1 AND t.status IN ('draft', 'published')
		ORDER BY t.level_code, t.kind, (t.status = 'draft') DESC`, topicID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]PracticeTask{}
	for rows.Next() {
		var t PracticeTask
		var instructions []byte
		if err := rows.Scan(&t.Level, &t.Kind, &t.Title, &t.Prompt, &instructions, &t.MinWords, &t.TargetSeconds,
			&t.Minutes, &t.Focus, &t.Status, &t.Source, &t.Live); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(instructions, &t.Instructions)
		t.Instructions = orEmptyStrings(t.Instructions)
		out[t.Level] = append(out[t.Level], t)
	}
	return out, rows.Err()
}

type taskInput struct {
	Title         string   `json:"title" binding:"required,min=2,max=160"`
	Prompt        string   `json:"prompt" binding:"required,min=5,max=1200"`
	Instructions  []string `json:"instructions" binding:"omitempty,max=8,dive,max=300"`
	MinWords      int      `json:"min_words" binding:"omitempty,min=0,max=1000"`
	TargetSeconds int      `json:"target_seconds" binding:"omitempty,min=0,max=600"`
	Minutes       int      `json:"minutes" binding:"omitempty,min=1,max=120"`
	Focus         string   `json:"focus" binding:"omitempty,max=300"`
}

// PUT /admin/grammar/topics/:slug/levels/:level/tasks/:kind — save an owner's edit as the
// level's draft task. Learners get it when the topic is published.
func (m *Module) saveGrammarTask(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	kind := c.Param("kind")
	if kind != TaskWriting && kind != TaskSpeaking {
		httpx.Fail(c, apperr.NotFound("Task kind"))
		return
	}
	level, err := cefr.Parse(strings.ToUpper(c.Param("level")))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid CEFR level"))
		return
	}
	var in taskInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	ctx := c.Request.Context()
	var topicID uuid.UUID
	if err := m.pool.QueryRow(ctx, `SELECT id FROM grammar_topics WHERE slug = $1`, c.Param("slug")).Scan(&topicID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Fail(c, apperr.NotFound("Grammar topic"))
			return
		}
		httpx.Fail(c, err)
		return
	}
	instructions := make([]string, 0, len(in.Instructions))
	for _, s := range in.Instructions {
		if s = strings.TrimSpace(s); s != "" {
			instructions = append(instructions, s)
		}
	}
	task := PracticeTask{
		Kind: kind, Level: level.BaseCode(), Title: strings.TrimSpace(in.Title), Prompt: strings.TrimSpace(in.Prompt),
		Instructions: instructions, MinWords: in.MinWords, TargetSeconds: in.TargetSeconds,
		Minutes: max(in.Minutes, 1), Focus: strings.TrimSpace(in.Focus),
	}
	if err := m.storeTasks(ctx, topicID, p.UserID, "curated", []PracticeTask{task}); err != nil {
		httpx.Fail(c, err)
		return
	}
	tasks, err := m.tasksByLevel(ctx, topicID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	for _, t := range tasks[level.BaseCode()] {
		if t.Kind == kind {
			recordGrammarAudit(ctx, m.audit, p.UserID, ActionGrammarContentSaved, c.Param("slug"),
				map[string]any{"level": level.BaseCode(), "section": kind})
			httpx.OK(c, t)
			return
		}
	}
	httpx.Fail(c, fmt.Errorf("saved task not found"))
}

// publishLevelExtras puts a level's draft test and draft tasks live, replacing what was live.
// They are published with the topic but do not need a new explanation to go with them: a
// test or a task regenerated on its own is publishable on its own. It reports whether
// anything changed.
func publishLevelExtras(ctx context.Context, tx pgx.Tx, topicID uuid.UUID, code string) (bool, error) {
	changed := false
	// A level with a new test replaces its old one, the way new text replaces old text.
	// Archived, not deleted: past attempts still point at them.
	if _, err := tx.Exec(ctx, `
		UPDATE grammar_questions SET status = 'archived'
		WHERE grammar_topic_id = $1 AND status = 'published'
		  AND level_id = (SELECT id FROM levels WHERE code = $2)
		  AND EXISTS (SELECT 1 FROM grammar_questions d
		              WHERE d.grammar_topic_id = $1 AND d.status = 'draft'
		                AND d.level_id = (SELECT id FROM levels WHERE code = $2))`, topicID, code); err != nil {
		return false, err
	}
	tag, err := tx.Exec(ctx, `
		UPDATE grammar_questions SET status = 'published'
		WHERE grammar_topic_id = $1 AND status = 'draft'
		  AND level_id = (SELECT id FROM levels WHERE code = $2)`, topicID, code)
	if err != nil {
		return false, err
	}
	changed = changed || tag.RowsAffected() > 0

	if _, err := tx.Exec(ctx, `
		UPDATE grammar_practice_tasks t SET status = 'archived'
		WHERE t.grammar_topic_id = $1 AND t.level_code = $2::cefr_code AND t.status = 'published'
		  AND EXISTS (SELECT 1 FROM grammar_practice_tasks d
		              WHERE d.grammar_topic_id = t.grammar_topic_id AND d.kind = t.kind
		                AND d.level_code = t.level_code AND d.status = 'draft')`, topicID, code); err != nil {
		return false, err
	}
	tag, err = tx.Exec(ctx, `
		UPDATE grammar_practice_tasks SET status = 'published', published_at = now()
		WHERE grammar_topic_id = $1 AND level_code = $2::cefr_code AND status = 'draft'`, topicID, code)
	if err != nil {
		return false, err
	}
	changed = changed || tag.RowsAffected() > 0
	return changed, nil
}
