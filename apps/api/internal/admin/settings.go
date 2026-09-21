package admin

import (
	"encoding/json"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Site settings and the wallpaper library.
//
// Everything here is a default, never a retroactive change: a learner who has chosen a theme,
// a daily goal or a wallpaper keeps it. Turning a wallpaper off stops it being offered; it
// does not take it away from the learners already using it.

const (
	ActionSettingsUpdated  = "settings.updated"
	ActionWallpaperChanged = "wallpaper.changed"
)

type SiteSettings struct {
	General     json.RawMessage `json:"general"`
	Learner     json.RawMessage `json:"learner"`
	Features    json.RawMessage `json:"features"`
	Maintenance json.RawMessage `json:"maintenance"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

type SettingsInput struct {
	General     *json.RawMessage `json:"general"`
	Learner     *json.RawMessage `json:"learner"`
	Features    *json.RawMessage `json:"features"`
	Maintenance *json.RawMessage `json:"maintenance"`
}

func (m *Module) siteSettings(c *gin.Context) {
	var s SiteSettings
	if err := m.pool.QueryRow(c.Request.Context(), `
		SELECT general, learner, features, maintenance, updated_at FROM site_settings WHERE id`).
		Scan(&s.General, &s.Learner, &s.Features, &s.Maintenance, &s.UpdatedAt); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, s)
}

// updateSiteSettings merges each group rather than replacing the row, so two people editing
// different sections cannot overwrite each other's work.
func (m *Module) updateSiteSettings(c *gin.Context) {
	principal, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var in SettingsInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}

	changed := []string{}
	for name, value := range map[string]*json.RawMessage{
		"general": in.General, "learner": in.Learner, "features": in.Features, "maintenance": in.Maintenance,
	} {
		if value != nil {
			changed = append(changed, name)
		}
	}
	if len(changed) == 0 {
		httpx.Fail(c, apperr.BadRequest("Nothing to update"))
		return
	}

	if _, err := m.pool.Exec(c.Request.Context(), `
		UPDATE site_settings SET
			general     = general     || COALESCE($1::jsonb, '{}'::jsonb),
			learner     = learner     || COALESCE($2::jsonb, '{}'::jsonb),
			features    = features    || COALESCE($3::jsonb, '{}'::jsonb),
			maintenance = maintenance || COALESCE($4::jsonb, '{}'::jsonb),
			updated_by  = $5
		WHERE id`, in.General, in.Learner, in.Features, in.Maintenance, principal.UserID); err != nil {
		httpx.Fail(c, err)
		return
	}

	m.audit.Record(c.Request.Context(), audit.Entry{
		ActorID: &principal.UserID, Action: ActionSettingsUpdated, EntityType: "site_settings",
		EntityID: "site", Metadata: map[string]any{"groups": changed},
		IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})
	m.siteSettings(c)
}

type Wallpaper struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Enabled   bool   `json:"enabled"`
	SortOrder int    `json:"sort_order"`
	Animated  bool   `json:"animated"`
	/** How many learners have chosen it — what makes turning one off a real decision. */
	InUse     int64     `json:"in_use"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (m *Module) wallpapers(c *gin.Context) {
	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT w.id, w.name, w.enabled, w.sort_order, w.animated, w.updated_at,
		       (SELECT count(*) FROM profiles p WHERE p.preferences->>'wallpaper' = w.id)
		FROM wallpapers w
		ORDER BY w.sort_order, w.name`)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []Wallpaper{}
	for rows.Next() {
		var w Wallpaper
		if err := rows.Scan(&w.ID, &w.Name, &w.Enabled, &w.SortOrder, &w.Animated, &w.UpdatedAt, &w.InUse); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, w)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, list)
}

type WallpaperInput struct {
	Enabled   *bool `json:"enabled"`
	SortOrder *int  `json:"sort_order" binding:"omitempty,min=0,max=999"`
}

func (m *Module) updateWallpaper(c *gin.Context) {
	principal, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	id := c.Param("id")
	var in WallpaperInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}

	tag, err := m.pool.Exec(c.Request.Context(), `
		UPDATE wallpapers SET
			enabled    = COALESCE($2, enabled),
			sort_order = COALESCE($3, sort_order)
		WHERE id = $1`, id, in.Enabled, in.SortOrder)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Fail(c, apperr.NotFound("Wallpaper"))
		return
	}

	m.audit.Record(c.Request.Context(), audit.Entry{
		ActorID: &principal.UserID, Action: ActionWallpaperChanged, EntityType: "wallpaper",
		EntityID: id, Metadata: map[string]any{"enabled": in.Enabled, "sort_order": in.SortOrder},
		IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})
	m.wallpapers(c)
}
