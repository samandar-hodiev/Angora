// Package coach is the AI coach: an open conversation about whatever the learner is working
// on, in context of what the platform knows about them.
//
// It is the only AI surface in the product that is a conversation rather than a one-shot
// evaluation, which is why it keeps a thread. Everything else about it is the same as the
// rest: the plan decides access, the budget is charged before the provider is called and
// refunded when the call fails, and the gateway records the cost.
package coach

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

const (
	entitlementChat     = "ai_coach.chat"
	entitlementMessages = "ai_coach.messages"

	// The thread sent to the model. A coach conversation that needs more than this has
	// drifted from coaching into chatting, and an unbounded history is an unbounded bill.
	historyLimit = 12

	promptVersion = "coach.v1"
)

// Generator is the slice of the AI layer this package needs.
type Generator interface {
	GenerateText(ctx context.Context, meta ai.CallMeta, req ai.TextRequest) (*ai.TextResponse, error)
}

// Entitlements decides access and meters use.
type Entitlements interface {
	RequireFeature(ctx context.Context, userID uuid.UUID, key string) error
	ConsumeUsage(ctx context.Context, userID uuid.UUID, key string, amount int) error
	ReleaseUsage(ctx context.Context, userID uuid.UUID, key string, amount int) error
}

type Module struct {
	pool  *pgxpool.Pool
	ai    Generator
	plans Entitlements
}

type Deps struct {
	Pool  *pgxpool.Pool
	AI    Generator
	Plans Entitlements
}

func NewModule(d Deps) *Module { return &Module{pool: d.Pool, ai: d.AI, plans: d.Plans} }

func (m *Module) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/coach", authz.RequirePermission(authz.PermLearningPractice))
	g.GET("/conversations", m.conversations)
	g.GET("/conversations/:id", m.conversation)
	g.POST("/messages", m.send)
}

type Message struct {
	ID        uuid.UUID `json:"id"`
	Role      string    `json:"role"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}

type Conversation struct {
	ID        uuid.UUID `json:"id"`
	Title     string    `json:"title"`
	Status    string    `json:"status"`
	Messages  []Message `json:"messages,omitempty"`
	UpdatedAt time.Time `json:"updated_at"`
	CreatedAt time.Time `json:"created_at"`
}

func (m *Module) conversations(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT id, title, status, updated_at, created_at
		FROM coach_conversations
		WHERE user_id = $1 AND status = 'active'
		ORDER BY updated_at DESC LIMIT 30`, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []Conversation{}
	for rows.Next() {
		var conv Conversation
		if err := rows.Scan(&conv.ID, &conv.Title, &conv.Status, &conv.UpdatedAt, &conv.CreatedAt); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, conv)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, list)
}

func (m *Module) conversation(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid conversation id"))
		return
	}
	conv, err := m.load(c.Request.Context(), p.UserID, id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, conv)
}

func (m *Module) load(ctx context.Context, userID, id uuid.UUID) (Conversation, error) {
	var conv Conversation
	err := m.pool.QueryRow(ctx, `
		SELECT id, title, status, updated_at, created_at
		FROM coach_conversations WHERE id = $1 AND user_id = $2`, id, userID).
		Scan(&conv.ID, &conv.Title, &conv.Status, &conv.UpdatedAt, &conv.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return conv, apperr.NotFound("Conversation")
	}
	if err != nil {
		return conv, err
	}

	rows, err := m.pool.Query(ctx, `
		SELECT id, role, content, created_at FROM coach_messages
		WHERE conversation_id = $1 ORDER BY created_at`, id)
	if err != nil {
		return conv, err
	}
	defer rows.Close()
	conv.Messages = []Message{}
	for rows.Next() {
		var msg Message
		if err := rows.Scan(&msg.ID, &msg.Role, &msg.Content, &msg.CreatedAt); err != nil {
			return conv, err
		}
		conv.Messages = append(conv.Messages, msg)
	}
	return conv, rows.Err()
}

type sendInput struct {
	/** Absent starts a new conversation. */
	ConversationID *uuid.UUID `json:"conversation_id"`
	Message        string     `json:"message" binding:"required,min=2,max=2000"`
}

// send adds the learner's message, asks the coach, and stores the reply.
//
// The learner's message is saved before the provider is called: if the call fails they should
// not have to retype it, and the conversation should show what they asked.
func (m *Module) send(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var in sendInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	ctx := c.Request.Context()

	if m.ai == nil {
		httpx.Fail(c, apperr.NotImplemented("The AI coach"))
		return
	}
	if m.plans != nil {
		if err := m.plans.RequireFeature(ctx, p.UserID, entitlementChat); err != nil {
			httpx.Fail(c, err)
			return
		}
	}

	conversationID := uuid.Nil
	if in.ConversationID != nil {
		conv, err := m.load(ctx, p.UserID, *in.ConversationID)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		conversationID = conv.ID
	} else {
		// The first question becomes the title: a thread list of "New conversation" is
		// useless for finding anything again.
		title := in.Message
		if len(title) > 60 {
			title = strings.TrimSpace(title[:60]) + "…"
		}
		if err := m.pool.QueryRow(ctx, `
			INSERT INTO coach_conversations (user_id, title) VALUES ($1, $2) RETURNING id`,
			p.UserID, title).Scan(&conversationID); err != nil {
			httpx.Fail(c, err)
			return
		}
	}

	if _, err := m.pool.Exec(ctx, `
		INSERT INTO coach_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
		conversationID, in.Message); err != nil {
		httpx.Fail(c, err)
		return
	}

	if m.plans != nil {
		if err := m.plans.ConsumeUsage(ctx, p.UserID, entitlementMessages, 1); err != nil {
			httpx.Fail(c, err)
			return
		}
	}

	history, err := m.history(ctx, conversationID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	reply, err := m.ai.GenerateText(ctx,
		ai.CallMeta{Task: ai.TaskCoachChat, UserID: &p.UserID, PromptVersion: promptVersion},
		ai.TextRequest{System: systemPrompt(m.learnerLevel(ctx, p.UserID)), Messages: history, MaxOutputTokens: 700})
	if err != nil || reply == nil {
		if m.plans != nil {
			_ = m.plans.ReleaseUsage(ctx, p.UserID, entitlementMessages, 1)
		}
		httpx.Fail(c, apperr.New(apperr.CodeUnavailable, "The coach is unavailable right now. Your message was saved."))
		return
	}

	if _, err := m.pool.Exec(ctx, `
		INSERT INTO coach_messages (conversation_id, role, content, ai_request_id)
		VALUES ($1, 'assistant', $2, $3)`,
		conversationID, reply.Text, nullUUID(reply.AIRequestID)); err != nil {
		httpx.Fail(c, err)
		return
	}
	// Touch the conversation so the list orders by real activity.
	if _, err := m.pool.Exec(ctx, `UPDATE coach_conversations SET updated_at = now() WHERE id = $1`, conversationID); err != nil {
		httpx.Fail(c, err)
		return
	}

	conv, err := m.load(ctx, p.UserID, conversationID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, conv)
}

func (m *Module) history(ctx context.Context, conversationID uuid.UUID) ([]ai.Message, error) {
	rows, err := m.pool.Query(ctx, `
		SELECT role, content FROM (
			SELECT role, content, created_at FROM coach_messages
			WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2
		) recent ORDER BY created_at`, conversationID, historyLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	messages := []ai.Message{}
	for rows.Next() {
		var msg ai.Message
		if err := rows.Scan(&msg.Role, &msg.Content); err != nil {
			return nil, err
		}
		messages = append(messages, msg)
	}
	return messages, rows.Err()
}

// learnerLevel is what the coach needs to pitch its answer; it is not personal data beyond
// what the learner already sees about themselves.
func (m *Module) learnerLevel(ctx context.Context, userID uuid.UUID) string {
	var level *string
	_ = m.pool.QueryRow(ctx, `
		SELECT l.code FROM profiles p JOIN levels l ON l.id = p.current_level_id WHERE p.user_id = $1`,
		userID).Scan(&level)
	if level == nil {
		return "B1"
	}
	return *level
}

func systemPrompt(level string) string {
	return "You are Engora's English coach. The learner is around CEFR " + level + ". " +
		"Answer in clear English at or just above their level, and keep grammar terminology in English. " +
		"Be brief: two or three short paragraphs at most, with an example sentence whenever you explain a rule. " +
		"If they ask something you cannot know about their account or their progress, say so plainly. " +
		"Never invent an exam score or claim an official result."
}

func nullUUID(id uuid.UUID) *uuid.UUID {
	if id == uuid.Nil {
		return nil
	}
	return &id
}
