package jobs

import (
	"errors"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// StateView is the client representation of a job.
type StateView struct {
	ID        uuid.UUID      `json:"id"`
	Type      string         `json:"type"`
	Status    Status         `json:"status"`
	Attempts  int            `json:"attempts"`
	ErrorCode string         `json:"error_code,omitempty"`
	Result    map[string]any `json:"result,omitempty"`
	UpdatedAt time.Time      `json:"updated_at"`
}

// RegisterRoutes exposes job polling. Clients poll until status is succeeded or failed;
// realtime push (SSE / WebSocket / mobile push) can be layered on the same state later.
func RegisterRoutes(v1 *gin.RouterGroup, queue Queue) {
	v1.GET("/jobs/:id", authz.RequireAuthenticated(), func(c *gin.Context) {
		p, _ := authz.PrincipalFrom(c)
		id, err := uuid.Parse(c.Param("id"))
		if err != nil {
			httpx.Fail(c, apperr.NotFound("Job"))
			return
		}
		s, err := queue.State(c.Request.Context(), id)
		if errors.Is(err, ErrStateNotFound) {
			httpx.Fail(c, apperr.NotFound("Job"))
			return
		}
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		// Other users' jobs are reported as not found rather than forbidden.
		owner := s.UserID != nil && *s.UserID == p.UserID
		if !owner && !p.Can(authz.PermSystemRead) {
			httpx.Fail(c, apperr.NotFound("Job"))
			return
		}
		httpx.OK(c, StateView{
			ID: s.ID, Type: s.Type, Status: s.Status, Attempts: s.Attempts,
			ErrorCode: s.ErrorCode, Result: s.Result, UpdatedAt: s.UpdatedAt,
		})
	})
}
