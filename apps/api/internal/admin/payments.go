package admin

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Money, as the owner console sees it.
//
// Revenue here is counted from payment_transactions — what was actually charged — and never
// from plan prices multiplied by subscriber counts. Those two numbers disagree the moment a
// price changes, and only one of them is the truth.

const ActionPlanUpdated = "plan.updated"

type PaymentRow struct {
	ID            uuid.UUID  `json:"id"`
	LearnerID     uuid.UUID  `json:"learner_id"`
	LearnerEmail  string     `json:"learner_email"`
	PlanCode      string     `json:"plan_code"`
	PlanName      string     `json:"plan_name"`
	Provider      string     `json:"provider"`
	Status        string     `json:"status"`
	AmountMinor   int64      `json:"amount_minor"`
	Currency      string     `json:"currency"`
	ErrorNote     string     `json:"error_note"`
	HasSubscriber bool       `json:"has_subscription"`
	PaidAt        *time.Time `json:"paid_at"`
	CreatedAt     time.Time  `json:"created_at"`
}

type PaymentFilter struct {
	httpx.Pagination
	Status   string `form:"status" binding:"omitempty,oneof=created prepared paid canceled failed"`
	Provider string `form:"provider" binding:"omitempty,max=32"`
	Query    string `form:"q" binding:"omitempty,max=120"`
}

func (m *Module) payments(c *gin.Context) {
	var f PaymentFilter
	if err := httpx.BindQuery(c, &f); err != nil {
		httpx.Fail(c, err)
		return
	}
	page := f.Normalize()

	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT t.id, t.user_id, u.email, p.code, p.name, t.provider, t.status, t.amount_minor,
		       t.currency, t.error_note, t.subscription_id IS NOT NULL, t.paid_at, t.created_at,
		       count(*) OVER ()
		FROM payment_transactions t
		JOIN users u ON u.id = t.user_id
		JOIN subscription_plans p ON p.id = t.plan_id
		WHERE ($1 = '' OR t.status = $1)
		  AND ($2 = '' OR t.provider = $2)
		  AND ($3 = '' OR u.email ILIKE '%' || $3 || '%' OR p.code ILIKE '%' || $3 || '%')
		ORDER BY t.created_at DESC
		LIMIT $4 OFFSET $5`, f.Status, f.Provider, f.Query, page.PageSize, page.Offset())
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []PaymentRow{}
	var total int64
	for rows.Next() {
		var p PaymentRow
		if err := rows.Scan(&p.ID, &p.LearnerID, &p.LearnerEmail, &p.PlanCode, &p.PlanName, &p.Provider,
			&p.Status, &p.AmountMinor, &p.Currency, &p.ErrorNote, &p.HasSubscriber, &p.PaidAt,
			&p.CreatedAt, &total); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, p)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OKWithMeta(c, list, httpx.Meta{Page: page.Page, PageSize: page.PageSize, Total: total})
}

type RevenueDay struct {
	Date        time.Time `json:"date"`
	AmountMinor int64     `json:"amount_minor"`
	Payments    int64     `json:"payments"`
}

type RevenueReport struct {
	Days int `json:"days"`
	/** All amounts are in the minor unit of Currency; mixing currencies is refused upstream. */
	Currency      string       `json:"currency"`
	PaidMinor     int64        `json:"paid_minor"`
	Payments      int64        `json:"payments"`
	Attempts      int64        `json:"attempts"`
	FailureRate   float64      `json:"failure_rate"`
	PayingUsers   int64        `json:"paying_users"`
	AverageMinor  int64        `json:"average_minor"`
	Daily         []RevenueDay `json:"daily"`
	ByPlan        []PlanMoney  `json:"by_plan"`
	CallbackFails int64        `json:"callback_signature_failures"`
}

type PlanMoney struct {
	PlanCode    string `json:"plan_code"`
	PlanName    string `json:"plan_name"`
	Payments    int64  `json:"payments"`
	AmountMinor int64  `json:"amount_minor"`
}

// revenue reports what was actually collected over the window. Days with no payment are
// present with a zero, so a chart shows a flat line rather than skipping the day.
func (m *Module) revenue(c *gin.Context) {
	days := rangeDays(c, 30)
	ctx := c.Request.Context()
	out := RevenueReport{Days: days, Currency: "UZS", Daily: []RevenueDay{}, ByPlan: []PlanMoney{}}

	if err := m.pool.QueryRow(ctx, `
		SELECT coalesce(sum(amount_minor) FILTER (WHERE status = 'paid'), 0),
		       count(*) FILTER (WHERE status = 'paid'),
		       count(*),
		       count(DISTINCT user_id) FILTER (WHERE status = 'paid')
		FROM payment_transactions
		WHERE created_at >= now() - make_interval(days => $1)`, days).
		Scan(&out.PaidMinor, &out.Payments, &out.Attempts, &out.PayingUsers); err != nil {
		httpx.Fail(c, err)
		return
	}
	if out.Attempts > 0 {
		out.FailureRate = float64(out.Attempts-out.Payments) / float64(out.Attempts)
	}
	if out.Payments > 0 {
		out.AverageMinor = out.PaidMinor / out.Payments
	}

	_ = m.pool.QueryRow(ctx, `
		SELECT count(*) FROM payment_callbacks
		WHERE NOT signature_valid AND created_at >= now() - make_interval(days => $1)`, days).Scan(&out.CallbackFails)

	rows, err := m.pool.Query(ctx, `
		SELECT d.day::date, coalesce(sum(t.amount_minor), 0), count(t.id)
		FROM generate_series(current_date - make_interval(days => $1 - 1), current_date, '1 day') d(day)
		LEFT JOIN payment_transactions t
		       ON t.status = 'paid' AND t.paid_at >= d.day AND t.paid_at < d.day + interval '1 day'
		GROUP BY d.day ORDER BY d.day`, days)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	for rows.Next() {
		var d RevenueDay
		if err := rows.Scan(&d.Date, &d.AmountMinor, &d.Payments); err != nil {
			rows.Close()
			httpx.Fail(c, err)
			return
		}
		out.Daily = append(out.Daily, d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}

	planRows, err := m.pool.Query(ctx, `
		SELECT p.code, p.name, count(t.id), coalesce(sum(t.amount_minor), 0)
		FROM subscription_plans p
		JOIN payment_transactions t ON t.plan_id = p.id AND t.status = 'paid'
		     AND t.paid_at >= now() - make_interval(days => $1)
		GROUP BY p.code, p.name ORDER BY 4 DESC`, days)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer planRows.Close()
	for planRows.Next() {
		var p PlanMoney
		if err := planRows.Scan(&p.PlanCode, &p.PlanName, &p.Payments, &p.AmountMinor); err != nil {
			httpx.Fail(c, err)
			return
		}
		out.ByPlan = append(out.ByPlan, p)
	}
	if err := planRows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, out)
}

// PlanInput is what the owner may change about a plan. Deliberately not here: `code` (it is
// referenced by existing subscriptions and by nothing else), `is_default` (a second default
// would make the free tier ambiguous) and `billing_interval` (changing it would silently
// re-price everyone already subscribed).
type PlanInput struct {
	Name        *string `json:"name" binding:"omitempty,min=2,max=80"`
	Description *string `json:"description" binding:"omitempty,max=400"`
	PriceCents  *int    `json:"price_cents" binding:"omitempty,min=0"`
	/** So'm, whole units. 0 removes the so'm price and takes the plan off Click. */
	PriceUZS  *int64 `json:"price_uzs" binding:"omitempty,min=0"`
	TrialDays *int   `json:"trial_days" binding:"omitempty,min=0,max=90"`
	IsPublic  *bool  `json:"is_public"`
	IsActive  *bool  `json:"is_active"`
	SortOrder *int   `json:"sort_order" binding:"omitempty,min=0,max=999"`
}

// updatePlan edits pricing and visibility.
//
// Existing subscriptions are untouched on purpose: someone who bought last month bought at
// last month's price, and rewriting what they owe from an edit here would be wrong.
func (m *Module) updatePlan(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid plan id"))
		return
	}
	var in PlanInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	ctx := c.Request.Context()

	var isDefault bool
	var code string
	if err := m.pool.QueryRow(ctx, `SELECT code, is_default FROM subscription_plans WHERE id = $1`, id).
		Scan(&code, &isDefault); err != nil {
		if err == pgx.ErrNoRows {
			httpx.Fail(c, apperr.NotFound("Plan"))
			return
		}
		httpx.Fail(c, err)
		return
	}
	// The default plan is what every account falls back to. Deactivating or hiding it would
	// leave signups with no plan at all.
	if isDefault && ((in.IsActive != nil && !*in.IsActive) || (in.IsPublic != nil && !*in.IsPublic)) {
		httpx.Fail(c, apperr.Conflict("The default plan must stay active and public"))
		return
	}

	var uzs *int64
	if in.PriceUZS != nil && *in.PriceUZS > 0 {
		uzs = in.PriceUZS
	}
	if _, err := m.pool.Exec(ctx, `
		UPDATE subscription_plans SET
			name        = coalesce($2, name),
			description = coalesce($3, description),
			price_cents = coalesce($4, price_cents),
			price_uzs   = CASE WHEN $5::boolean THEN $6 ELSE price_uzs END,
			trial_days  = coalesce($7, trial_days),
			is_public   = coalesce($8, is_public),
			is_active   = coalesce($9, is_active),
			sort_order  = coalesce($10, sort_order)
		WHERE id = $1`,
		id, in.Name, in.Description, in.PriceCents, in.PriceUZS != nil, uzs,
		in.TrialDays, in.IsPublic, in.IsActive, in.SortOrder); err != nil {
		httpx.Fail(c, err)
		return
	}

	m.audit.Record(ctx, audit.Entry{
		ActorID: &p.UserID, Action: ActionPlanUpdated, EntityType: "subscription_plan", EntityID: id.String(),
		Metadata: map[string]any{"plan": code, "price_cents": in.PriceCents, "price_uzs": in.PriceUZS,
			"is_public": in.IsPublic, "is_active": in.IsActive},
		IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})
	m.plans(c)
}
