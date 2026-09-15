// Package middleware contains the cross-cutting HTTP middleware shared by every API
// version: request IDs, access logging, panic recovery, central error rendering,
// security headers, CORS, body limits and metrics.
package middleware

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"runtime/debug"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

const RequestIDHeader = "X-Request-ID"

var validRequestID = regexp.MustCompile(`^[A-Za-z0-9._-]{8,64}$`)

// RequestID accepts a well-formed incoming X-Request-ID (useful for tracing through a
// gateway or from mobile clients) or generates one, and exposes it on the context, the
// request-scoped logger and the response.
func RequestID(base *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader(RequestIDHeader)
		if !validRequestID.MatchString(id) {
			id = uuid.NewString()
		}
		c.Set(httpx.RequestIDKey, id)
		c.Header(RequestIDHeader, id)

		ctx := logger.WithRequestID(c.Request.Context(), id)
		ctx = logger.WithContext(ctx, base.With(slog.String("request_id", id)))
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}

// AccessLog writes one structured line per request.
func AccessLog(base *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		route := c.FullPath()
		if route == "" {
			route = "unmatched"
		}
		status := c.Writer.Status()
		attrs := []any{
			slog.String("method", c.Request.Method),
			slog.String("route", route),
			slog.Int("status", status),
			slog.Int64("latency_ms", time.Since(start).Milliseconds()),
			slog.String("client_ip", c.ClientIP()),
			slog.Int("bytes", c.Writer.Size()),
		}
		if uid, ok := c.Get("user_id"); ok {
			attrs = append(attrs, slog.Any("user_id", uid))
		}

		log := logger.FromContext(c.Request.Context(), base)
		level := slog.LevelInfo
		switch {
		case status >= 500:
			level = slog.LevelError
		case status >= 400:
			level = slog.LevelWarn
		case strings.HasPrefix(route, "/health"):
			level = slog.LevelDebug
		}
		log.Log(c.Request.Context(), level, "http request", attrs...)
	}
}

// Recovery converts panics into a generic INTERNAL_ERROR and reports the stack trace
// internally. The client never sees panic details.
func Recovery(reporter observability.ErrorReporter) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if rec := recover(); rec != nil {
				if err, ok := rec.(error); ok && errors.Is(err, http.ErrAbortHandler) {
					panic(rec) // client went away; let net/http handle it
				}
				reporter.Report(c.Request.Context(), fmt.Errorf("panic: %v", rec),
					slog.String("stack", string(debug.Stack())),
					slog.String("route", c.FullPath()),
				)
				httpx.WriteError(c, apperr.Internal(nil))
			}
		}()
		c.Next()
	}
}

// Errors is the single place where handler errors become HTTP responses. Handlers call
// httpx.Fail(c, err); this middleware maps err to the envelope. Internal causes of 5xx
// errors are reported, never returned.
func Errors(reporter observability.ErrorReporter) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
		if len(c.Errors) == 0 || c.Writer.Written() {
			return
		}
		appErr := apperr.From(c.Errors.Last().Err)
		if appErr.Status() >= http.StatusInternalServerError {
			cause := error(appErr)
			if appErr.Err != nil {
				cause = appErr.Err
			}
			reporter.Report(c.Request.Context(), cause,
				slog.String("code", string(appErr.Code)),
				slog.String("route", c.FullPath()),
			)
		}
		httpx.WriteError(c, appErr)
	}
}

// NotFound and MethodNotAllowed keep unmatched routes on the standard envelope.
func NotFound() gin.HandlerFunc {
	return func(c *gin.Context) {
		httpx.WriteError(c, apperr.New(apperr.CodeNotFound, "Route not found"))
	}
}

func MethodNotAllowed() gin.HandlerFunc {
	return func(c *gin.Context) {
		httpx.WriteError(c, apperr.New(apperr.CodeBadRequest, "Method not allowed"))
	}
}

// SecurityHeaders sets conservative headers suitable for a JSON API.
func SecurityHeaders(production bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.Writer.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		h.Set("Cross-Origin-Resource-Policy", "same-site")
		h.Set("Permissions-Policy", "camera=(), geolocation=(), microphone=()")
		if production {
			h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
		}
		c.Next()
	}
}

// CORS allows only the configured browser origins. Native mobile apps do not send an
// Origin header and are unaffected.
func CORS(allowedOrigins []string) gin.HandlerFunc {
	allowHeaders := strings.Join([]string{
		"Authorization", "Content-Type", RequestIDHeader, "X-Client-Platform", "X-Client-Version",
	}, ", ")
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" && slices.Contains(allowedOrigins, origin) {
			h := c.Writer.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Add("Vary", "Origin")
			h.Set("Access-Control-Allow-Credentials", "true")
			h.Set("Access-Control-Expose-Headers", RequestIDHeader+", Retry-After")
			if c.Request.Method == http.MethodOptions {
				h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				h.Set("Access-Control-Allow-Headers", allowHeaders)
				h.Set("Access-Control-Max-Age", "600")
				c.AbortWithStatus(http.StatusNoContent)
				return
			}
		} else if c.Request.Method == http.MethodOptions && origin != "" {
			c.AbortWithStatus(http.StatusForbidden)
			return
		}
		c.Next()
	}
}

// BodyLimit caps request bodies. Upload endpoints install their own, larger limit.
func BodyLimit(maxBytes int64) gin.HandlerFunc {
	return BodyLimitWithOverrides(maxBytes, nil)
}

// BodyLimitWithOverrides applies maxBytes to every request except routes listed in
// overrides (keyed by the registered route path, e.g. "/api/v1/uploads/:id"), which get
// their own limit — audio uploads are far larger than JSON bodies.
func BodyLimitWithOverrides(defaultMax int64, overrides map[string]int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		maxBytes := defaultMax
		if limit, ok := overrides[c.FullPath()]; ok {
			maxBytes = limit
		}
		if c.Request.ContentLength > maxBytes {
			httpx.WriteError(c, apperr.New(apperr.CodePayloadTooLarge,
				"Request body must be at most "+strconv.FormatInt(maxBytes, 10)+" bytes"))
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
		c.Next()
	}
}

// Metrics records request counts and latency.
func Metrics(m *observability.Metrics) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		m.Begin()
		c.Next()
		m.End(c.Writer.Status(), time.Since(start))
	}
}
