package users

import (
	"errors"

	"github.com/gin-gonic/gin"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

type Handler struct {
	repo Repository
}

func NewHandler(repo Repository) *Handler {
	return &Handler{repo: repo}
}

func (h *Handler) RegisterRoutes(v1 *gin.RouterGroup) {
	v1.GET("/users/me", authz.RequireAuthenticated(), h.me)
	v1.GET("/admin/users", authz.RequirePermission(authz.PermUsersRead), h.list)
}

func (h *Handler) me(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	user, err := h.repo.GetByID(c.Request.Context(), p.UserID)
	if errors.Is(err, ErrNotFound) {
		httpx.Fail(c, apperr.Unauthorized("Account no longer exists"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, user)
}

func (h *Handler) list(c *gin.Context) {
	var page httpx.Pagination
	if err := httpx.BindQuery(c, &page); err != nil {
		httpx.Fail(c, err)
		return
	}
	page = page.Normalize()
	list, total, err := h.repo.List(c.Request.Context(), page.Offset(), page.PageSize)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OKWithMeta(c, list, httpx.Meta{Page: page.Page, PageSize: page.PageSize, Total: total})
}
