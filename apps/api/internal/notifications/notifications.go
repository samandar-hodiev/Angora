// Package notifications delivers messages to learners and owns the templates they are
// written from.
//
// Three decisions shape it.
//
//   - The words live in the database, not in Go. Copy that reaches a learner is product
//     work: fixing a clumsy sentence should not need a deploy, and translating one should
//     not need a developer.
//   - A template decides which channels are appropriate; a learner decides which of those
//     they actually want. A preference can switch a channel off, never on, so nobody can
//     opt themselves into an email the product never intended to send.
//   - Delivery is best effort and never fails the thing that caused it. A payment that
//     succeeded is not undone because a mail server was down.
package notifications

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/mail"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

// Template codes. Application code refers to these; the text behind them is editable.
const (
	CodeWelcome              = "welcome"
	CodePaymentSucceeded     = "payment_succeeded"
	CodeSubscriptionExpiring = "subscription_expiring"
	CodeLevelChanged         = "level_changed"
	CodeStreakReminder       = "streak_reminder"
	CodeAssessmentCompleted  = "assessment_completed"
)

// DefaultLocale is used when the learner has not said what they speak, and when a
// template has no row for the language they did say.
const DefaultLocale = "en"

var locales = map[string]bool{"en": true, "uz": true, "ru": true}

type Service struct {
	pool   *pgxpool.Pool
	mailer mail.Mailer
	log    *slog.Logger
}

func NewService(pool *pgxpool.Pool, mailer mail.Mailer, log *slog.Logger) *Service {
	if mailer == nil {
		mailer = mail.Nop{}
	}
	return &Service{pool: pool, mailer: mailer, log: log}
}

type Template struct {
	Code        string    `json:"code"`
	Locale      string    `json:"locale"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	InApp       bool      `json:"in_app"`
	Email       bool      `json:"email"`
	Subject     string    `json:"subject"`
	Body        string    `json:"body"`
	Variables   []string  `json:"variables"`
	IsActive    bool      `json:"is_active"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Render substitutes {{name}} placeholders. A placeholder with no value is left visible
// rather than blanked: "Welcome, {{name}}" in a preview is a bug someone can see and fix,
// while "Welcome, " is one they will not notice until a learner reads it.
func Render(text string, vars map[string]any) string {
	if len(vars) == 0 {
		return text
	}
	pairs := make([]string, 0, len(vars)*2)
	for k, v := range vars {
		pairs = append(pairs, "{{"+k+"}}", fmt.Sprint(v))
	}
	return strings.NewReplacer(pairs...).Replace(text)
}

// MissingVariables lists placeholders in the text that the declared variables cannot fill.
// The template editor calls it so a typo is caught before a learner reads it.
func MissingVariables(text string, vars []string) []string {
	known := map[string]bool{}
	for _, v := range vars {
		known[v] = true
	}
	missing := []string{}
	seen := map[string]bool{}
	rest := text
	for {
		open := strings.Index(rest, "{{")
		if open < 0 {
			return missing
		}
		rest = rest[open+2:]
		end := strings.Index(rest, "}}")
		if end < 0 {
			return missing
		}
		name := strings.TrimSpace(rest[:end])
		if name != "" && !known[name] && !seen[name] {
			seen[name] = true
			missing = append(missing, name)
		}
		rest = rest[end+2:]
	}
}

// recipient is everything delivery needs about one learner, read in a single query.
type recipient struct {
	Email  string
	Locale string
	InApp  bool
	Mail   bool
	Muted  []string
}

func (s *Service) recipient(ctx context.Context, userID uuid.UUID) (recipient, error) {
	var r recipient
	var language *string
	err := s.pool.QueryRow(ctx, `
		SELECT u.email,
		       p.native_language,
		       coalesce(np.in_app, true),
		       coalesce(np.email, true),
		       coalesce(np.muted, '{}')
		FROM users u
		LEFT JOIN profiles p ON p.user_id = u.id
		LEFT JOIN notification_preferences np ON np.user_id = u.id
		WHERE u.id = $1 AND u.status = 'active'`, userID).
		Scan(&r.Email, &language, &r.InApp, &r.Mail, &r.Muted)
	if err != nil {
		return r, err
	}
	r.Locale = DefaultLocale
	if language != nil && locales[strings.ToLower(*language)] {
		r.Locale = strings.ToLower(*language)
	}
	return r, nil
}

// template reads the learner's language, falling back to English so a missing translation
// means "in the wrong language" rather than "never delivered".
func (s *Service) template(ctx context.Context, code, locale string) (Template, error) {
	var t Template
	err := s.pool.QueryRow(ctx, `
		SELECT code, locale, name, description, in_app, email, subject, body, variables, is_active, updated_at
		FROM notification_templates
		WHERE code = $1 AND locale IN ($2, $3) AND is_active
		ORDER BY (locale = $2) DESC LIMIT 1`, code, locale, DefaultLocale).
		Scan(&t.Code, &t.Locale, &t.Name, &t.Description, &t.InApp, &t.Email, &t.Subject, &t.Body,
			&t.Variables, &t.IsActive, &t.UpdatedAt)
	return t, err
}

// Notify delivers one template to one learner. It returns an error only for problems worth
// investigating; a muted notification or a learner who opted out is a normal outcome.
func (s *Service) Notify(ctx context.Context, userID uuid.UUID, code string, vars map[string]any) error {
	log := logger.FromContext(ctx, s.log)

	rcpt, err := s.recipient(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // deleted or suspended account
		}
		return err
	}
	for _, muted := range rcpt.Muted {
		if muted == code {
			return nil
		}
	}

	tpl, err := s.template(ctx, code, rcpt.Locale)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			log.Warn("notification template missing or inactive", slog.String("code", code))
			return nil
		}
		return err
	}

	subject := Render(tpl.Subject, vars)
	body := Render(tpl.Body, vars)

	if tpl.InApp && rcpt.InApp {
		if _, err := s.pool.Exec(ctx, `
			INSERT INTO notifications (user_id, type, channel, title, body, data, template_code, sent_at)
			VALUES ($1, $2, 'in_app', $3, $4, $5, $2, now())`,
			userID, code, subject, body, vars); err != nil {
			return err
		}
	}

	if tpl.Email && rcpt.Mail {
		var id uuid.UUID
		if err := s.pool.QueryRow(ctx, `
			INSERT INTO notifications (user_id, type, channel, title, body, data, template_code)
			VALUES ($1, $2, 'email', $3, $4, $5, $2) RETURNING id`,
			userID, code, subject, body, vars).Scan(&id); err != nil {
			return err
		}
		// The row is written before the send, so a message that leaves the building is
		// never invisible; sent_at then records whether it actually did.
		if err := s.mailer.Send(ctx, mail.Message{To: rcpt.Email, Subject: subject, Text: body}); err != nil {
			log.Warn("notification email not sent",
				slog.String("code", code), slog.String("error", err.Error()))
			return nil
		}
		if _, err := s.pool.Exec(ctx, `UPDATE notifications SET sent_at = now() WHERE id = $1`, id); err != nil {
			return err
		}
	}
	return nil
}

// ---- learner API ---------------------------------------------------------------------------

type Module struct{ svc *Service }

func NewModule(svc *Service) *Module { return &Module{svc: svc} }

func (m *Module) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/notifications", authz.RequireAuthenticated())
	g.GET("", m.list)
	g.GET("/preferences", m.preferences)
	g.PUT("/preferences", m.updatePreferences)
	g.POST("/read-all", m.readAll)
	g.POST("/:id/read", m.read)
}

type Notification struct {
	ID        uuid.UUID      `json:"id"`
	Type      string         `json:"type"`
	Channel   string         `json:"channel"`
	Title     string         `json:"title"`
	Body      string         `json:"body"`
	Data      map[string]any `json:"data"`
	ReadAt    *time.Time     `json:"read_at"`
	CreatedAt time.Time      `json:"created_at"`
}

type Preferences struct {
	InApp bool     `json:"in_app"`
	Email bool     `json:"email"`
	Muted []string `json:"muted"`
}

func (m *Module) list(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	unreadOnly := c.Query("unread") == "true"

	rows, err := m.svc.pool.Query(c.Request.Context(), `
		SELECT id, type, channel, title, body, data, read_at, created_at
		FROM notifications
		WHERE user_id = $1 AND channel = 'in_app' AND ($2::boolean IS NOT TRUE OR read_at IS NULL)
		ORDER BY created_at DESC LIMIT 50`, p.UserID, unreadOnly)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []Notification{}
	for rows.Next() {
		var n Notification
		if err := rows.Scan(&n.ID, &n.Type, &n.Channel, &n.Title, &n.Body, &n.Data, &n.ReadAt, &n.CreatedAt); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, n)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}

	var unread int64
	_ = m.svc.pool.QueryRow(c.Request.Context(), `
		SELECT count(*) FROM notifications
		WHERE user_id = $1 AND channel = 'in_app' AND read_at IS NULL`, p.UserID).Scan(&unread)
	httpx.OKWithMeta(c, list, httpx.Meta{Total: unread})
}

func (m *Module) read(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid notification id"))
		return
	}
	tag, err := m.svc.pool.Exec(c.Request.Context(), `
		UPDATE notifications SET read_at = coalesce(read_at, now())
		WHERE id = $1 AND user_id = $2`, id, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Fail(c, apperr.NotFound("Notification"))
		return
	}
	httpx.NoContent(c)
}

func (m *Module) readAll(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if _, err := m.svc.pool.Exec(c.Request.Context(), `
		UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, p.UserID); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.NoContent(c)
}

func (m *Module) preferences(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	prefs := Preferences{InApp: true, Email: true, Muted: []string{}}
	err = m.svc.pool.QueryRow(c.Request.Context(),
		`SELECT in_app, email, muted FROM notification_preferences WHERE user_id = $1`, p.UserID).
		Scan(&prefs.InApp, &prefs.Email, &prefs.Muted)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, err)
		return
	}
	if prefs.Muted == nil {
		prefs.Muted = []string{}
	}
	httpx.OK(c, prefs)
}

type preferencesInput struct {
	InApp *bool    `json:"in_app"`
	Email *bool    `json:"email"`
	Muted []string `json:"muted" binding:"omitempty,max=32,dive,max=64"`
}

func (m *Module) updatePreferences(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var in preferencesInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	if _, err := m.svc.pool.Exec(c.Request.Context(), `
		INSERT INTO notification_preferences (user_id, in_app, email, muted)
		VALUES ($1, coalesce($2, true), coalesce($3, true), coalesce($4, '{}'))
		ON CONFLICT (user_id) DO UPDATE SET
			in_app = coalesce($2, notification_preferences.in_app),
			email  = coalesce($3, notification_preferences.email),
			muted  = coalesce($4, notification_preferences.muted)`,
		p.UserID, in.InApp, in.Email, in.Muted); err != nil {
		httpx.Fail(c, err)
		return
	}
	m.preferences(c)
}
