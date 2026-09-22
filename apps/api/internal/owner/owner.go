// Package owner serves the Owner Console's own configuration.
//
// It exists to keep two things apart that were previously reached through one page called
// "Settings":
//
//   - The Learner App's configuration — default language, daily goal, placement test,
//     wallpapers, maintenance. That is platform-wide, it belongs to the product, and it
//     lives in site_settings (see internal/admin/settings.go).
//   - The Owner Console's own configuration — the language, theme, wallpaper, date format
//     and sidebar of the person looking at the screen. That is personal, it belongs to one
//     operator, and it lives here.
//
// Nothing in this package can change what a learner sees, and nothing in the learner
// settings can change this console. That is the whole point of the separation, and it is
// enforced by the tables being different rather than by a naming convention.
package owner

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/storage"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// MaxWallpaperBytes is the upload ceiling for a console background. Enforced here, on the
// server, whatever a client claims.
const MaxWallpaperBytes = 10 << 20

// WallpaperRoute is the upload route; the router gives it a larger body limit.
const WallpaperRoute = "/api/v1/admin/owner/wallpaper"

type Module struct {
	pool  *pgxpool.Pool
	store storage.ObjectStorage
	log   *slog.Logger
}

type Deps struct {
	Pool    *pgxpool.Pool
	Storage storage.ObjectStorage
	Log     *slog.Logger
}

func NewModule(d Deps) *Module { return &Module{pool: d.Pool, store: d.Storage, log: d.Log} }

// RegisterRoutes mounts the console's own settings.
//
// These are personal preferences holding no privileged data, so authentication is the only
// gate: a content manager and an analyst both need to be able to set their own console
// language, and neither holds the permissions the rest of /admin requires.
func (m *Module) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/admin/owner", authz.RequireAuthenticated())
	g.GET("/preferences", m.preferences)
	g.PATCH("/preferences", m.updatePreferences)
	g.POST("/wallpaper", m.uploadWallpaper)
	g.DELETE("/wallpaper", m.deleteWallpaper)
	g.GET("/sessions", m.sessions)
	g.DELETE("/sessions/:id", m.revokeSession)
	g.POST("/sessions/revoke-others", m.revokeOtherSessions)
	g.GET("/sign-ins", m.signIns)

	// Public read of a stored console background, served only while a preference row still
	// points at it. Same shape as the learner wallpaper route.
	v1.GET("/owner-wallpapers/*key", m.serveWallpaper)
}

type Wallpaper struct {
	URL     *string `json:"url"`
	Enabled bool    `json:"enabled"`
	/** How much the image is dimmed, 0–100. A console is tables before it is a picture. */
	Overlay int `json:"overlay"`
}

type Preferences struct {
	Locale      string    `json:"locale"`
	Theme       string    `json:"theme"`
	Timezone    string    `json:"timezone"`
	DateFormat  string    `json:"date_format"`
	TimeFormat  string    `json:"time_format"`
	SidebarMode string    `json:"sidebar_mode"`
	Wallpaper   Wallpaper `json:"wallpaper"`
	/** Which operational events this operator wants to hear about. */
	Notifications map[string]bool `json:"notifications"`
	Accessibility map[string]any  `json:"accessibility"`
	UpdatedAt     *time.Time      `json:"updated_at"`
}

// defaults are what an operator who has never opened this page gets. Uzbek because that is
// who runs this platform; dark because that is what the console already is.
func defaults() Preferences {
	return Preferences{
		Locale: "uz", Theme: "dark", Timezone: "Asia/Tashkent",
		DateFormat: "dmy", TimeFormat: "24h", SidebarMode: "remember",
		Wallpaper:     Wallpaper{Enabled: false, Overlay: 70},
		Notifications: map[string]bool{},
		Accessibility: map[string]any{},
	}
}

func (m *Module) load(ctx context.Context, userID uuid.UUID) (Preferences, error) {
	out := defaults()
	var notifications, accessibility []byte
	err := m.pool.QueryRow(ctx, `
		SELECT locale, theme, timezone, date_format, time_format, sidebar_mode,
		       wallpaper_url, wallpaper_enabled, wallpaper_overlay,
		       notifications, accessibility, updated_at
		FROM owner_preferences WHERE user_id = $1`, userID).
		Scan(&out.Locale, &out.Theme, &out.Timezone, &out.DateFormat, &out.TimeFormat, &out.SidebarMode,
			&out.Wallpaper.URL, &out.Wallpaper.Enabled, &out.Wallpaper.Overlay,
			&notifications, &accessibility, &out.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	_ = json.Unmarshal(notifications, &out.Notifications)
	_ = json.Unmarshal(accessibility, &out.Accessibility)
	if out.Notifications == nil {
		out.Notifications = map[string]bool{}
	}
	if out.Accessibility == nil {
		out.Accessibility = map[string]any{}
	}
	return out, nil
}

func (m *Module) preferences(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	prefs, err := m.load(c.Request.Context(), p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, prefs)
}

// PreferencesInput is what an operator may change about their own console. Every field is
// optional; absent means "leave it alone".
type PreferencesInput struct {
	Locale      *string `json:"locale" binding:"omitempty,oneof=uz ru en"`
	Theme       *string `json:"theme" binding:"omitempty,oneof=system dark light"`
	Timezone    *string `json:"timezone" binding:"omitempty,max=64"`
	DateFormat  *string `json:"date_format" binding:"omitempty,oneof=dmy mdy iso"`
	TimeFormat  *string `json:"time_format" binding:"omitempty,oneof=12h 24h"`
	SidebarMode *string `json:"sidebar_mode" binding:"omitempty,oneof=expanded collapsed remember"`

	WallpaperEnabled *bool `json:"wallpaper_enabled"`
	WallpaperOverlay *int  `json:"wallpaper_overlay" binding:"omitempty,min=0,max=100"`

	Notifications map[string]bool `json:"notifications"`
	Accessibility map[string]any  `json:"accessibility"`
}

func (m *Module) updatePreferences(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var in PreferencesInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	// A timezone the server cannot load would break every date the console renders.
	if in.Timezone != nil {
		if _, err := time.LoadLocation(*in.Timezone); err != nil {
			httpx.Fail(c, apperr.Validation(map[string]any{"fields": map[string]any{"timezone": "is not a known time zone"}}))
			return
		}
	}

	notifications, err := jsonOrNil(in.Notifications)
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid notification preferences"))
		return
	}
	accessibility, err := jsonOrNil(in.Accessibility)
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid accessibility preferences"))
		return
	}

	d := defaults()
	if _, err := m.pool.Exec(c.Request.Context(), `
		INSERT INTO owner_preferences (user_id, locale, theme, timezone, date_format, time_format,
		                               sidebar_mode, wallpaper_enabled, wallpaper_overlay,
		                               notifications, accessibility)
		VALUES ($1, coalesce($2::text, $12::text), coalesce($3::text, $13::text),
		        coalesce($4::text, $14::text), coalesce($5::text, $15::text),
		        coalesce($6::text, $16::text), coalesce($7::text, $17::text),
		        coalesce($8::boolean, false), coalesce($9::smallint, 70),
		        coalesce($10::jsonb, '{}'::jsonb), coalesce($11::jsonb, '{}'::jsonb))
		ON CONFLICT (user_id) DO UPDATE SET
			locale            = coalesce($2::text, owner_preferences.locale),
			theme             = coalesce($3::text, owner_preferences.theme),
			timezone          = coalesce($4::text, owner_preferences.timezone),
			date_format       = coalesce($5::text, owner_preferences.date_format),
			time_format       = coalesce($6::text, owner_preferences.time_format),
			sidebar_mode      = coalesce($7::text, owner_preferences.sidebar_mode),
			wallpaper_enabled = coalesce($8::boolean, owner_preferences.wallpaper_enabled),
			wallpaper_overlay = coalesce($9::smallint, owner_preferences.wallpaper_overlay),
			notifications     = coalesce($10::jsonb, owner_preferences.notifications),
			accessibility     = coalesce($11::jsonb, owner_preferences.accessibility)`,
		p.UserID, in.Locale, in.Theme, in.Timezone, in.DateFormat, in.TimeFormat, in.SidebarMode,
		in.WallpaperEnabled, in.WallpaperOverlay, notifications, accessibility,
		d.Locale, d.Theme, d.Timezone, d.DateFormat, d.TimeFormat, d.SidebarMode); err != nil {
		httpx.Fail(c, err)
		return
	}
	m.preferences(c)
}

func jsonOrNil(v any) ([]byte, error) {
	switch typed := v.(type) {
	case map[string]bool:
		if typed == nil {
			return nil, nil
		}
	case map[string]any:
		if typed == nil {
			return nil, nil
		}
	}
	return json.Marshal(v)
}
