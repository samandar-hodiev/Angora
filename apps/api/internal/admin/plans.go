package admin

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Plans, entitlements and what each plan is allowed to reach.
//
// This is the paywall the owner console edits. Nothing here decides access at request time —
// that is subscriptions.Resolve reading the same two tables — so a change made here takes
// effect on the learner's next request without a deploy, and the learner app never learns a
// plan name.

const (
	ActionEntitlementGranted = "plan_entitlement.granted"
	ActionEntitlementUpdated = "plan_entitlement.updated"
	ActionEntitlementRevoked = "plan_entitlement.revoked"
)

var limitPeriods = map[string]bool{"day": true, "week": true, "month": true, "lifetime": true}

type PlanEntitlementRow struct {
	Key         string `json:"key"`
	Kind        string `json:"kind"`
	Description string `json:"description"`
	/** null means unlimited for a limit entitlement; features carry no value. */
	LimitValue  *int    `json:"limit_value"`
	LimitPeriod *string `json:"limit_period"`
}

type PlanRow struct {
	ID              uuid.UUID            `json:"id"`
	Code            string               `json:"code"`
	Name            string               `json:"name"`
	Description     string               `json:"description"`
	BillingInterval string               `json:"billing_interval"`
	PriceCents      int                  `json:"price_cents"`
	Currency        string               `json:"currency"`
	TrialDays       int                  `json:"trial_days"`
	IsDefault       bool                 `json:"is_default"`
	IsPublic        bool                 `json:"is_public"`
	IsActive        bool                 `json:"is_active"`
	Subscribers     int64                `json:"subscribers"`
	MRRCents        int64                `json:"mrr_cents"`
	Entitlements    []PlanEntitlementRow `json:"entitlements"`
	UpdatedAt       time.Time            `json:"updated_at"`
}

type EntitlementRow struct {
	Key         string `json:"key"`
	Kind        string `json:"kind"`
	Description string `json:"description"`
	/** Which plans grant it, by plan code — the paywall table reads across this. */
	Plans     []string  `json:"plans"`
	CreatedAt time.Time `json:"created_at"`
}

// PlanEntitlementInput grants or updates one entitlement on one plan.
type PlanEntitlementInput struct {
	/** Absent means unlimited for a limit; ignored for a feature. */
	LimitValue  *int    `json:"limit_value" binding:"omitempty,min=0"`
	LimitPeriod *string `json:"limit_period" binding:"omitempty,oneof=day week month lifetime"`
}

func (m *Module) plans(c *gin.Context) {
	ctx := c.Request.Context()

	rows, err := m.pool.Query(ctx, `
		SELECT p.id, p.code, p.name, p.description, p.billing_interval, p.price_cents, p.currency,
		       p.trial_days, p.is_default, p.is_public, p.is_active, p.updated_at,
		       (SELECT count(*) FROM subscriptions s
		        WHERE s.plan_id = p.id AND s.status IN ('trialing', 'active', 'past_due')),
		       coalesce((SELECT count(*) FROM subscriptions s
		        WHERE s.plan_id = p.id AND s.status IN ('trialing', 'active')), 0) * p.price_cents,
		       coalesce(json_agg(json_build_object(
		           'key', e.key, 'kind', e.kind, 'description', e.description,
		           'limit_value', pe.limit_value, 'limit_period', pe.limit_period
		       ) ORDER BY e.kind, e.key) FILTER (WHERE e.key IS NOT NULL), '[]')
		FROM subscription_plans p
		LEFT JOIN plan_entitlements pe ON pe.plan_id = p.id
		LEFT JOIN entitlements e ON e.key = pe.entitlement_key
		GROUP BY p.id
		ORDER BY p.sort_order, p.price_cents`)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []PlanRow{}
	for rows.Next() {
		var p PlanRow
		var raw []byte
		if err := rows.Scan(&p.ID, &p.Code, &p.Name, &p.Description, &p.BillingInterval, &p.PriceCents,
			&p.Currency, &p.TrialDays, &p.IsDefault, &p.IsPublic, &p.IsActive, &p.UpdatedAt,
			&p.Subscribers, &p.MRRCents, &raw); err != nil {
			httpx.Fail(c, err)
			return
		}
		if err := json.Unmarshal(raw, &p.Entitlements); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, p)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, list)
}

func (m *Module) entitlements(c *gin.Context) {
	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT e.key, e.kind, e.description, e.created_at,
		       coalesce(array_agg(p.code ORDER BY p.sort_order) FILTER (WHERE p.code IS NOT NULL), '{}')
		FROM entitlements e
		LEFT JOIN plan_entitlements pe ON pe.entitlement_key = e.key
		LEFT JOIN subscription_plans p ON p.id = pe.plan_id
		GROUP BY e.key, e.kind, e.description, e.created_at
		ORDER BY e.key`)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []EntitlementRow{}
	for rows.Next() {
		var e EntitlementRow
		if err := rows.Scan(&e.Key, &e.Kind, &e.Description, &e.CreatedAt, &e.Plans); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, e)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, list)
}

// setPlanEntitlement grants an entitlement to a plan, or changes its limit.
//
// Upsert rather than insert: the console shows one row per feature per plan and the owner
// edits it in place. A limit needs a period, and a feature must not carry a number — the
// table allows both, but a "feature with a limit of 5" would silently mean nothing.
func (m *Module) setPlanEntitlement(c *gin.Context) {
	principal, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	planID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid plan id"))
		return
	}
	key := c.Param("key")

	var in PlanEntitlementInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}

	ctx := c.Request.Context()
	var kind, planCode string
	err = m.pool.QueryRow(ctx, `
		SELECT e.kind, p.code
		FROM entitlements e, subscription_plans p
		WHERE e.key = $1 AND p.id = $2`, key, planID).Scan(&kind, &planCode)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.NotFound("Plan or entitlement"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	limitValue := in.LimitValue
	limitPeriod := in.LimitPeriod
	switch kind {
	case "feature":
		// A feature is present or absent; any number on it would be ignored at runtime.
		limitValue, limitPeriod = nil, nil
	case "limit":
		if limitPeriod == nil {
			month := "month"
			limitPeriod = &month
		}
		if !limitPeriods[*limitPeriod] {
			httpx.Fail(c, apperr.Validation(map[string]any{"limit_period": "Must be day, week, month or lifetime"}))
			return
		}
	}

	var existed bool
	if err := m.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM plan_entitlements WHERE plan_id = $1 AND entitlement_key = $2)`,
		planID, key).Scan(&existed); err != nil {
		httpx.Fail(c, err)
		return
	}

	if _, err := m.pool.Exec(ctx, `
		INSERT INTO plan_entitlements (plan_id, entitlement_key, limit_value, limit_period)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (plan_id, entitlement_key) DO UPDATE
			SET limit_value = EXCLUDED.limit_value, limit_period = EXCLUDED.limit_period`,
		planID, key, limitValue, limitPeriod); err != nil {
		httpx.Fail(c, err)
		return
	}

	action := ActionEntitlementGranted
	if existed {
		action = ActionEntitlementUpdated
	}
	m.audit.Record(ctx, audit.Entry{
		ActorID: &principal.UserID, Action: action, EntityType: "plan_entitlement",
		EntityID: planID.String() + ":" + key,
		Metadata: map[string]any{"plan": planCode, "entitlement": key, "limit": limitValue, "period": limitPeriod},
		IP:       c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})
	httpx.OK(c, gin.H{"plan_id": planID, "entitlement": key, "limit_value": limitValue, "limit_period": limitPeriod})
}

// deletePlanEntitlement revokes access. Existing usage counters are left alone: they record
// what a learner did under the old configuration and are still the truth about that period.
func (m *Module) deletePlanEntitlement(c *gin.Context) {
	principal, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	planID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid plan id"))
		return
	}
	key := c.Param("key")

	tag, err := m.pool.Exec(c.Request.Context(),
		`DELETE FROM plan_entitlements WHERE plan_id = $1 AND entitlement_key = $2`, planID, key)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Fail(c, apperr.NotFound("Plan entitlement"))
		return
	}

	m.audit.Record(c.Request.Context(), audit.Entry{
		ActorID: &principal.UserID, Action: ActionEntitlementRevoked, EntityType: "plan_entitlement",
		EntityID: planID.String() + ":" + key, Metadata: map[string]any{"entitlement": key},
		IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})
	httpx.NoContent(c)
}

// ---- Audit log ------------------------------------------------------------------------

type AuditRow struct {
	ID         uuid.UUID       `json:"id"`
	ActorEmail *string         `json:"actor_email"`
	Action     string          `json:"action"`
	EntityType string          `json:"entity_type"`
	EntityID   string          `json:"entity_id"`
	Metadata   json.RawMessage `json:"metadata"`
	CreatedAt  time.Time       `json:"created_at"`
}

type AuditFilter struct {
	httpx.Pagination
	Action string `form:"action" binding:"omitempty,max=64"`
	Entity string `form:"entity" binding:"omitempty,max=64"`
	Days   int    `form:"days" binding:"omitempty,min=1,max=365"`
}

// auditLog is the record of who changed what. It is read-only by design: an audit trail an
// operator can edit is not an audit trail.
func (m *Module) auditLog(c *gin.Context) {
	var f AuditFilter
	if err := httpx.BindQuery(c, &f); err != nil {
		httpx.Fail(c, err)
		return
	}
	f.Pagination = f.Normalize()
	if f.Days == 0 {
		f.Days = 30
	}
	since := time.Now().AddDate(0, 0, -f.Days)

	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT a.id, u.email, a.action, a.entity_type, coalesce(a.entity_id, ''), a.metadata, a.created_at,
		       count(*) OVER ()
		FROM audit_logs a
		LEFT JOIN users u ON u.id = a.actor_id
		WHERE a.created_at >= $1
		  AND ($2 = '' OR a.action = $2)
		  AND ($3 = '' OR a.entity_type = $3)
		ORDER BY a.created_at DESC
		OFFSET $4 LIMIT $5`, since, f.Action, f.Entity, f.Offset(), f.PageSize)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []AuditRow{}
	var total int64
	for rows.Next() {
		var r AuditRow
		if err := rows.Scan(&r.ID, &r.ActorEmail, &r.Action, &r.EntityType, &r.EntityID, &r.Metadata,
			&r.CreatedAt, &total); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OKWithMeta(c, list, httpx.Meta{Page: f.Page, PageSize: f.PageSize, Total: total})
}
