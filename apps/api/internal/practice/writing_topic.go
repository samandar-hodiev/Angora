package practice

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Writing set for a grammar topic.
//
// The grammar page's "Writing" card sends the learner here with the topic they have just
// studied. They should be asked to write something that needs that grammar, at their level —
// so the task is written for the topic rather than picked from the library, and the check
// that follows is told what it is practising.

// TopicTaskWriter writes a writing task around one grammar topic.
type TopicTaskWriter interface {
	WriteGrammarTask(ctx context.Context, req ai.GrammarWritingTaskRequest) (*ai.GrammarWritingTask, error)
}

// topicTaskTTL is how long a written task is reused for the same topic and level. Long enough
// that opening the page twice does not pay for two tasks; short enough that coming back
// tomorrow brings a different one.
const topicTaskTTL = 6 * time.Hour

type topicTaskCache struct {
	mu      sync.Mutex
	entries map[string]topicTaskEntry
}

type topicTaskEntry struct {
	task    ai.GrammarWritingTask
	expires time.Time
}

func (c *topicTaskCache) get(key string) (ai.GrammarWritingTask, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok || time.Now().After(entry.expires) {
		return ai.GrammarWritingTask{}, false
	}
	return entry.task, true
}

func (c *topicTaskCache) put(key string, task ai.GrammarWritingTask) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries == nil {
		c.entries = map[string]topicTaskEntry{}
	}
	c.entries[key] = topicTaskEntry{task: task, expires: time.Now().Add(topicTaskTTL)}
}

// TopicWritingTask is a task written for a grammar topic. It has no id: it is not library
// content, and the submission carries the topic and the prompt instead.
type TopicWritingTask struct {
	Topic struct {
		Slug string `json:"slug"`
		Name string `json:"name"`
	} `json:"topic"`
	Level              string   `json:"level"`
	Title              string   `json:"title"`
	Prompt             string   `json:"prompt"`
	Instructions       []string `json:"instructions"`
	MinWords           int      `json:"min_words"`
	RecommendedMinutes int      `json:"recommended_minutes"`
	Focus              string   `json:"focus"`
}

// GET /writing/topic-task?topic=a-an
func (m *Module) topicWritingTask(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	slug := strings.TrimSpace(c.Query("topic"))
	if slug == "" {
		httpx.Fail(c, apperr.Validation(map[string]any{"fields": map[string]any{"topic": "is required"}}))
		return
	}
	ctx := c.Request.Context()

	var name, description string
	err = m.pool.QueryRow(ctx, `
		SELECT name, description FROM grammar_topics WHERE slug = $1 AND status = 'published'`, slug).
		Scan(&name, &description)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.NotFound("Grammar topic"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	level := cefr.MustParse("B1")
	var code *string
	_ = m.pool.QueryRow(ctx, `
		SELECT l.code FROM profiles pr JOIN levels l ON l.id = pr.current_level_id WHERE pr.user_id = $1`,
		p.UserID).Scan(&code)
	if code != nil {
		if parsed, err := cefr.Parse(*code); err == nil {
			level = parsed
		}
	}

	// The task the topic was published with comes first: an owner has read it. Only a topic
	// published without one falls back to a task written on the spot.
	key := slug + "|" + level.BaseCode()
	task, ok := ai.GrammarWritingTask{}, false
	if published, found, err := m.publishedTopicTask(ctx, slug, "writing", level); err != nil {
		httpx.Fail(c, err)
		return
	} else if found {
		task, ok = ai.GrammarWritingTask{
			Title: published.Title, Prompt: published.Prompt, Instructions: published.Instructions,
			MinWords: published.MinWords, Minutes: published.Minutes, Focus: published.Focus,
		}, true
		level = published.Level
	}
	if !ok {
		task, ok = m.topicTasks.get(key)
	}
	if !ok {
		task = ai.FallbackGrammarTask(name, level)
		if m.taskWriter != nil {
			written, err := m.taskWriter.WriteGrammarTask(ctx, ai.GrammarWritingTaskRequest{
				Topic: name, Slug: slug, Description: description, Level: level, UserID: p.UserID,
			})
			// A model that is down must not leave the learner without a task: the plain one
			// is still about the topic. Only a written task is cached, so the next visit tries
			// the model again.
			if err == nil {
				task = *written
				m.topicTasks.put(key, task)
			}
		}
	}

	out := TopicWritingTask{
		Level: level.BaseCode(), Title: task.Title, Prompt: task.Prompt, Instructions: task.Instructions,
		MinWords: task.MinWords, RecommendedMinutes: task.Minutes, Focus: task.Focus,
	}
	if out.Instructions == nil {
		out.Instructions = []string{}
	}
	out.Topic.Slug, out.Topic.Name = slug, name
	httpx.OK(c, out)
}

// topicTask is a task a grammar topic was published with.
type topicTask struct {
	Level         cefr.Level
	Title         string
	Prompt        string
	Instructions  []string
	MinWords      int
	TargetSeconds int
	Minutes       int
	Focus         string
}

// publishedTopicTask is the topic's live task of one kind, for the learner's level — or, when
// that level has none, the nearest level that does, the lower one first.
func (m *Module) publishedTopicTask(ctx context.Context, slug, kind string, level cefr.Level) (topicTask, bool, error) {
	var (
		t            topicTask
		code         string
		instructions []byte
	)
	err := m.pool.QueryRow(ctx, `
		SELECT t.level_code::text, t.title, t.prompt, t.instructions, t.min_words, t.target_seconds, t.minutes, t.focus
		FROM grammar_practice_tasks t
		JOIN grammar_topics g ON g.id = t.grammar_topic_id
		JOIN levels l ON l.code = t.level_code::text
		WHERE g.slug = $1 AND g.status = 'published' AND t.kind = $2 AND t.status = 'published'
		ORDER BY abs(l.rank - COALESCE((SELECT rank FROM levels WHERE code = $3), l.rank)), l.rank
		LIMIT 1`, slug, kind, level.BaseCode()).
		Scan(&code, &t.Title, &t.Prompt, &instructions, &t.MinWords, &t.TargetSeconds, &t.Minutes, &t.Focus)
	if errors.Is(err, pgx.ErrNoRows) {
		return t, false, nil
	}
	if err != nil {
		return t, false, err
	}
	_ = json.Unmarshal(instructions, &t.Instructions)
	if t.Level, err = cefr.Parse(code); err != nil {
		t.Level = level
	}
	return t, true, nil
}
