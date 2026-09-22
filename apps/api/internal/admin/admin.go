// Package admin serves the owner/admin console: business overview, AI usage and cost,
// and content management listings. Every route requires an admin permission.
package admin

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

type PlanCount struct {
	PlanCode  string `json:"plan_code"`
	PlanName  string `json:"plan_name"`
	IsDefault bool   `json:"is_default"`
	Users     int64  `json:"users"`
}

type StatusCount struct {
	Status string `json:"status"`
	Count  int64  `json:"count"`
}

type Overview struct {
	Users struct {
		Total     int64 `json:"total"`
		Active30d int64 `json:"active_30d"`
		New7d     int64 `json:"new_7d"`
	} `json:"users"`
	Plans    []PlanCount `json:"plans"`
	MRRCents int64       `json:"mrr_cents"`
	Currency string      `json:"currency"`
	AI       struct {
		CostUSD30d  float64 `json:"cost_usd_30d"`
		Requests30d int64   `json:"requests_30d"`
		Failed30d   int64   `json:"failed_30d"`
	} `json:"ai"`
	Content []StatusCount `json:"content"`
}

type UsageRow struct {
	Key          string  `json:"key"`
	Provider     string  `json:"provider,omitempty"`
	Model        string  `json:"model,omitempty"`
	Requests     int64   `json:"requests"`
	Failed       int64   `json:"failed"`
	InputTokens  int64   `json:"input_tokens"`
	OutputTokens int64   `json:"output_tokens"`
	AudioSeconds float64 `json:"audio_seconds"`
	CostUSD      float64 `json:"cost_usd"`
	AvgLatencyMs float64 `json:"avg_latency_ms"`
}

type DailyCost struct {
	Date     time.Time `json:"date"`
	CostUSD  float64   `json:"cost_usd"`
	Requests int64     `json:"requests"`
}

type UsageReport struct {
	Days    int         `json:"days"`
	Totals  UsageRow    `json:"totals"`
	ByTask  []UsageRow  `json:"by_task"`
	ByModel []UsageRow  `json:"by_model"`
	Daily   []DailyCost `json:"daily"`
}

type ContentRow struct {
	ID          uuid.UUID  `json:"id"`
	Type        string     `json:"type"`
	Title       string     `json:"title"`
	Skill       *string    `json:"skill"`
	Level       *string    `json:"level"`
	Topic       *string    `json:"topic"`
	Exam        *string    `json:"exam"`
	Difficulty  int        `json:"difficulty"`
	Status      string     `json:"status"`
	PublishedAt *time.Time `json:"published_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type ContentFilter struct {
	httpx.Pagination
	Type   string `form:"type" binding:"omitempty,max=64"`
	Skill  string `form:"skill" binding:"omitempty,max=64"`
	Level  string `form:"level" binding:"omitempty,max=8"`
	Status string `form:"status" binding:"omitempty,oneof=draft review published archived"`
}

type Module struct {
	pool  *pgxpool.Pool
	audit audit.Recorder
	// author writes grammar content. Nil leaves the Generate action reporting that AI is
	// not configured, rather than pretending to have written something.
	author Author
	// refiner edits drafts that already exist: one section at a time, and translation.
	// Nil leaves those actions reporting that AI is not configured, like Generate.
	refiner Refiner
}

func NewModule(pool *pgxpool.Pool, recorder audit.Recorder) *Module {
	if recorder == nil {
		recorder = audit.Nop{}
	}
	return &Module{pool: pool, audit: recorder}
}

// WithAuthor attaches the AI content writer. The same service edits drafts, so a value that
// also implements Refiner is wired to both — one integration, not two.
func (m *Module) WithAuthor(author Author) *Module {
	m.author = author
	if refiner, ok := author.(Refiner); ok {
		m.refiner = refiner
	}
	return m
}

func (m *Module) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/admin")
	g.GET("/overview", authz.RequirePermission(authz.PermUsersRead), m.overview)
	g.GET("/ai-usage", authz.RequirePermission(authz.PermAIUsageRead), m.aiUsage)
	content := authz.RequirePermission(authz.PermContentManage)
	g.GET("/content", content, m.content)
	g.GET("/content/taxonomy", content, m.contentTaxonomy)
	g.GET("/content/:id", content, m.contentItem)
	g.POST("/content", content, m.createContent)
	g.PATCH("/content/:id", content, m.updateContent)
	g.POST("/content/:id/status", content, m.setContentStatus)
	// Revision history. Reading it needs only the content read permission — knowing what a
	// passage used to say is not a write.
	g.GET("/content/:id/versions", content, m.contentVersions)
	g.GET("/content/:id/versions/:version", content, m.contentVersion)
	g.POST("/content/:id/versions/:version/restore", content, m.restoreContentVersion)

	g.GET("/grammar/categories", content, m.grammarCategories)
	g.GET("/grammar/topics", content, m.grammarTopics)
	g.POST("/grammar/topics", content, m.createGrammarTopic)
	g.GET("/grammar/topics/:slug", content, m.grammarTopic)
	g.PATCH("/grammar/topics/:slug", content, m.updateGrammarTopic)
	g.POST("/grammar/topics/:slug/status", content, m.setGrammarStatus)

	// The Grammar Map and the content builder. Reading the curriculum needs only the
	// content read permission; writing to it — including asking a model to write — needs
	// the manage permission, because generated text is still text learners will be taught.
	g.GET("/grammar/map", content, m.grammarMap)
	g.GET("/grammar/topics/:slug/content", content, m.grammarTopicContent)
	g.GET("/grammar/topics/:slug/validate", content, m.validateGrammarContent)
	g.POST("/grammar/topics/:slug/generate", content, m.generateGrammarContent)
	g.PUT("/grammar/topics/:slug/levels/:level", content, m.saveGrammarLevel)
	g.POST("/grammar/topics/:slug/publish", content, m.publishGrammarContent)
	// Editing a draft that exists. Neither writes: both return a suggestion for review.
	g.POST("/grammar/topics/:slug/levels/:level/refine", content, m.refineGrammarLevel)
	g.POST("/grammar/topics/:slug/levels/:level/translate", content, m.translateGrammarLevel)

	// Question bank and assessment configuration. Reads and writes are separate
	// permissions so an analyst role can inspect the bank without being able to change
	// what learners are asked.
	read := authz.RequirePermission(authz.PermAssessmentsRead)
	manage := authz.RequirePermission(authz.PermAssessmentsManage)

	g.GET("/questions", read, m.questions)
	g.GET("/questions/stats", read, m.questionStats)
	g.GET("/questions/:id", read, m.question)
	g.POST("/questions", manage, m.createQuestion)
	g.PATCH("/questions/:id", manage, m.updateQuestion)
	g.POST("/questions/:id/status", manage, m.setQuestionStatus)

	g.GET("/assessment-configs", read, m.assessmentConfigs)
	g.POST("/assessment-configs", manage, m.createAssessmentConfig)
	g.POST("/assessment-configs/:id/activate", manage, m.activateAssessmentConfig)
	g.GET("/assessment-attempts", read, m.assessmentAttempts)
	g.GET("/assessment-stats", read, m.assessmentStats)

	// Paywall. Reading the configuration is part of understanding the platform; changing
	// what people pay for is not, so the writes need the billing permission.
	billing := authz.RequirePermission(authz.PermSubscriptionsManage)
	g.GET("/plans", authz.RequirePermission(authz.PermUsersRead), m.plans)
	g.GET("/entitlements", authz.RequirePermission(authz.PermUsersRead), m.entitlements)
	g.PATCH("/plans/:id", billing, m.updatePlan)
	g.PUT("/plans/:id/entitlements/:key", billing, m.setPlanEntitlement)
	g.DELETE("/plans/:id/entitlements/:key", billing, m.deletePlanEntitlement)

	// Money. Reading it is a business question, so anyone who can see learners can see it;
	// nothing here can change a payment, because a payment is a record of what happened.
	g.GET("/payments", authz.RequirePermission(authz.PermUsersRead), m.payments)
	g.GET("/payments/revenue", authz.RequirePermission(authz.PermUsersRead), m.revenue)

	// Notification templates. Reading is open to anyone who can see learners; editing the
	// words that go to every learner's inbox is a settings-level action.
	g.GET("/notification-templates", authz.RequirePermission(authz.PermUsersRead), m.notificationTemplates)
	g.PATCH("/notification-templates/:code/:locale", authz.RequirePermission(authz.PermSettingsManage), m.updateNotificationTemplate)
	g.POST("/notification-templates/:code/:locale/preview", authz.RequirePermission(authz.PermUsersRead), m.previewNotificationTemplate)
	g.GET("/notifications", authz.RequirePermission(authz.PermUsersRead), m.sentNotifications)

	g.GET("/audit-logs", authz.RequirePermission(authz.PermAuditRead), m.auditLog)

	// Settings are platform defaults, so changing them is a system-level action.
	g.GET("/settings", authz.RequirePermission(authz.PermUsersRead), m.siteSettings)
	g.PATCH("/settings", authz.RequirePermission(authz.PermSettingsManage), m.updateSiteSettings)
	g.GET("/wallpapers", authz.RequirePermission(authz.PermUsersRead), m.wallpapers)
	g.PATCH("/wallpapers/:id", authz.RequirePermission(authz.PermSettingsManage), m.updateWallpaper)

	// Learners. Reading a record and changing one are different permissions: support can do
	// both, an analyst only the first.
	usersRead := authz.RequirePermission(authz.PermUsersRead)
	usersManage := authz.RequirePermission(authz.PermUsersManage)
	g.GET("/learners", usersRead, m.learners)
	g.GET("/learners/:id", usersRead, m.learner)
	g.POST("/learners/:id/status", usersManage, m.setLearnerStatus)
	g.POST("/learners/:id/role", usersManage, m.setUserRole)
	g.GET("/roles", usersRead, m.roles)

	// Analytics and AI monitoring.
	g.GET("/analytics/overview", usersRead, m.analyticsOverview)
	g.GET("/analytics/growth", usersRead, m.growth)
	g.GET("/ai/failures", authz.RequirePermission(authz.PermAIUsageRead), m.aiFailures)
	g.GET("/ai/quality", authz.RequirePermission(authz.PermAIUsageRead), m.aiQuality)
}

func (m *Module) overview(c *gin.Context) {
	o, err := m.Overview(c.Request.Context())
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, o)
}

func (m *Module) Overview(ctx context.Context) (Overview, error) {
	var o Overview
	o.Currency = "USD"
	o.Plans = []PlanCount{}
	o.Content = []StatusCount{}

	if err := m.pool.QueryRow(ctx, `
		SELECT count(*),
		       count(*) FILTER (WHERE last_login_at > now() - interval '30 days'),
		       count(*) FILTER (WHERE created_at > now() - interval '7 days')
		FROM users WHERE deleted_at IS NULL`,
	).Scan(&o.Users.Total, &o.Users.Active30d, &o.Users.New7d); err != nil {
		return o, err
	}

	rows, err := m.pool.Query(ctx, `
		SELECT p.code, p.name, p.is_default, count(s.id)
		FROM subscription_plans p
		LEFT JOIN subscriptions s ON s.plan_id = p.id AND s.status IN ('trialing', 'active', 'past_due')
		WHERE p.is_active
		GROUP BY p.code, p.name, p.is_default, p.sort_order
		ORDER BY p.sort_order`)
	if err != nil {
		return o, err
	}
	var paying int64
	for rows.Next() {
		var pc PlanCount
		if err := rows.Scan(&pc.PlanCode, &pc.PlanName, &pc.IsDefault, &pc.Users); err != nil {
			rows.Close()
			return o, err
		}
		paying += pc.Users
		o.Plans = append(o.Plans, pc)
	}
	rows.Close()
	// Users without a live subscription are on the default plan.
	for i := range o.Plans {
		if o.Plans[i].IsDefault {
			o.Plans[i].Users += max(o.Users.Total-paying, 0)
		}
	}

	if err := m.pool.QueryRow(ctx, `
		SELECT COALESCE(sum(CASE p.billing_interval WHEN 'month' THEN p.price_cents
		                                            WHEN 'year' THEN p.price_cents / 12
		                                            ELSE 0 END), 0)::bigint
		FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
		WHERE s.status = 'active'`).Scan(&o.MRRCents); err != nil {
		return o, err
	}

	if err := m.pool.QueryRow(ctx, `
		SELECT COALESCE(sum(estimated_cost_usd), 0)::float8, COALESCE(sum(request_count), 0)::bigint,
		       COALESCE(sum(failed_count), 0)::bigint
		FROM ai_usage WHERE usage_date > current_date - 30`,
	).Scan(&o.AI.CostUSD30d, &o.AI.Requests30d, &o.AI.Failed30d); err != nil {
		return o, err
	}

	crow, err := m.pool.Query(ctx, `SELECT status, count(*) FROM content_items GROUP BY status ORDER BY status`)
	if err != nil {
		return o, err
	}
	defer crow.Close()
	for crow.Next() {
		var sc StatusCount
		if err := crow.Scan(&sc.Status, &sc.Count); err != nil {
			return o, err
		}
		o.Content = append(o.Content, sc)
	}
	return o, crow.Err()
}

type usageQuery struct {
	Days int `form:"days" binding:"omitempty,min=1,max=365"`
}

const usageColumns = `sum(request_count)::bigint, sum(failed_count)::bigint, sum(input_tokens)::bigint,
	sum(output_tokens)::bigint, sum(audio_seconds)::float8, sum(estimated_cost_usd)::float8`

func (m *Module) aiUsage(c *gin.Context) {
	var q usageQuery
	if err := httpx.BindQuery(c, &q); err != nil {
		httpx.Fail(c, err)
		return
	}
	if q.Days == 0 {
		q.Days = 30
	}
	ctx := c.Request.Context()
	r := UsageReport{Days: q.Days, ByTask: []UsageRow{}, ByModel: []UsageRow{}, Daily: []DailyCost{}}

	if err := m.pool.QueryRow(ctx, `
		SELECT COALESCE(sum(request_count), 0)::bigint, COALESCE(sum(failed_count), 0)::bigint,
		       COALESCE(sum(input_tokens), 0)::bigint, COALESCE(sum(output_tokens), 0)::bigint,
		       COALESCE(sum(audio_seconds), 0)::float8, COALESCE(sum(estimated_cost_usd), 0)::float8
		FROM ai_usage WHERE usage_date > current_date - $1::int`, q.Days,
	).Scan(&r.Totals.Requests, &r.Totals.Failed, &r.Totals.InputTokens, &r.Totals.OutputTokens,
		&r.Totals.AudioSeconds, &r.Totals.CostUSD); err != nil {
		httpx.Fail(c, err)
		return
	}
	r.Totals.Key = "total"

	byTask, err := m.pool.Query(ctx, `
		SELECT task, `+usageColumns+`
		FROM ai_usage WHERE usage_date > current_date - $1::int
		GROUP BY task ORDER BY sum(estimated_cost_usd) DESC`, q.Days)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	for byTask.Next() {
		var row UsageRow
		if err := byTask.Scan(&row.Key, &row.Requests, &row.Failed, &row.InputTokens, &row.OutputTokens,
			&row.AudioSeconds, &row.CostUSD); err != nil {
			byTask.Close()
			httpx.Fail(c, err)
			return
		}
		r.ByTask = append(r.ByTask, row)
	}
	byTask.Close()

	latency := map[string]float64{}
	lrows, err := m.pool.Query(ctx, `
		SELECT provider, model, avg(latency_ms)::float8 FROM ai_requests
		WHERE created_at > now() - make_interval(days => $1::int)
		GROUP BY provider, model`, q.Days)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	for lrows.Next() {
		var provider, model string
		var avg float64
		if err := lrows.Scan(&provider, &model, &avg); err != nil {
			lrows.Close()
			httpx.Fail(c, err)
			return
		}
		latency[provider+"/"+model] = avg
	}
	lrows.Close()

	byModel, err := m.pool.Query(ctx, `
		SELECT provider, model, `+usageColumns+`
		FROM ai_usage WHERE usage_date > current_date - $1::int
		GROUP BY provider, model ORDER BY sum(estimated_cost_usd) DESC`, q.Days)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	for byModel.Next() {
		var row UsageRow
		if err := byModel.Scan(&row.Provider, &row.Model, &row.Requests, &row.Failed, &row.InputTokens,
			&row.OutputTokens, &row.AudioSeconds, &row.CostUSD); err != nil {
			byModel.Close()
			httpx.Fail(c, err)
			return
		}
		row.Key = row.Provider + "/" + row.Model
		row.AvgLatencyMs = latency[row.Key]
		r.ByModel = append(r.ByModel, row)
	}
	byModel.Close()

	daily, err := m.pool.Query(ctx, `
		SELECT usage_date, sum(estimated_cost_usd)::float8, sum(request_count)::bigint
		FROM ai_usage WHERE usage_date > current_date - $1::int
		GROUP BY usage_date ORDER BY usage_date`, q.Days)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer daily.Close()
	for daily.Next() {
		var d DailyCost
		if err := daily.Scan(&d.Date, &d.CostUSD, &d.Requests); err != nil {
			httpx.Fail(c, err)
			return
		}
		r.Daily = append(r.Daily, d)
	}
	if err := daily.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, r)
}

func (m *Module) content(c *gin.Context) {
	var f ContentFilter
	if err := httpx.BindQuery(c, &f); err != nil {
		httpx.Fail(c, err)
		return
	}
	f.Pagination = f.Normalize()

	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT ci.id, ci.type, ci.title, s.code, l.code, t.slug, ci.exam, ci.difficulty, ci.status,
		       ci.published_at, ci.updated_at, count(*) OVER ()
		FROM content_items ci
		LEFT JOIN skills s ON s.id = ci.skill_id
		LEFT JOIN levels l ON l.id = ci.level_id
		LEFT JOIN topics t ON t.id = ci.topic_id
		WHERE ($1 = '' OR ci.type = $1)
		  AND ($2 = '' OR s.code = $2)
		  AND ($3 = '' OR l.code = upper($3))
		  AND ($4 = '' OR ci.status = $4)
		ORDER BY ci.updated_at DESC
		OFFSET $5 LIMIT $6`, f.Type, f.Skill, f.Level, f.Status, f.Offset(), f.PageSize)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []ContentRow{}
	var total int64
	for rows.Next() {
		var row ContentRow
		if err := rows.Scan(&row.ID, &row.Type, &row.Title, &row.Skill, &row.Level, &row.Topic, &row.Exam,
			&row.Difficulty, &row.Status, &row.PublishedAt, &row.UpdatedAt, &total); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, row)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OKWithMeta(c, list, httpx.Meta{Page: f.Page, PageSize: f.PageSize, Total: total})
}
