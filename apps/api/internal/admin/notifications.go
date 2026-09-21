package admin

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/notifications"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Notification templates: the words the platform says to learners.
//
// Editing them needs the settings permission rather than the content permission. Lesson
// content reaches the learners who open it; this reaches every learner's inbox, and the
// blast radius of a mistake is different enough to deserve a different key.

const ActionTemplateUpdated = "notification_template.updated"

type TemplateRow struct {
	Code        string   `json:"code"`
	Locale      string   `json:"locale"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	InApp       bool     `json:"in_app"`
	Email       bool     `json:"email"`
	Subject     string   `json:"subject"`
	Body        string   `json:"body"`
	Variables   []string `json:"variables"`
	IsActive    bool     `json:"is_active"`
	/** Placeholders in the text that `variables` does not declare — a typo the editor shows. */
	Missing   []string  `json:"missing_variables"`
	Sent30d   int64     `json:"sent_30d"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (m *Module) notificationTemplates(c *gin.Context) {
	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT t.code, t.locale, t.name, t.description, t.in_app, t.email, t.subject, t.body,
		       t.variables, t.is_active, t.updated_at,
		       (SELECT count(*) FROM notifications n
		        WHERE n.template_code = t.code AND n.created_at >= now() - interval '30 days')
		FROM notification_templates t
		ORDER BY t.code, t.locale`)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []TemplateRow{}
	for rows.Next() {
		var t TemplateRow
		if err := rows.Scan(&t.Code, &t.Locale, &t.Name, &t.Description, &t.InApp, &t.Email,
			&t.Subject, &t.Body, &t.Variables, &t.IsActive, &t.UpdatedAt, &t.Sent30d); err != nil {
			httpx.Fail(c, err)
			return
		}
		t.Missing = notifications.MissingVariables(t.Subject+" "+t.Body, t.Variables)
		list = append(list, t)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, list)
}

type TemplateInput struct {
	Name        *string `json:"name" binding:"omitempty,min=2,max=80"`
	Description *string `json:"description" binding:"omitempty,max=300"`
	Subject     *string `json:"subject" binding:"omitempty,min=2,max=200"`
	Body        *string `json:"body" binding:"omitempty,min=2,max=4000"`
	InApp       *bool   `json:"in_app"`
	Email       *bool   `json:"email"`
	IsActive    *bool   `json:"is_active"`
}

// updateNotificationTemplate edits one locale of one template.
//
// A template with no channel left on is refused rather than silently saved: switching both
// off looks like "this is disabled" but reads, to every future maintainer, like a bug.
// Disabling is what is_active is for, and it says so.
func (m *Module) updateNotificationTemplate(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	code, locale := c.Param("code"), c.Param("locale")
	var in TemplateInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	ctx := c.Request.Context()

	var current TemplateRow
	if err := m.pool.QueryRow(ctx, `
		SELECT in_app, email FROM notification_templates WHERE code = $1 AND locale = $2`, code, locale).
		Scan(&current.InApp, &current.Email); err != nil {
		if err == pgx.ErrNoRows {
			httpx.Fail(c, apperr.NotFound("Template"))
			return
		}
		httpx.Fail(c, err)
		return
	}
	inApp, email := current.InApp, current.Email
	if in.InApp != nil {
		inApp = *in.InApp
	}
	if in.Email != nil {
		email = *in.Email
	}
	if !inApp && !email {
		httpx.Fail(c, apperr.Validation(map[string]any{"fields": map[string]any{
			"in_app": "a template needs at least one channel; use is_active to switch it off entirely",
		}}))
		return
	}

	if _, err := m.pool.Exec(ctx, `
		UPDATE notification_templates SET
			name        = coalesce($3, name),
			description = coalesce($4, description),
			subject     = coalesce($5, subject),
			body        = coalesce($6, body),
			in_app      = $7,
			email       = $8,
			is_active   = coalesce($9, is_active),
			updated_by  = $10
		WHERE code = $1 AND locale = $2`,
		code, locale, in.Name, in.Description, in.Subject, in.Body, inApp, email, in.IsActive, p.UserID); err != nil {
		httpx.Fail(c, err)
		return
	}

	m.audit.Record(ctx, audit.Entry{
		ActorID: &p.UserID, Action: ActionTemplateUpdated, EntityType: "notification_template",
		EntityID: code + ":" + locale,
		Metadata: map[string]any{"code": code, "locale": locale, "in_app": inApp, "email": email},
		IP:       c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})
	m.notificationTemplates(c)
}

type previewInput struct {
	Subject   *string        `json:"subject" binding:"omitempty,max=200"`
	Body      *string        `json:"body" binding:"omitempty,max=4000"`
	Variables map[string]any `json:"variables"`
}

// previewNotificationTemplate renders a template with sample values, optionally against
// unsaved text, so an editor can see the result before a learner does.
func (m *Module) previewNotificationTemplate(c *gin.Context) {
	code, locale := c.Param("code"), c.Param("locale")
	var in previewInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}

	var subject, body string
	var declared []string
	if err := m.pool.QueryRow(c.Request.Context(), `
		SELECT subject, body, variables FROM notification_templates WHERE code = $1 AND locale = $2`,
		code, locale).Scan(&subject, &body, &declared); err != nil {
		if err == pgx.ErrNoRows {
			httpx.Fail(c, apperr.NotFound("Template"))
			return
		}
		httpx.Fail(c, err)
		return
	}
	if in.Subject != nil {
		subject = *in.Subject
	}
	if in.Body != nil {
		body = *in.Body
	}

	// Sample values so a preview is readable even when the caller sends none.
	vars := map[string]any{}
	for _, v := range declared {
		vars[v] = "{" + v + "}"
	}
	for k, v := range in.Variables {
		vars[k] = v
	}
	httpx.OK(c, gin.H{
		"subject":           notifications.Render(subject, vars),
		"body":              notifications.Render(body, vars),
		"missing_variables": notifications.MissingVariables(subject+" "+body, declared),
	})
}

type SentNotification struct {
	ID           uuid.UUID  `json:"id"`
	LearnerID    uuid.UUID  `json:"learner_id"`
	LearnerEmail string     `json:"learner_email"`
	TemplateCode *string    `json:"template_code"`
	Channel      string     `json:"channel"`
	Title        string     `json:"title"`
	SentAt       *time.Time `json:"sent_at"`
	ReadAt       *time.Time `json:"read_at"`
	CreatedAt    time.Time  `json:"created_at"`
}

// sentNotifications is the delivery log. It answers the only two questions anyone asks
// about notifications in production: did it go out, and did anybody read it.
func (m *Module) sentNotifications(c *gin.Context) {
	var page httpx.Pagination
	if err := httpx.BindQuery(c, &page); err != nil {
		httpx.Fail(c, err)
		return
	}
	page = page.Normalize()

	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT n.id, n.user_id, u.email, n.template_code, n.channel, n.title, n.sent_at, n.read_at,
		       n.created_at, count(*) OVER ()
		FROM notifications n JOIN users u ON u.id = n.user_id
		WHERE ($1 = '' OR n.template_code = $1)
		ORDER BY n.created_at DESC LIMIT $2 OFFSET $3`,
		c.Query("code"), page.PageSize, page.Offset())
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []SentNotification{}
	var total int64
	for rows.Next() {
		var n SentNotification
		if err := rows.Scan(&n.ID, &n.LearnerID, &n.LearnerEmail, &n.TemplateCode, &n.Channel,
			&n.Title, &n.SentAt, &n.ReadAt, &n.CreatedAt, &total); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, n)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OKWithMeta(c, list, httpx.Meta{Page: page.Page, PageSize: page.PageSize, Total: total})
}
