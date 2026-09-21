// Package platform hosts cross-cutting concerns; this file serves the platform's own public
// configuration to learners.
package platform

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Public settings: what the learner app needs to obey a decision the owner made.
//
// Without this endpoint the owner console would be a set of switches wired to nothing — the
// brief's actual requirement is that turning a feature off, changing a default or enabling
// maintenance reaches learners. Nothing private is included: no support email routing, no
// internal flags, only what a client legitimately needs to render itself.

type PublicSettings struct {
	SiteName    string `json:"site_name"`
	Description string `json:"site_description"`
	/** Defaults for a new account. Existing learners keep their own choices. */
	Defaults struct {
		InterfaceLanguage   string `json:"interface_language"`
		ExplanationLanguage string `json:"explanation_language"`
		Theme               string `json:"theme"`
		LandingPage         string `json:"landing_page"`
		DailyGoalMinutes    int    `json:"daily_goal_minutes"`
		PlacementTest       bool   `json:"placement_test"`
	} `json:"defaults"`
	/** Feature switches the client reads before offering something. */
	Features map[string]bool `json:"features"`
	/** Wallpaper ids the learner may choose from, in the order the owner set. */
	Wallpapers  []string `json:"wallpapers"`
	Maintenance struct {
		Enabled bool   `json:"enabled"`
		Message string `json:"message"`
	} `json:"maintenance"`
	UpdatedAt time.Time `json:"updated_at"`
}

type SettingsHandler struct {
	pool *pgxpool.Pool
}

func NewSettingsHandler(pool *pgxpool.Pool) *SettingsHandler { return &SettingsHandler{pool: pool} }

// RegisterRoutes mounts the public settings. It sits outside the authenticated group because
// the sign-in screen needs the site name and the maintenance notice too.
func (h *SettingsHandler) RegisterRoutes(r *gin.Engine, v1 *gin.RouterGroup) {
	v1.GET("/settings", h.settings)
	_ = r
}

func (h *SettingsHandler) settings(c *gin.Context) {
	var (
		out                                 PublicSettings
		general, learner, features, mainten []byte
	)
	if err := h.pool.QueryRow(c.Request.Context(), `
		SELECT general, learner, features, maintenance, updated_at FROM site_settings WHERE id`).
		Scan(&general, &learner, &features, &mainten, &out.UpdatedAt); err != nil {
		httpx.Fail(c, err)
		return
	}

	var g struct {
		SiteName    string `json:"site_name"`
		Description string `json:"site_description"`
	}
	_ = json.Unmarshal(general, &g)
	out.SiteName, out.Description = g.SiteName, g.Description
	_ = json.Unmarshal(learner, &out.Defaults)

	out.Features = map[string]bool{}
	_ = json.Unmarshal(features, &out.Features)
	_ = json.Unmarshal(mainten, &out.Maintenance)

	rows, err := h.pool.Query(c.Request.Context(),
		`SELECT id FROM wallpapers WHERE enabled ORDER BY sort_order, name`)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()
	out.Wallpapers = []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			httpx.Fail(c, err)
			return
		}
		out.Wallpapers = append(out.Wallpapers, id)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}

	// Settings change rarely and every client asks for them on load.
	c.Header("Cache-Control", "public, max-age=60")
	c.Status(http.StatusOK)
	httpx.OK(c, out)
}
