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
	g.POST("/google", h.google)
	g.POST("/email/start", h.emailStart)
	g.POST("/email/resend", h.emailResend)
	g.POST("/email/verify", h.emailVerify)
	g.POST("/password/set", authz.RequireAuthenticated(), h.setPassword)
	g.GET("/password/status", authz.RequireAuthenticated(), h.passwordStatus)
	g.POST("/password/forgot", h.forgotPassword)
	g.POST("/password/reset", h.resetPassword)

	// The console's own door. Rate limited with the rest, because it sends email.
	owner := g.Group("/owner")
	owner.POST("/start", h.ownerStart)
	owner.POST("/resend", h.ownerResend)
	owner.POST("/verify", h.ownerVerify)
}

type OwnerStartInput struct {
	Email string `json:"email" binding:"required,email,max=254"`
}

type OwnerVerifyInput struct {
	Email string `json:"email" binding:"required,email,max=254"`
	Code  string `json:"code" binding:"required,len=6,numeric"`
}

func (h *Handler) ownerStart(c *gin.Context) { h.ownerChallenge(c, false) }

func (h *Handler) ownerResend(c *gin.Context) { h.ownerChallenge(c, true) }

func (h *Handler) ownerChallenge(c *gin.Context, resend bool) {
	var in OwnerStartInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	send := h.svc.StartOwnerSignIn
	if resend {
		send = h.svc.ResendOwnerSignIn
	}
	ch, err := send(c.Request.Context(), in.Email, clientInfo(c))
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, ch)
}

func (h *Handler) ownerVerify(c *gin.Context) {
	var in OwnerVerifyInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	session, err := h.svc.VerifyOwnerSignIn(c.Request.Context(), in.Email, in.Code, clientInfo(c))
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, session)
}

func (h *Handler) google(c *gin.Context) {
	var in GoogleLoginInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	session, err := h.svc.LoginWithGoogle(c.Request.Context(), in, clientInfo(c))
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, session)
}

func (h *Handler) emailStart(c *gin.Context) {
	var in EmailStartInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	ch, err := h.svc.StartEmailSignup(c.Request.Context(), in, clientInfo(c))
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, ch)
}

func (h *Handler) emailResend(c *gin.Context) {
	var in EmailStartInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	ch, err := h.svc.ResendEmailSignup(c.Request.Context(), in, clientInfo(c))
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, ch)
}

func (h *Handler) emailVerify(c *gin.Context) {
	var in EmailVerifyInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	session, err := h.svc.VerifyEmailSignup(c.Request.Context(), in, clientInfo(c))
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.Created(c, session)
}

func (h *Handler) passwordStatus(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	status, err := h.svc.PasswordStatus(c.Request.Context(), p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, status)
}

func (h *Handler) setPassword(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var in SetPasswordInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	if err := h.svc.SetPassword(c.Request.Context(), p.UserID, in, clientInfo(c)); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.NoContent(c)
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

// ClientInfoFrom reads the caller's platform, agent and IP from a request. Exported because
// other modules issue email codes too, and a code's audit trail is only as good as the
// client details recorded beside it.
func ClientInfoFrom(c *gin.Context) ClientInfo { return clientInfo(c) }

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
			header = websocketAuthorization(c)
		}
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

// websocketAuthorization reads the access token from the WebSocket handshake.
//
// The browser's WebSocket API cannot set request headers, and the usual workaround — the
// token in a query string — puts a credential into access logs, proxy logs and browser
// history. Sec-WebSocket-Protocol can carry it instead: the client opens the socket with
// the subprotocols ["bearer", "<token>"], which travels as a header and is never part of
// the URL. Only upgrade requests are read this way.
func websocketAuthorization(c *gin.Context) string {
	if !strings.EqualFold(c.GetHeader("Upgrade"), "websocket") {
		return ""
	}
	parts := strings.Split(c.GetHeader("Sec-WebSocket-Protocol"), ",")
	if len(parts) < 2 || !strings.EqualFold(strings.TrimSpace(parts[0]), "bearer") {
		return ""
	}
	token := strings.TrimSpace(parts[1])
	if token == "" {
		return ""
	}
	return "Bearer " + token
}
