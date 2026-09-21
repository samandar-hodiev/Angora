package admin

import (
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Platform analytics and AI monitoring.
//
// Every number here is counted from a table the platform already writes: accounts from users,
// revenue from live subscriptions and plan prices, activity from analytics_events, AI cost
// from the per-call ledger. Nothing is modelled, projected or rounded up — where the data
// cannot answer a question the field is absent rather than filled with a plausible number.

type GrowthPoint struct {
	Date   time.Time `json:"date"`
	New    int64     `json:"new"`
	Total  int64     `json:"total"`
	Active int64     `json:"active"`
	Paying int64     `json:"paying"`
}

type PlanSlice struct {
	PlanCode string `json:"plan_code"`
	PlanName string `json:"plan_name"`
	Learners int64  `json:"learners"`
	MRRCents int64  `json:"mrr_cents"`
}

type SkillActivity struct {
	Skill    string `json:"skill"`
	Sessions int64  `json:"sessions"`
	Learners int64  `json:"learners"`
}

type AnalyticsOverview struct {
	Days int `json:"days"`

	Learners struct {
		Total      int64 `json:"total"`
		New        int64 `json:"new"`
		ActiveDay  int64 `json:"active_today"`
		ActiveWeek int64 `json:"active_week"`
		Active30d  int64 `json:"active_30d"`
		Suspended  int64 `json:"suspended"`
		Onboarded  int64 `json:"onboarded"`
	} `json:"learners"`

	Monetization struct {
		Paying         int64   `json:"paying"`
		MRRCents       int64   `json:"mrr_cents"`
		Currency       string  `json:"currency"`
		ConversionRate float64 `json:"conversion_rate"`
		NewPaid        int64   `json:"new_paid"`
		Cancelled      int64   `json:"cancelled"`
	} `json:"monetization"`

	Learning struct {
		LevelDistribution []QuestionBucket `json:"level_distribution"`
		SkillActivity     []SkillActivity  `json:"skill_activity"`
		TopWeaknesses     []QuestionBucket `json:"top_weaknesses"`
		AssessmentsDone   int64            `json:"assessments_completed"`
	} `json:"learning"`

	Content []ContentTypeCount `json:"content"`

	AI struct {
		Requests     int64   `json:"requests"`
		Failed       int64   `json:"failed"`
		CostUSD      float64 `json:"cost_usd"`
		AvgLatencyMs float64 `json:"avg_latency_ms"`
		CostPerPayer float64 `json:"cost_usd_per_paying_learner"`
	} `json:"ai"`

	Plans []PlanSlice `json:"plans"`
}

type ContentTypeCount struct {
	Type      string `json:"type"`
	Total     int64  `json:"total"`
	Published int64  `json:"published"`
	Review    int64  `json:"review"`
	Draft     int64  `json:"draft"`
}

func rangeDays(c *gin.Context, fallback int) int {
	days := fallback
	if v := c.Query("days"); v != "" {
		var parsed int
		if _, err := fmt.Sscanf(v, "%d", &parsed); err == nil && parsed >= 1 && parsed <= 365 {
			days = parsed
		}
	}
	return days
}

// analyticsOverview is the dashboard's single read: one round trip per section rather than a
// query per card, so the page is one coherent snapshot rather than eight slightly different
// moments.
func (m *Module) analyticsOverview(c *gin.Context) {
	days := rangeDays(c, 30)
	since := time.Now().AddDate(0, 0, -days)
	ctx := c.Request.Context()

	var o AnalyticsOverview
	o.Days = days
	o.Learning.LevelDistribution = []QuestionBucket{}
	o.Learning.SkillActivity = []SkillActivity{}
	o.Learning.TopWeaknesses = []QuestionBucket{}
	o.Content = []ContentTypeCount{}
	o.Plans = []PlanSlice{}

	if err := m.pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE role = 'USER'),
		       count(*) FILTER (WHERE role = 'USER' AND created_at >= $1),
		       count(*) FILTER (WHERE role = 'USER' AND last_login_at >= now() - interval '1 day'),
		       count(*) FILTER (WHERE role = 'USER' AND last_login_at >= now() - interval '7 days'),
		       count(*) FILTER (WHERE role = 'USER' AND last_login_at >= now() - interval '30 days'),
		       count(*) FILTER (WHERE status = 'suspended')
		FROM users`, since).
		Scan(&o.Learners.Total, &o.Learners.New, &o.Learners.ActiveDay, &o.Learners.ActiveWeek,
			&o.Learners.Active30d, &o.Learners.Suspended); err != nil {
		httpx.Fail(c, err)
		return
	}
	if err := m.pool.QueryRow(ctx,
		`SELECT count(*) FROM profiles WHERE onboarding_completed_at IS NOT NULL`).Scan(&o.Learners.Onboarded); err != nil {
		httpx.Fail(c, err)
		return
	}

	// Revenue is the sum of what live subscriptions actually cost, not an average price
	// multiplied by a headcount.
	if err := m.pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE s.status IN ('trialing', 'active', 'past_due')),
		       coalesce(sum(p.price_cents) FILTER (WHERE s.status = 'active'), 0),
		       count(*) FILTER (WHERE s.status IN ('trialing', 'active') AND s.created_at >= $1),
		       count(*) FILTER (WHERE s.canceled_at >= $1)
		FROM subscriptions s
		JOIN subscription_plans p ON p.id = s.plan_id`, since).
		Scan(&o.Monetization.Paying, &o.Monetization.MRRCents, &o.Monetization.NewPaid, &o.Monetization.Cancelled); err != nil {
		httpx.Fail(c, err)
		return
	}
	o.Monetization.Currency = "USD"
	if o.Learners.Total > 0 {
		o.Monetization.ConversionRate = float64(o.Monetization.Paying) / float64(o.Learners.Total) * 100
	}

	levels, err := m.pool.Query(ctx, `
		SELECT l.code, count(*)
		FROM profiles pr JOIN levels l ON l.id = pr.current_level_id
		GROUP BY l.code, l.rank ORDER BY l.rank`)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	for levels.Next() {
		var b QuestionBucket
		if err := levels.Scan(&b.Key, &b.Count); err != nil {
			levels.Close()
			httpx.Fail(c, err)
			return
		}
		o.Learning.LevelDistribution = append(o.Learning.LevelDistribution, b)
	}
	levels.Close()

	skills, err := m.pool.Query(ctx, `
		SELECT s.code, coalesce(sum(sp.sessions_count), 0), count(*)
		FROM skill_progress sp JOIN skills s ON s.id = sp.skill_id
		WHERE sp.last_practiced_at >= $1
		GROUP BY s.code, s.sort_order ORDER BY s.sort_order`, since)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	for skills.Next() {
		var a SkillActivity
		if err := skills.Scan(&a.Skill, &a.Sessions, &a.Learners); err != nil {
			skills.Close()
			httpx.Fail(c, err)
			return
		}
		o.Learning.SkillActivity = append(o.Learning.SkillActivity, a)
	}
	skills.Close()

	weak, err := m.pool.Query(ctx, `
		SELECT category, count(*) FROM weaknesses WHERE status = 'active'
		GROUP BY category ORDER BY count(*) DESC LIMIT 8`)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	for weak.Next() {
		var b QuestionBucket
		if err := weak.Scan(&b.Key, &b.Count); err != nil {
			weak.Close()
			httpx.Fail(c, err)
			return
		}
		o.Learning.TopWeaknesses = append(o.Learning.TopWeaknesses, b)
	}
	weak.Close()

	if err := m.pool.QueryRow(ctx,
		`SELECT count(*) FROM assessments WHERE status = 'completed' AND completed_at >= $1`, since).
		Scan(&o.Learning.AssessmentsDone); err != nil {
		httpx.Fail(c, err)
		return
	}

	// Content, counted across both stores the platform actually publishes from.
	content, err := m.pool.Query(ctx, `
		SELECT type, count(*), count(*) FILTER (WHERE status = 'published'),
		       count(*) FILTER (WHERE status = 'review'), count(*) FILTER (WHERE status = 'draft')
		FROM content_items GROUP BY type
		UNION ALL
		SELECT 'grammar', count(*), count(*) FILTER (WHERE status = 'published'),
		       count(*) FILTER (WHERE status = 'review'), count(*) FILTER (WHERE status = 'draft')
		FROM grammar_topics
		UNION ALL
		SELECT 'assessment_item', count(*), count(*) FILTER (WHERE status = 'published'),
		       count(*) FILTER (WHERE status = 'review'), count(*) FILTER (WHERE status = 'draft')
		FROM assessment_items
		ORDER BY 1`)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	for content.Next() {
		var ct ContentTypeCount
		if err := content.Scan(&ct.Type, &ct.Total, &ct.Published, &ct.Review, &ct.Draft); err != nil {
			content.Close()
			httpx.Fail(c, err)
			return
		}
		o.Content = append(o.Content, ct)
	}
	content.Close()

	// Cost and volume come from the daily roll-up, which is what /admin/ai-usage reports: two
	// pages showing different totals for the same period is worse than either number alone.
	// The per-call ledger stays the source for failures, where the error code lives.
	if err := m.pool.QueryRow(ctx, `
		SELECT coalesce(sum(request_count), 0), coalesce(sum(failed_count), 0),
		       coalesce(sum(estimated_cost_usd), 0)::float8
		FROM ai_usage WHERE usage_date >= $1::date`, since).
		Scan(&o.AI.Requests, &o.AI.Failed, &o.AI.CostUSD); err != nil {
		httpx.Fail(c, err)
		return
	}
	if err := m.pool.QueryRow(ctx, `
		SELECT coalesce(avg(latency_ms), 0)::float8 FROM ai_requests WHERE created_at >= $1`, since).
		Scan(&o.AI.AvgLatencyMs); err != nil {
		httpx.Fail(c, err)
		return
	}
	if o.Monetization.Paying > 0 {
		o.AI.CostPerPayer = o.AI.CostUSD / float64(o.Monetization.Paying)
	}

	plans, err := m.pool.Query(ctx, `
		WITH live AS (
			SELECT DISTINCT ON (s.user_id) s.user_id, s.plan_id, s.status
			FROM subscriptions s
			WHERE s.status IN ('trialing', 'active', 'past_due')
			ORDER BY s.user_id, s.created_at DESC
		)
		SELECT p.code, p.name,
		       CASE WHEN p.is_default
		            THEN (SELECT count(*) FROM users u WHERE u.role = 'USER'
		                  AND NOT EXISTS (SELECT 1 FROM live WHERE live.user_id = u.id))
		            ELSE (SELECT count(*) FROM live WHERE live.plan_id = p.id) END,
		       (SELECT count(*) FROM live WHERE live.plan_id = p.id AND live.status = 'active') * p.price_cents
		FROM subscription_plans p
		ORDER BY p.sort_order, p.price_cents`)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	for plans.Next() {
		var s PlanSlice
		if err := plans.Scan(&s.PlanCode, &s.PlanName, &s.Learners, &s.MRRCents); err != nil {
			plans.Close()
			httpx.Fail(c, err)
			return
		}
		o.Plans = append(o.Plans, s)
	}
	plans.Close()

	httpx.OK(c, o)
}

// growth is the platform's headline chart: registrations per day and the running total, with
// the active and paying counts as they stood on each day. generate_series fills days with no
// registrations, so the line has no invisible gaps.
func (m *Module) growth(c *gin.Context) {
	days := rangeDays(c, 90)
	ctx := c.Request.Context()

	rows, err := m.pool.Query(ctx, `
		WITH days AS (
			SELECT generate_series(
				date_trunc('day', now()) - make_interval(days => $1 - 1),
				date_trunc('day', now()),
				interval '1 day')::date AS day
		)
		SELECT d.day,
		       (SELECT count(*) FROM users u WHERE u.role = 'USER' AND u.created_at::date = d.day),
		       (SELECT count(*) FROM users u WHERE u.role = 'USER' AND u.created_at::date <= d.day),
		       (SELECT count(DISTINCT e.user_id) FROM analytics_events e
		         WHERE e.occurred_at::date = d.day AND e.user_id IS NOT NULL),
		       (SELECT count(*) FROM subscriptions s
		         WHERE s.created_at::date <= d.day
		           AND (s.canceled_at IS NULL OR s.canceled_at::date > d.day)
		           AND s.status IN ('trialing', 'active', 'past_due'))
		FROM days d
		ORDER BY d.day`, days)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	points := []GrowthPoint{}
	for rows.Next() {
		var p GrowthPoint
		if err := rows.Scan(&p.Date, &p.New, &p.Total, &p.Active, &p.Paying); err != nil {
			httpx.Fail(c, err)
			return
		}
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, gin.H{"days": days, "points": points})
}

// ---- AI monitoring ---------------------------------------------------------------------

type AIFailureRow struct {
	ID        uuid.UUID  `json:"id"`
	UserID    *uuid.UUID `json:"user_id"`
	Email     *string    `json:"email"`
	Task      string     `json:"task"`
	Provider  string     `json:"provider"`
	Model     string     `json:"model"`
	Status    string     `json:"status"`
	ErrorCode string     `json:"error_code"`
	LatencyMs int        `json:"latency_ms"`
	CreatedAt time.Time  `json:"created_at"`
}

// aiFailures is the operations view: which AI calls failed, for whom, and with what error.
// A learner reporting "it didn't work" is traceable from here.
func (m *Module) aiFailures(c *gin.Context) {
	days := rangeDays(c, 7)
	var page httpx.Pagination
	if err := httpx.BindQuery(c, &page); err != nil {
		httpx.Fail(c, err)
		return
	}
	page = page.Normalize()
	since := time.Now().AddDate(0, 0, -days)

	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT r.id, r.user_id, u.email, r.task, r.provider, r.model, r.status,
		       coalesce(r.error_code, ''), r.latency_ms, r.created_at, count(*) OVER ()
		FROM ai_requests r
		LEFT JOIN users u ON u.id = r.user_id
		WHERE r.created_at >= $1 AND r.status <> 'success'
		ORDER BY r.created_at DESC
		OFFSET $2 LIMIT $3`, since, page.Offset(), page.PageSize)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []AIFailureRow{}
	var total int64
	for rows.Next() {
		var r AIFailureRow
		if err := rows.Scan(&r.ID, &r.UserID, &r.Email, &r.Task, &r.Provider, &r.Model, &r.Status,
			&r.ErrorCode, &r.LatencyMs, &r.CreatedAt, &total); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OKWithMeta(c, list, httpx.Meta{Page: page.Page, PageSize: page.PageSize, Total: total})
}

type AIQualityRow struct {
	AnalysisType    string `json:"analysis_type"`
	AnalysisVersion string `json:"analysis_version"`
	ModelVersion    string `json:"model_version"`
	PromptVersion   string `json:"prompt_version"`
	RubricVersion   string `json:"rubric_version"`
	Count           int64  `json:"count"`
	Failed          int64  `json:"failed"`
	/** Mean of overall_score where the evaluator recorded one; null when none did. */
	AvgScore *float64 `json:"avg_score"`
}

// aiQuality reports what the evaluators are producing, grouped by the version that produced
// it. These are AI-estimated scores, never official exam results, and the version is part of
// the row so a prompt change is visible as a shift rather than a mystery.
func (m *Module) aiQuality(c *gin.Context) {
	days := rangeDays(c, 30)
	since := time.Now().AddDate(0, 0, -days)

	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT a.analysis_type, a.analysis_version, a.model_version, a.prompt_version, a.rubric_version,
		       count(*), count(*) FILTER (WHERE a.status = 'failed'),
		       avg(a.overall_score)::float8
		FROM ai_analyses a
		WHERE a.created_at >= $1
		GROUP BY a.analysis_type, a.analysis_version, a.model_version, a.prompt_version, a.rubric_version
		ORDER BY count(*) DESC`, since)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []AIQualityRow{}
	for rows.Next() {
		var r AIQualityRow
		if err := rows.Scan(&r.AnalysisType, &r.AnalysisVersion, &r.ModelVersion, &r.PromptVersion,
			&r.RubricVersion, &r.Count, &r.Failed, &r.AvgScore); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, gin.H{"days": days, "rows": list})
}
