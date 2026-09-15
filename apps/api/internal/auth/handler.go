package auth

import (
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// RegisterRoutes mounts /auth under an API version group. rateLimit protects the
// credential endpoints from brute force.
func (h *Handler) RegisterRoutes(v1 *gin.RouterGroup, rateLimit gin.HandlerFunc) {
	g := v1.Group("/auth", rateLimit)
	g.POST("/register", h.register)
	g.POST("/login", h.login)
	g.POST("/refresh", h.refresh)
	g.POST("/logout", h.logout)
	g.POST("/password/forgot", h.forgotPassword)
	g.POST("/password/reset", h.resetPassword)
}

func (h *Handler) forgotPassword(c *gin.Context) {
	var in ForgotPasswordInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	if err := h.svc.ForgotPassword(c.Request.Context(), in, clientInfo(c)); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.Accepted(c, gin.H{"message": "If an account exists for this email, a reset link has been sent."})
}

func (h *Handler) resetPassword(c *gin.Context) {
	var in ResetPasswordInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	if err := h.svc.ResetPassword(c.Request.Context(), in, clientInfo(c)); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.NoContent(c)
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required,max=512"`
}

func (h *Handler) register(c *gin.Context) {
	var in RegisterInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	session, err := h.svc.Register(c.Request.Context(), in, clientInfo(c))
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.Created(c, session)
}

func (h *Handler) login(c *gin.Context) {
	var in LoginInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	session, err := h.svc.Login(c.Request.Context(), in, clientInfo(c))
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, session)
}

func (h *Handler) refresh(c *gin.Context) {
	var in refreshRequest
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	session, err := h.svc.Refresh(c.Request.Context(), in.RefreshToken, clientInfo(c))
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, session)
}

func (h *Handler) logout(c *gin.Context) {
	var in refreshRequest
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	if err := h.svc.Logout(c.Request.Context(), in.RefreshToken, clientInfo(c)); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.NoContent(c)
}

func clientInfo(c *gin.Context) ClientInfo {
	platform := strings.ToLower(c.GetHeader("X-Client-Platform"))
	switch platform {
	case "web", "ios", "android":
	default:
		platform = "unknown"
	}
	return ClientInfo{Platform: platform, UserAgent: c.Request.UserAgent(), IP: c.ClientIP()}
}

// Authenticate resolves a Bearer access token into an authz.Principal. Requests without
// an Authorization header continue anonymously; route-level authz middleware decides
// whether that is acceptable. A present but invalid token is always rejected.
func Authenticate(issuer *TokenIssuer) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" {
			c.Next()
			return
		}
		scheme, token, ok := strings.Cut(header, " ")
		if !ok || !strings.EqualFold(scheme, "Bearer") || strings.TrimSpace(token) == "" {
			c.Header("WWW-Authenticate", `Bearer error="invalid_request"`)
			httpx.WriteError(c, apperr.Unauthorized("Authorization header must be: Bearer <token>"))
			return
		}
		principal, err := issuer.Parse(strings.TrimSpace(token))
		if err != nil {
			c.Header("WWW-Authenticate", `Bearer error="invalid_token"`)
			httpx.WriteError(c, apperr.Unauthorized("Access token is invalid or has expired"))
			return
		}
		authz.SetPrincipal(c, principal)
		c.Next()
	}
}
