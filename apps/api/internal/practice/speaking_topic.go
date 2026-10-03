package practice

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Speaking set for a grammar topic.
//
// The speaking twin of writing_topic.go: the grammar page's "Speaking" card sends the learner
// here with the topic they have studied, and they are given something to talk about that
// needs it — the task the topic was published with, at their level, or one written on the
// spot when the topic has none. The recording is then judged with the topic in view.

// TopicSpeakingTaskWriter writes a speaking task around one grammar topic. The writing task
// writer implements it too; one that does not serves the plain task.
type TopicSpeakingTaskWriter interface {
	WriteGrammarSpeakingTask(ctx context.Context, req ai.GrammarWritingTaskRequest) (*ai.GrammarSpeakingTask, error)
}

type speakingTaskCache struct {
	mu      sync.Mutex
	entries map[string]speakingTaskEntry
}

type speakingTaskEntry struct {
	task    ai.GrammarSpeakingTask
	expires time.Time
}

func (c *speakingTaskCache) get(key string) (ai.GrammarSpeakingTask, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok || time.Now().After(entry.expires) {
		return ai.GrammarSpeakingTask{}, false
	}
	return entry.task, true
}

func (c *speakingTaskCache) put(key string, task ai.GrammarSpeakingTask) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries == nil {
		c.entries = map[string]speakingTaskEntry{}
	}
	c.entries[key] = speakingTaskEntry{task: task, expires: time.Now().Add(topicTaskTTL)}
}

// TopicSpeakingTask is a speaking task set for a grammar topic. Like the writing one it has
// no id: the recording carries the topic and the prompt instead.
type TopicSpeakingTask struct {
	Topic struct {
		Slug string `json:"slug"`
		Name string `json:"name"`
	} `json:"topic"`
	Level         string   `json:"level"`
	Title         string   `json:"title"`
	Prompt        string   `json:"prompt"`
	Points        []string `json:"points"`
	TargetSeconds int      `json:"target_seconds"`
	Focus         string   `json:"focus"`
}

// GET /speaking/topic-task?topic=a-an
func (m *Module) topicSpeakingTask(c *gin.Context) {
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
	level := m.learnerLevel(ctx, p.UserID)

	var task ai.GrammarSpeakingTask
	published, found, err := m.publishedTopicTask(ctx, slug, "speaking", level)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if found {
		task = ai.GrammarSpeakingTask{
			Title: published.Title, Prompt: published.Prompt, Points: published.Instructions,
			TargetSeconds: published.TargetSeconds, Focus: published.Focus,
		}
		level = published.Level
	} else {
		key := slug + "|" + level.BaseCode()
		cached, ok := m.topicSpeaking.get(key)
		task = cached
		if !ok {
			task = ai.FallbackGrammarSpeakingTask(name, level)
			if writer, can := m.taskWriter.(TopicSpeakingTaskWriter); can && m.taskWriter != nil {
				written, err := writer.WriteGrammarSpeakingTask(ctx, ai.GrammarWritingTaskRequest{
					Topic: name, Slug: slug, Description: description, Level: level, UserID: p.UserID,
				})
				// A model that is down must not leave the learner without a task; only a
				// written one is cached, so the next visit tries again.
				if err == nil {
					task = *written
					m.topicSpeaking.put(key, task)
				}
			}
		}
	}

	out := TopicSpeakingTask{
		Level: level.BaseCode(), Title: task.Title, Prompt: task.Prompt, Points: task.Points,
		TargetSeconds: task.TargetSeconds, Focus: task.Focus,
	}
	if out.Points == nil {
		out.Points = []string{}
	}
	out.Topic.Slug, out.Topic.Name = slug, name
	httpx.OK(c, out)
}

// learnerLevel is the learner's current level, B1 when they have none yet.
func (m *Module) learnerLevel(ctx context.Context, userID uuid.UUID) cefr.Level {
	level := cefr.MustParse("B1")
	var code *string
	_ = m.pool.QueryRow(ctx, `
		SELECT l.code FROM profiles pr JOIN levels l ON l.id = pr.current_level_id WHERE pr.user_id = $1`,
		userID).Scan(&code)
	if code != nil {
		if parsed, err := cefr.Parse(*code); err == nil {
			level = parsed
		}
	}
	return level
}
