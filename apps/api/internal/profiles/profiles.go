// Package profiles owns the learner profile: identity details (name, photo, phone), CEFR
// levels, goals, daily goal and learning preferences. The same profile is shared by web and
// mobile. Authentication credentials live elsewhere (users, user_identities).
package profiles

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/storage"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

type Profile struct {
	UserID      uuid.UUID `json:"user_id"`
	DisplayName string    `json:"display_name"`
	FirstName   string    `json:"first_name"`
	LastName    string    `json:"last_name"`
	// AvatarURL is a path on the API origin (e.g. /api/v1/avatars/...), or null.
	AvatarURL             *string        `json:"avatar_url"`
	PhoneCountry          *string        `json:"phone_country"`
	PhoneNumber           *string        `json:"phone_number"`
	NativeLanguage        *string        `json:"native_language"`
	Timezone              string         `json:"timezone"`
	CurrentLevel          *string        `json:"current_level"`
	TargetLevel           *string        `json:"target_level"`
	LearningGoals         []string       `json:"learning_goals"`
	DailyGoalMinutes      int            `json:"daily_goal_minutes"`
	Preferences           map[string]any `json:"preferences"`
	ProfileCompletedAt    *time.Time     `json:"profile_completed_at"`
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

// SetupInput is the account profile step after sign-up.
type SetupInput struct {
	FirstName    string `json:"first_name" binding:"required,max=50"`
	LastName     string `json:"last_name" binding:"omitempty,max=50"`
	PhoneCountry string `json:"phone_country" binding:"omitempty,len=2"`
	PhoneNumber  string `json:"phone_number" binding:"omitempty,max=16"`
}

var ErrNotFound = errors.New("profile not found")

// AvatarRoute is the upload route; the router gives it a larger body limit.
const AvatarRoute = "/api/v1/profile/avatar"

const maxAvatarBytes = 5 << 20

type Module struct {
	pool    *pgxpool.Pool
	audit   audit.Recorder
	log     *slog.Logger
	store   storage.ObjectStorage
	tracker analytics.Tracker
}

func NewModule(pool *pgxpool.Pool, recorder audit.Recorder, log *slog.Logger, store storage.ObjectStorage, tracker analytics.Tracker) *Module {
	return &Module{pool: pool, audit: recorder, log: log, store: store, tracker: tracker}
}

func (m *Module) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/profile", authz.RequirePermission(authz.PermProfileManageOwn))
	g.GET("", m.handleGet)
	g.PATCH("", m.handleUpdate)
	g.PUT("/setup", m.handleSetup)
	g.POST("/avatar", m.handleAvatarUpload)
	g.DELETE("/avatar", m.handleAvatarDelete)
	// Avatars are public by unguessable key so <img> tags work on every client.
	v1.GET("/avatars/*key", m.handleAvatarGet)
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
		SELECT p.user_id, p.display_name, p.first_name, p.last_name, p.avatar_url, p.phone_country, p.phone_number,
		       p.native_language, p.timezone, cl.code, tl.code, p.learning_goals, p.daily_goal_minutes, p.preferences,
		       p.profile_completed_at, p.onboarding_completed_at, p.updated_at
		FROM profiles p
		LEFT JOIN levels cl ON cl.id = p.current_level_id
		LEFT JOIN levels tl ON tl.id = p.target_level_id
		WHERE p.user_id = $1`, userID,
	).Scan(&p.UserID, &p.DisplayName, &p.FirstName, &p.LastName, &p.AvatarURL, &p.PhoneCountry, &p.PhoneNumber,
		&p.NativeLanguage, &p.Timezone, &p.CurrentLevel, &p.TargetLevel, &p.LearningGoals, &p.DailyGoalMinutes, &p.Preferences,
		&p.ProfileCompletedAt, &p.OnboardingCompletedAt, &p.UpdatedAt)
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

var (
	e164Pattern    = regexp.MustCompile(`^\+[1-9][0-9]{6,14}$`)
	countryPattern = regexp.MustCompile(`^[A-Z]{2}$`)
)

func (m *Module) handleSetup(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var in SetupInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	profile, firstTime, err := m.Setup(c.Request.Context(), p.UserID, in)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if firstTime {
		m.tracker.Track(c.Request.Context(), analytics.Event{Name: analytics.EventProfileSetupCompleted, UserID: &p.UserID,
			Source: "server", Platform: httpx.ClientPlatform(c), Properties: map[string]any{
				"has_phone": profile.PhoneNumber != nil, "has_avatar": profile.AvatarURL != nil,
			}})
	}
	httpx.OK(c, profile)
}

// Setup completes the account profile. It can be called again later to edit these fields.
func (m *Module) Setup(ctx context.Context, userID uuid.UUID, in SetupInput) (Profile, bool, error) {
	first, last := strings.TrimSpace(in.FirstName), strings.TrimSpace(in.LastName)
	country := strings.ToUpper(strings.TrimSpace(in.PhoneCountry))
	phone := strings.ReplaceAll(strings.TrimSpace(in.PhoneNumber), " ", "")

	fields := map[string]any{}
	if first == "" {
		fields["first_name"] = "is required"
	}
	if phone != "" && !e164Pattern.MatchString(phone) {
		fields["phone_number"] = "must be a valid international number, e.g. +998901234567"
	}
	if phone != "" && !countryPattern.MatchString(country) {
		fields["phone_country"] = "choose a country"
	}
	if len(fields) > 0 {
		return Profile{}, false, apperr.Validation(map[string]any{"fields": fields})
	}

	var wasComplete bool
	err := m.pool.QueryRow(ctx, `
		UPDATE profiles p SET first_name = $2, last_name = $3, display_name = btrim($2 || ' ' || $3),
		       phone_country = NULLIF($4, ''), phone_number = NULLIF($5, ''),
		       profile_completed_at = COALESCE(p.profile_completed_at, now())
		FROM (SELECT profile_completed_at IS NOT NULL AS was FROM profiles WHERE user_id = $1) old
		WHERE p.user_id = $1
		RETURNING old.was`, userID, first, last, country, phone).Scan(&wasComplete)
	if database.IsNotFound(err) {
		return Profile{}, false, apperr.NotFound("Profile")
	}
	if err != nil {
		return Profile{}, false, fmt.Errorf("setup profile: %w", err)
	}
	profile, err := m.Get(ctx, userID)
	return profile, !wasComplete, err
}

func avatarURL(key string) string {
	return "/api/v1/avatars/" + strings.TrimPrefix(key, "avatars/")
}

func (m *Module) handleAvatarUpload(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		httpx.Fail(c, apperr.Validation(map[string]any{"fields": map[string]any{"file": "is required"}}))
		return
	}
	defer file.Close()

	ctx := c.Request.Context()
	data, err := io.ReadAll(io.LimitReader(file, maxAvatarBytes+1))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("The image could not be read. Please try again."))
		return
	}
	allowed, err := storage.ImagePolicy(maxAvatarBytes).Validate(header.Header.Get("Content-Type"), int64(len(data)), data[:min(len(data), 512)])
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	key := storage.NewKey("avatars", p.UserID, allowed.Extension, time.Now())
	if err := m.store.Put(ctx, key, bytes.NewReader(data), int64(len(data)), allowed.Canonical); err != nil {
		logger.FromContext(ctx, m.log).Error("store avatar failed", slog.String("error", err.Error()))
		httpx.Fail(c, apperr.New(apperr.CodeUnavailable, "We couldn't upload your photo. Please try again."))
		return
	}

	var oldKey *string
	err = m.pool.QueryRow(ctx, `
		UPDATE profiles p SET avatar_storage_key = $2, avatar_url = $3
		FROM (SELECT avatar_storage_key FROM profiles WHERE user_id = $1) old
		WHERE p.user_id = $1 RETURNING old.avatar_storage_key`, p.UserID, key, avatarURL(key)).Scan(&oldKey)
	if err != nil {
		_ = m.store.Delete(context.WithoutCancel(ctx), key)
		httpx.Fail(c, err)
		return
	}
	if oldKey != nil && *oldKey != key {
		_ = m.store.Delete(context.WithoutCancel(ctx), *oldKey)
	}
	profile, err := m.Get(ctx, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, profile)
}

func (m *Module) handleAvatarDelete(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	ctx := c.Request.Context()
	var oldKey *string
	err = m.pool.QueryRow(ctx, `
		UPDATE profiles p SET avatar_storage_key = NULL, avatar_url = NULL
		FROM (SELECT avatar_storage_key FROM profiles WHERE user_id = $1) old
		WHERE p.user_id = $1 RETURNING old.avatar_storage_key`, p.UserID).Scan(&oldKey)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if oldKey != nil {
		_ = m.store.Delete(context.WithoutCancel(ctx), *oldKey)
	}
	profile, err := m.Get(ctx, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, profile)
}

func (m *Module) handleAvatarGet(c *gin.Context) {
	key := "avatars/" + strings.TrimPrefix(c.Param("key"), "/")
	if storage.ValidateKey(key) != nil {
		httpx.Fail(c, apperr.NotFound("Avatar"))
		return
	}
	ctx := c.Request.Context()
	var exists bool
	if err := m.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM profiles WHERE avatar_storage_key = $1)`, key).Scan(&exists); err != nil || !exists {
		httpx.Fail(c, apperr.NotFound("Avatar"))
		return
	}
	body, info, err := m.store.Get(ctx, key)
	if err != nil {
		httpx.Fail(c, apperr.NotFound("Avatar"))
		return
	}
	defer body.Close()
	c.DataFromReader(200, info.Size, info.ContentType, body, map[string]string{
		"Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff",
	})
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
