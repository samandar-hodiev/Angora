// Package httpx holds the API's HTTP conventions: the response envelope, request binding
// and validation. Every endpoint in every API version responds through these helpers so
// web and mobile clients can rely on one shape.
package httpx

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
)

// Envelope is the single response shape for every endpoint.
//
//	{ "success": true,  "data": {...}, "meta": {...} }
//	{ "success": false, "error": { "code": "...", "message": "...", "details": {...} } }
type Envelope struct {
	Success bool       `json:"success"`
	Data    any        `json:"data,omitempty"`
	Error   *ErrorBody `json:"error,omitempty"`
	Meta    *Meta      `json:"meta,omitempty"`
}

type ErrorBody struct {
	Code      apperr.Code    `json:"code"`
	Message   string         `json:"message"`
	Details   map[string]any `json:"details,omitempty"`
	RequestID string         `json:"request_id,omitempty"`
}

// Meta carries pagination and other non-resource information.
type Meta struct {
	Page     int   `json:"page,omitempty"`
	PageSize int   `json:"page_size,omitempty"`
	Total    int64 `json:"total"`
}

// RequestIDKey is the gin context key for the request ID.
const RequestIDKey = "request_id"

func OK(c *gin.Context, data any) {
	c.JSON(http.StatusOK, Envelope{Success: true, Data: data})
}

func OKWithMeta(c *gin.Context, data any, meta Meta) {
	c.JSON(http.StatusOK, Envelope{Success: true, Data: data, Meta: &meta})
}

func Created(c *gin.Context, data any) {
	c.JSON(http.StatusCreated, Envelope{Success: true, Data: data})
}

func Accepted(c *gin.Context, data any) {
	c.JSON(http.StatusAccepted, Envelope{Success: true, Data: data})
}

func NoContent(c *gin.Context) {
	c.Status(http.StatusNoContent)
}

// Fail records err for the central error middleware and stops the handler chain.
// Handlers should `httpx.Fail(c, err); return` instead of writing error JSON themselves.
func Fail(c *gin.Context, err error) {
	_ = c.Error(err)
	c.Abort()
}

// WriteError renders a client-safe error. Only the error middleware and a few
// pre-routing middlewares (panic recovery, rate limiting) call it directly.
func WriteError(c *gin.Context, e *apperr.Error) {
	c.AbortWithStatusJSON(e.Status(), Envelope{
		Success: false,
		Error: &ErrorBody{
			Code:      e.Code,
			Message:   e.Message,
			Details:   e.Details,
			RequestID: c.GetString(RequestIDKey),
		},
	})
}
