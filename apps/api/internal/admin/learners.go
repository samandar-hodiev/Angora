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

// Learners, as the owner needs to understand them.
//
// Everything here is read from the tables the learner app writes: there is no reporting copy
// and no derived "learner score" invented for the console. Where a number would be a guess it
// is absent rather than estimated.
//
// A learner's level is deliberately not one field. user_levels keeps every statement ever made
// about them — what they said (self_reported), what a placement measured (assessed), and the
// platform's current estimate — and the console shows all three, because a learner who calls
// themselves B1 and assesses at A2 is the interesting case, not an inconsistency to hide.

const (
	ActionLearnerStatusChanged = "learner.status_changed"
	ActionLearnerRoleChanged   = "user.role_changed"
)

type LearnerRow struct {
	ID           uuid.UUID  `json:"id"`
	Email        string     `json:"email"`
	DisplayName  string     `json:"display_name"`
	AvatarURL    *string    `json:"avatar_url"`
	Phone        *string    `json:"phone"`
	Status       string     `json:"status"`
	Role         string     `json:"role"`
	PlanCode     string     `json:"plan_code"`
	PlanName     string     `json:"plan_name"`
	CurrentLevel *string    `json:"current_level"`
	StreakDays   int        `json:"streak_days"`
	JoinedAt     time.Time  `json:"joined_at"`
	LastActiveAt *time.Time `json:"last_active_at"`
	Onboarded    bool       `json:"onboarded"`
}

type LearnerFilter struct {
	httpx.Pagination
	Search string `form:"search" binding:"omitempty,max=160"`
	Plan   string `form:"plan" binding:"omitempty,max=32"`
	Level  string `form:"level" binding:"omitempty,max=8"`
	Status string `form:"status" binding:"omitempty,oneof=active suspended deleted"`
	Sort   string `form:"sort" binding:"omitempty,oneof=joined last_active email"`
}

// learners lists accounts with the three things the owner asks first: what they pay, what
// level they are, and whether they are still here.
func (m *Module) learners(c *gin.Context) {
	var f LearnerFilter
	if err := httpx.BindQuery(c, &f); err != nil {
		httpx.Fail(c, err)
		return
	}
	f.Pagination = f.Normalize()

	order := "u.created_at DESC"
	switch f.Sort {
	case "last_active":
		order = "u.last_login_at DESC NULLS LAST"
	case "email":
		order = "u.email ASC"
	}

	rows, err := m.pool.Query(c.Request.Context(), `
		WITH live AS (
			SELECT DISTINCT ON (s.user_id) s.user_id, p.code, p.name
			FROM subscriptions s
			JOIN subscription_plans p ON p.id = s.plan_id
			WHERE s.status IN ('trialing', 'active', 'past_due')
			ORDER BY s.user_id, s.created_at DESC
		)
		SELECT u.id, u.email, coalesce(pr.display_name, ''), pr.avatar_url, pr.phone_number,
		       u.status, u.role,
		       coalesce(live.code, dp.code), coalesce(live.name, dp.name),
		       lv.code, coalesce(st.current_days, 0),
		       u.created_at, u.last_login_at, pr.onboarding_completed_at IS NOT NULL,
		       count(*) OVER ()
		FROM users u
		LEFT JOIN profiles pr ON pr.user_id = u.id
		LEFT JOIN levels lv ON lv.id = pr.current_level_id
		LEFT JOIN streaks st ON st.user_id = u.id
		LEFT JOIN live ON live.user_id = u.id
		CROSS JOIN (SELECT code, name FROM subscription_plans WHERE is_default LIMIT 1) dp
		WHERE ($1 = '' OR u.email ILIKE '%' || $1 || '%' OR pr.display_name ILIKE '%' || $1 || '%')
		  AND ($2 = '' OR coalesce(live.code, dp.code) = $2)
		  AND ($3 = '' OR lv.code = upper($3))
		  AND ($4 = '' OR u.status = $4)
		ORDER BY `+order+`
		OFFSET $5 LIMIT $6`,
		f.Search, f.Plan, f.Level, f.Status, f.Offset(), f.PageSize)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []LearnerRow{}
	var total int64
	for rows.Next() {
		var r LearnerRow
		if err := rows.Scan(&r.ID, &r.Email, &r.DisplayName, &r.AvatarURL, &r.Phone, &r.Status, &r.Role,
			&r.PlanCode, &r.PlanName, &r.CurrentLevel, &r.StreakDays, &r.JoinedAt, &r.LastActiveAt,
			&r.Onboarded, &total); err != nil {
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

type LevelStatement struct {
	Kind       string    `json:"kind"`
	CEFR       string    `json:"cefr"`
	SourceType string    `json:"source_type"`
	Confidence *float64  `json:"confidence"`
	CreatedAt  time.Time `json:"created_at"`
}

type SkillProgressRow struct {
	Skill           string     `json:"skill"`
	SkillName       string     `json:"skill_name"`
	EstimatedLevel  *string    `json:"estimated_level"`
	Score           float64    `json:"score"`
	Sessions        int        `json:"sessions"`
	LastPracticedAt *time.Time `json:"last_practiced_at"`
}

type WeaknessRow struct {
	Category        string    `json:"category"`
	Skill           *string   `json:"skill"`
	Severity        float64   `json:"severity"`
	EvidenceCount   int       `json:"evidence_count"`
	Status          string    `json:"status"`
	FirstDetectedAt time.Time `json:"first_detected_at"`
	LastDetectedAt  time.Time `json:"last_detected_at"`
}

type AssessmentSummary struct {
	ID          uuid.UUID  `json:"id"`
	Kind        string     `json:"kind"`
	Status      string     `json:"status"`
	OverallCEFR *string    `json:"overall_cefr"`
	Score       *float64   `json:"overall_score"`
	StartedAt   time.Time  `json:"started_at"`
	CompletedAt *time.Time `json:"completed_at"`
}

type SubscriptionSummary struct {
	PlanCode   string     `json:"plan_code"`
	PlanName   string     `json:"plan_name"`
	Status     string     `json:"status"`
	PriceCents int        `json:"price_cents"`
	Currency   string     `json:"currency"`
	Provider   string     `json:"provider"`
	StartedAt  *time.Time `json:"started_at"`
	RenewsAt   *time.Time `json:"renews_at"`
	CancelAt   bool       `json:"cancel_at_period_end"`
}

type UsageRowLearner struct {
	Entitlement string    `json:"entitlement"`
	Used        int       `json:"used"`
	PeriodStart time.Time `json:"period_start"`
}

type LearnerDetail struct {
	LearnerRow
	NativeLanguage   *string              `json:"native_language"`
	Timezone         string               `json:"timezone"`
	TargetLevel      *string              `json:"target_level"`
	DailyGoalMinutes int                  `json:"daily_goal_minutes"`
	LearningGoals    []string             `json:"learning_goals"`
	Levels           []LevelStatement     `json:"levels"`
	Skills           []SkillProgressRow   `json:"skills"`
	Weaknesses       []WeaknessRow        `json:"weaknesses"`
	Assessments      []AssessmentSummary  `json:"assessments"`
	Subscription     *SubscriptionSummary `json:"subscription"`
	Usage            []UsageRowLearner    `json:"usage"`
	AICostUSD30d     float64              `json:"ai_cost_usd_30d"`
	AIRequests30d    int64                `json:"ai_requests_30d"`
}

// learner assembles the profile the owner sees. Each section is a plain read of the table
// that owns it; nothing is computed here that the platform does not already compute for the
// learner themselves.
func (m *Module) learner(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid learner id"))
		return
	}
	ctx := c.Request.Context()

	var d LearnerDetail
	err = m.pool.QueryRow(ctx, `
		WITH live AS (
			SELECT DISTINCT ON (s.user_id) s.user_id, p.code, p.name
			FROM subscriptions s
			JOIN subscription_plans p ON p.id = s.plan_id
			WHERE s.user_id = $1 AND s.status IN ('trialing', 'active', 'past_due')
			ORDER BY s.user_id, s.created_at DESC
		)
		SELECT u.id, u.email, coalesce(pr.display_name, ''), pr.avatar_url, pr.phone_number,
		       u.status, u.role,
		       coalesce(live.code, dp.code), coalesce(live.name, dp.name),
		       cur.code, coalesce(st.current_days, 0), u.created_at, u.last_login_at,
		       pr.onboarding_completed_at IS NOT NULL,
		       pr.native_language, coalesce(pr.timezone, 'UTC'), tgt.code,
		       coalesce(pr.daily_goal_minutes, 15), coalesce(pr.learning_goals, '{}')
		FROM users u
		LEFT JOIN profiles pr ON pr.user_id = u.id
		LEFT JOIN levels cur ON cur.id = pr.current_level_id
		LEFT JOIN levels tgt ON tgt.id = pr.target_level_id
		LEFT JOIN streaks st ON st.user_id = u.id
		LEFT JOIN live ON live.user_id = u.id
		CROSS JOIN (SELECT code, name FROM subscription_plans WHERE is_default LIMIT 1) dp
		WHERE u.id = $1`, id).
		Scan(&d.ID, &d.Email, &d.DisplayName, &d.AvatarURL, &d.Phone, &d.Status, &d.Role,
			&d.PlanCode, &d.PlanName, &d.CurrentLevel, &d.StreakDays, &d.JoinedAt, &d.LastActiveAt,
			&d.Onboarded, &d.NativeLanguage, &d.Timezone, &d.TargetLevel, &d.DailyGoalMinutes, &d.LearningGoals)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.NotFound("Learner"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	d.Levels = []LevelStatement{}
	d.Skills = []SkillProgressRow{}
	d.Weaknesses = []WeaknessRow{}
	d.Assessments = []AssessmentSummary{}
	d.Usage = []UsageRowLearner{}

	// The most recent statement of each kind: the history is kept, the console shows the
	// current picture.
	levels, err := m.pool.Query(ctx, `
		SELECT DISTINCT ON (kind) kind, cefr::text, source_type, confidence, created_at
		FROM user_levels WHERE user_id = $1
		ORDER BY kind, created_at DESC`, id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	for levels.Next() {
		var l LevelStatement
		if err := levels.Scan(&l.Kind, &l.CEFR, &l.SourceType, &l.Confidence, &l.CreatedAt); err != nil {
			levels.Close()
			httpx.Fail(c, err)
			return
		}
		d.Levels = append(d.Levels, l)
	}
	levels.Close()
	if err := levels.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}

	skills, err := m.pool.Query(ctx, `
		SELECT s.code, s.name, l.code, sp.score::float8, sp.sessions_count, sp.last_practiced_at
		FROM skill_progress sp
		JOIN skills s ON s.id = sp.skill_id
		LEFT JOIN levels l ON l.id = sp.estimated_level_id
		WHERE sp.user_id = $1
		ORDER BY s.sort_order, s.code`, id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	for skills.Next() {
		var s SkillProgressRow
		if err := skills.Scan(&s.Skill, &s.SkillName, &s.EstimatedLevel, &s.Score, &s.Sessions, &s.LastPracticedAt); err != nil {
			skills.Close()
			httpx.Fail(c, err)
			return
		}
		d.Skills = append(d.Skills, s)
	}
	skills.Close()
	if err := skills.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}

	weak, err := m.pool.Query(ctx, `
		SELECT w.category, s.code, w.severity_score::float8, w.evidence_count, w.status,
		       w.first_detected_at, w.last_detected_at
		FROM weaknesses w
		LEFT JOIN skills s ON s.id = w.skill_id
		WHERE w.user_id = $1 AND w.status <> 'resolved'
		ORDER BY w.severity_score DESC
		LIMIT 20`, id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	for weak.Next() {
		var w WeaknessRow
		if err := weak.Scan(&w.Category, &w.Skill, &w.Severity, &w.EvidenceCount, &w.Status,
			&w.FirstDetectedAt, &w.LastDetectedAt); err != nil {
			weak.Close()
			httpx.Fail(c, err)
			return
		}
		d.Weaknesses = append(d.Weaknesses, w)
	}
	weak.Close()
	if err := weak.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}

	assessments, err := m.pool.Query(ctx, `
		SELECT a.id, a.kind, a.status, r.overall_cefr::text, r.overall_score::float8, a.started_at, a.completed_at
		FROM assessments a
		LEFT JOIN assessment_results r ON r.assessment_id = a.id
		WHERE a.user_id = $1
		ORDER BY a.created_at DESC
		LIMIT 10`, id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	for assessments.Next() {
		var a AssessmentSummary
		if err := assessments.Scan(&a.ID, &a.Kind, &a.Status, &a.OverallCEFR, &a.Score, &a.StartedAt, &a.CompletedAt); err != nil {
			assessments.Close()
			httpx.Fail(c, err)
			return
		}
		d.Assessments = append(d.Assessments, a)
	}
	assessments.Close()
	if err := assessments.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}

	var sub SubscriptionSummary
	err = m.pool.QueryRow(ctx, `
		SELECT p.code, p.name, s.status, p.price_cents, p.currency, s.provider,
		       s.current_period_start, s.current_period_end, s.cancel_at_period_end
		FROM subscriptions s
		JOIN subscription_plans p ON p.id = s.plan_id
		WHERE s.user_id = $1
		ORDER BY s.created_at DESC LIMIT 1`, id).
		Scan(&sub.PlanCode, &sub.PlanName, &sub.Status, &sub.PriceCents, &sub.Currency, &sub.Provider,
			&sub.StartedAt, &sub.RenewsAt, &sub.CancelAt)
	if err == nil {
		d.Subscription = &sub
	} else if !errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, err)
		return
	}

	// What the learner has actually spent of their entitlements this period: the same
	// counters the API enforces against.
	usage, err := m.pool.Query(ctx, `
		SELECT entitlement_key, used, period_start
		FROM usage_counters
		WHERE user_id = $1 AND period_start >= date_trunc('month', now()) - interval '1 month'
		ORDER BY period_start DESC, entitlement_key`, id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	for usage.Next() {
		var u UsageRowLearner
		if err := usage.Scan(&u.Entitlement, &u.Used, &u.PeriodStart); err != nil {
			usage.Close()
			httpx.Fail(c, err)
			return
		}
		d.Usage = append(d.Usage, u)
	}
	usage.Close()
	if err := usage.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}

	// What this learner costs to serve.
	if err := m.pool.QueryRow(ctx, `
		SELECT coalesce(sum(estimated_cost_usd), 0)::float8, count(*)
		FROM ai_requests WHERE user_id = $1 AND created_at >= now() - interval '30 days'`, id).
		Scan(&d.AICostUSD30d, &d.AIRequests30d); err != nil {
		httpx.Fail(c, err)
		return
	}

	httpx.OK(c, d)
}

type LearnerStatusInput struct {
	Status string `json:"status" binding:"required,oneof=active suspended"`
	Reason string `json:"reason" binding:"omitempty,max=280"`
}

// setLearnerStatus suspends or reinstates an account. Suspension is enforced where it
// matters — the session check — not by hiding the learner's own UI.
func (m *Module) setLearnerStatus(c *gin.Context) {
	principal, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid learner id"))
		return
	}
	var in LearnerStatusInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	if id == principal.UserID {
		httpx.Fail(c, apperr.BadRequest("You cannot change your own account status"))
		return
	}

	var previous string
	err = m.pool.QueryRow(c.Request.Context(), `
		UPDATE users SET status = $2 WHERE id = $1 AND status <> 'deleted'
		RETURNING (SELECT status FROM users WHERE id = $1)`, id, in.Status).Scan(&previous)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.NotFound("Learner"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	// A suspended learner keeps a valid access token until it expires; revoking their
	// refresh tokens stops the session being renewed.
	if in.Status == "suspended" {
		if _, err := m.pool.Exec(c.Request.Context(),
			`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, id); err != nil {
			httpx.Fail(c, err)
			return
		}
	}

	m.audit.Record(c.Request.Context(), audit.Entry{
		ActorID: &principal.UserID, Action: ActionLearnerStatusChanged, EntityType: "user",
		EntityID: id.String(),
		Metadata: map[string]any{"from": previous, "to": in.Status, "reason": in.Reason},
		IP:       c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})
	httpx.OK(c, gin.H{"id": id, "status": in.Status})
}

type RoleInput struct {
	Role string `json:"role" binding:"required,max=32"`
}

// setUserRole changes what an operator can do. Only a caller who can already manage users may
// call it, and nobody may change their own role — an operator must not be able to promote
// themselves past the person who appointed them.
func (m *Module) setUserRole(c *gin.Context) {
	principal, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid user id"))
		return
	}
	var in RoleInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	if !authz.Role(in.Role).Valid() {
		httpx.Fail(c, apperr.Validation(map[string]any{"role": "Unknown role"}))
		return
	}
	if id == principal.UserID {
		httpx.Fail(c, apperr.BadRequest("You cannot change your own role"))
		return
	}

	var previous string
	err = m.pool.QueryRow(c.Request.Context(),
		`UPDATE users SET role = $2 WHERE id = $1 RETURNING (SELECT role FROM users WHERE id = $1)`,
		id, in.Role).Scan(&previous)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.NotFound("User"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	m.audit.Record(c.Request.Context(), audit.Entry{
		ActorID: &principal.UserID, Action: ActionLearnerRoleChanged, EntityType: "user",
		EntityID: id.String(), Metadata: map[string]any{"from": previous, "to": in.Role},
		IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})
	httpx.OK(c, gin.H{"id": id, "role": in.Role})
}

// roles lists what the console may assign, with the permissions each one carries, so the
// person granting access can see what they are granting.
func (m *Module) roles(c *gin.Context) {
	type roleInfo struct {
		Role        string   `json:"role"`
		Permissions []string `json:"permissions"`
	}
	out := []roleInfo{}
	for _, r := range authz.Roles() {
		perms := authz.PermissionsFor(r)
		list := make([]string, 0, len(perms))
		for _, p := range perms {
			list = append(list, string(p))
		}
		out = append(out, roleInfo{Role: string(r), Permissions: list})
	}
	httpx.OK(c, out)
}

var _ = json.Marshal
