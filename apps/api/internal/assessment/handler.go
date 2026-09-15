package assessment

import (
	"slices"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// RecordingRoute is the upload route; the router gives it a larger body limit.
const RecordingRoute = "/api/v1/assessments/:id/sections/:skill/recordings"

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/assessments", authz.RequirePermission(authz.PermLearningPractice))
	g.GET("", h.history)
	g.POST("", h.create)
	g.GET("/config", h.config)
	g.GET("/current", h.current)
	g.GET("/:id", h.get)
	g.POST("/:id/abandon", h.abandon)
	g.GET("/:id/result", h.result)
	g.GET("/:id/stimuli/:stimulus_id/audio", h.audio)
	g.GET("/:id/sections/:skill", h.content)
	g.POST("/:id/sections/:skill/start", h.startSection)
	g.PUT("/:id/sections/:skill/answers/:item_id", h.saveAnswer)
	g.POST("/:id/sections/:skill/recordings", h.uploadRecording)
	g.POST("/:id/sections/:skill/submit", h.submit)
	g.POST("/:id/sections/:skill/retry", h.retry)
}

type params struct {
	userID uuid.UUID
	id     uuid.UUID
	skill  string
}

func parse(c *gin.Context, needSkill bool) (params, bool) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return params{}, false
	}
	out := params{userID: p.UserID}
	if raw := c.Param("id"); raw != "" {
		if out.id, err = uuid.Parse(raw); err != nil {
			httpx.Fail(c, apperr.NotFound("Assessment"))
			return params{}, false
		}
	}
	if needSkill {
		out.skill = c.Param("skill")
		if !slices.Contains(Skills, out.skill) {
			httpx.Fail(c, apperr.NotFound("Section"))
			return params{}, false
		}
	}
	return out, true
}

func (h *Handler) history(c *gin.Context) {
	p, ok := parse(c, false)
	if !ok {
		return
	}
	list, err := h.svc.History(c.Request.Context(), p.userID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, list)
}

// create starts a placement test outside onboarding (e.g. "retake" from the profile).
// Onboarding uses PUT /onboarding/placement/start-level so its state advances too.
func (h *Handler) create(c *gin.Context) {
	p, ok := parse(c, false)
	if !ok {
		return
	}
	var in struct {
		StartLevel string `json:"start_level" binding:"required,max=4"`
	}
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	level, err := cefr.Parse(in.StartLevel)
	if err != nil {
		httpx.Fail(c, apperr.Validation(map[string]any{"fields": map[string]any{"start_level": "choose a level from A1 to C1"}}))
		return
	}
	id, err := h.svc.StartPlacement(c.Request.Context(), p.userID, level, "profile", httpx.ClientPlatform(c))
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	a, err := h.svc.Get(c.Request.Context(), p.userID, id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.Created(c, a)
}

func (h *Handler) config(c *gin.Context) {
	cfg, err := h.svc.ActiveConfig(c.Request.Context())
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, cfg)
}

func (h *Handler) current(c *gin.Context) {
	p, ok := parse(c, false)
	if !ok {
		return
	}
	a, err := h.svc.Current(c.Request.Context(), p.userID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, gin.H{"assessment": a})
}

func (h *Handler) get(c *gin.Context) {
	p, ok := parse(c, false)
	if !ok {
		return
	}
	a, err := h.svc.Get(c.Request.Context(), p.userID, p.id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, a)
}

func (h *Handler) abandon(c *gin.Context) {
	p, ok := parse(c, false)
	if !ok {
		return
	}
	if err := h.svc.AbandonPlacement(c.Request.Context(), p.userID, p.id); err != nil {
		httpx.Fail(c, err)
		return
	}
	a, err := h.svc.Get(c.Request.Context(), p.userID, p.id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, a)
}

func (h *Handler) result(c *gin.Context) {
	p, ok := parse(c, false)
	if !ok {
		return
	}
	r, err := h.svc.Result(c.Request.Context(), p.userID, p.id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, r)
}

func (h *Handler) audio(c *gin.Context) {
	p, ok := parse(c, false)
	if !ok {
		return
	}
	stimulusID, err := uuid.Parse(c.Param("stimulus_id"))
	if err != nil {
		httpx.Fail(c, apperr.NotFound("Audio"))
		return
	}
	body, info, err := h.svc.Audio(c.Request.Context(), p.userID, p.id, stimulusID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer body.Close()
	c.DataFromReader(200, info.Size, info.ContentType, body, map[string]string{"Cache-Control": "private, max-age=3600"})
}

func (h *Handler) content(c *gin.Context) {
	p, ok := parse(c, true)
	if !ok {
		return
	}
	out, err := h.svc.Content(c.Request.Context(), p.userID, p.id, p.skill)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, out)
}

func (h *Handler) startSection(c *gin.Context) {
	p, ok := parse(c, true)
	if !ok {
		return
	}
	out, err := h.svc.StartSection(c.Request.Context(), p.userID, p.id, p.skill)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, out)
}

func (h *Handler) saveAnswer(c *gin.Context) {
	p, ok := parse(c, true)
	if !ok {
		return
	}
	itemID, err := uuid.Parse(c.Param("item_id"))
	if err != nil {
		httpx.Fail(c, apperr.NotFound("Question"))
		return
	}
	var in AnswerInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	ans, err := h.svc.SaveAnswer(c.Request.Context(), p.userID, p.id, p.skill, itemID, in)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, ans)
}

func (h *Handler) uploadRecording(c *gin.Context) {
	p, ok := parse(c, true)
	if !ok {
		return
	}
	if p.skill != "speaking" {
		httpx.Fail(c, apperr.NotFound("Section"))
		return
	}
	itemID, err := uuid.Parse(c.PostForm("item_id"))
	if err != nil {
		httpx.Fail(c, apperr.Validation(map[string]any{"fields": map[string]any{"item_id": "is required"}}))
		return
	}
	duration, _ := strconv.Atoi(c.PostForm("duration_ms"))
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		httpx.Fail(c, apperr.Validation(map[string]any{"fields": map[string]any{"file": "is required"}}))
		return
	}
	defer file.Close()
	at, err := h.svc.UploadRecording(c.Request.Context(), p.userID, p.id, itemID, header.Header.Get("Content-Type"), header.Size,
		file, duration, httpx.ClientPlatform(c))
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.Created(c, at)
}

func (h *Handler) submit(c *gin.Context) {
	p, ok := parse(c, true)
	if !ok {
		return
	}
	a, err := h.svc.SubmitSection(c.Request.Context(), p.userID, p.id, p.skill)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, a)
}

func (h *Handler) retry(c *gin.Context) {
	p, ok := parse(c, true)
	if !ok {
		return
	}
	a, err := h.svc.RetryEvaluation(c.Request.Context(), p.userID, p.id, p.skill)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, a)
}
