// Package profiles owns the learner profile: display details, CEFR levels, goals, daily
// goal and learning preferences. The same profile is shared by web and mobile.
package profiles

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

type Profile struct {
	UserID                uuid.UUID      `json:"user_id"`
	DisplayName           string         `json:"display_name"`
	AvatarURL             *string        `json:"avatar_url"`
	NativeLanguage        *string        `json:"native_language"`
	Timezone              string         `json:"timezone"`
	CurrentLevel          *string        `json:"current_level"`
	TargetLevel           *string        `json:"target_level"`
	LearningGoals         []string       `json:"learning_goals"`
	DailyGoalMinutes      int            `json:"daily_goal_minutes"`
	Preferences           map[string]any `json:"preferences"`
	OnboardingCompletedAt *time.Time     `json:"onboarding_completed_at"`
	UpdatedAt             time.Time      `json:"updated_at"`
}

// UpdateInput is a partial update: omitted fields are left unchanged.
// Level codes are validated against the levels table, not a hardcoded list.
type UpdateInput struct {
	DisplayName        *string        `json:"display_name" binding:"omitempty,min=1,max=80"`
	NativeLanguage     *string        `json:"native_language" binding:"omitempty,min=2,max=16"`
	Timezone           *string        `json:"timezone" binding:"omitempty,max=64"`
	CurrentLevel       *string        `json:"current_level" binding:"omitempty,max=8"`
	TargetLevel        *string        `json:"target_level" binding:"omitempty,max=8"`
	LearningGoals      *[]string      `json:"learning_goals" binding:"omitempty,max=10,dive,min=1,max=64"`
	DailyGoalMinutes   *int           `json:"daily_goal_minutes" binding:"omitempty,min=5,max=240"`
	Preferences        map[string]any `json:"preferences"`
	CompleteOnboarding bool           `json:"complete_onboarding"`
}

var ErrNotFound = errors.New("profile not found")

type Module struct {
	pool  *pgxpool.Pool
	audit audit.Recorder
	log   *slog.Logger
}

func NewModule(pool *pgxpool.Pool, recorder audit.Recorder, log *slog.Logger) *Module {
	return &Module{pool: pool, audit: recorder, log: log}
}

func (m *Module) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/profile", authz.RequirePermission(authz.PermProfileManageOwn))
	g.GET("", m.handleGet)
	g.PATCH("", m.handleUpdate)
}

func (m *Module) handleGet(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	profile, err := m.Get(c.Request.Context(), p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, profile)
}

func (m *Module) handleUpdate(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var in UpdateInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	profile, err := m.Update(c.Request.Context(), p.UserID, in)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	m.audit.Record(c.Request.Context(), audit.Entry{
		ActorID: &p.UserID, Action: audit.ActionProfileUpdated, EntityType: "profile",
		EntityID: p.UserID.String(), IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})
	httpx.OK(c, profile)
}

func (m *Module) Get(ctx context.Context, userID uuid.UUID) (Profile, error) {
	var p Profile
	err := m.pool.QueryRow(ctx, `
		SELECT p.user_id, p.display_name, p.avatar_url, p.native_language, p.timezone,
		       cl.code, tl.code, p.learning_goals, p.daily_goal_minutes, p.preferences,
		       p.onboarding_completed_at, p.updated_at
		FROM profiles p
		LEFT JOIN levels cl ON cl.id = p.current_level_id
		LEFT JOIN levels tl ON tl.id = p.target_level_id
		WHERE p.user_id = $1`, userID,
	).Scan(&p.UserID, &p.DisplayName, &p.AvatarURL, &p.NativeLanguage, &p.Timezone,
		&p.CurrentLevel, &p.TargetLevel, &p.LearningGoals, &p.DailyGoalMinutes, &p.Preferences,
		&p.OnboardingCompletedAt, &p.UpdatedAt)
	if database.IsNotFound(err) {
		return Profile{}, apperr.NotFound("Profile")
	}
	return p, err
}

func (m *Module) Update(ctx context.Context, userID uuid.UUID, in UpdateInput) (Profile, error) {
	fields := map[string]any{}

	if in.Timezone != nil {
		if _, err := time.LoadLocation(*in.Timezone); err != nil {
			fields["timezone"] = "must be a valid IANA timezone, e.g. Asia/Tashkent"
		}
	}
	currentLevelID, err := m.levelID(ctx, in.CurrentLevel)
	if err != nil {
		fields["current_level"] = err.Error()
	}
	targetLevelID, err := m.levelID(ctx, in.TargetLevel)
	if err != nil {
		fields["target_level"] = err.Error()
	}
	if len(fields) > 0 {
		return Profile{}, apperr.Validation(map[string]any{"fields": fields})
	}

	var goals any
	if in.LearningGoals != nil {
		goals = *in.LearningGoals
	}
	var prefs any
	if in.Preferences != nil {
		prefs = in.Preferences
	}

	tag, err := m.pool.Exec(ctx, `
		UPDATE profiles SET
			display_name            = COALESCE($2, display_name),
			native_language         = COALESCE($3, native_language),
			timezone                = COALESCE($4, timezone),
			current_level_id        = COALESCE($5, current_level_id),
			target_level_id         = COALESCE($6, target_level_id),
			learning_goals          = COALESCE($7::text[], learning_goals),
			daily_goal_minutes      = COALESCE($8, daily_goal_minutes),
			preferences             = preferences || COALESCE($9::jsonb, '{}'::jsonb),
			onboarding_completed_at = CASE WHEN $10 THEN COALESCE(onboarding_completed_at, now())
			                               ELSE onboarding_completed_at END
		WHERE user_id = $1`,
		userID, trimmed(in.DisplayName), in.NativeLanguage, in.Timezone, currentLevelID, targetLevelID,
		goals, in.DailyGoalMinutes, prefs, in.CompleteOnboarding,
	)
	if err != nil {
		return Profile{}, fmt.Errorf("update profile: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return Profile{}, apperr.NotFound("Profile")
	}
	return m.Get(ctx, userID)
}

func (m *Module) levelID(ctx context.Context, code *string) (*uuid.UUID, error) {
	if code == nil {
		return nil, nil
	}
	var id uuid.UUID
	err := m.pool.QueryRow(ctx, `SELECT id FROM levels WHERE code = upper($1)`, *code).Scan(&id)
	if database.IsNotFound(err) {
		return nil, errors.New("is not a known level")
	}
	if err != nil {
		return nil, errors.New("could not be validated")
	}
	return &id, nil
}

func trimmed(s *string) *string {
	if s == nil {
		return nil
	}
	v := strings.TrimSpace(*s)
	return &v
}
