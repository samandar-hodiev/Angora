// Package health exposes liveness and readiness endpoints.
//
//	GET /health/live  process is up (no dependency checks) — container liveness probe
//	GET /health       dependencies reachable (PostgreSQL, Redis) — readiness probe
//	GET /api/v1/health same as /health, reachable through the versioned API base URL
package health

import (
	"context"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Checker returns nil when the dependency is healthy.
type Checker func(ctx context.Context) error

type CheckResult struct {
	Status    string `json:"status"`
	LatencyMs int64  `json:"latency_ms"`
}

type Report struct {
	Status  string                 `json:"status"`
	Version string                 `json:"version"`
	Time    time.Time              `json:"time"`
	Checks  map[string]CheckResult `json:"checks"`
}

type Handler struct {
	checks  map[string]Checker
	version string
	timeout time.Duration
}

func NewHandler(version string, checks map[string]Checker) *Handler {
	return &Handler{checks: checks, version: version, timeout: 2 * time.Second}
}

func (h *Handler) RegisterRoutes(root *gin.Engine, v1 *gin.RouterGroup) {
	root.GET("/health/live", h.live)
	root.GET("/health", h.ready)
	v1.GET("/health", h.ready)
}

func (h *Handler) live(c *gin.Context) {
	httpx.OK(c, gin.H{"status": "ok", "version": h.version})
}

func (h *Handler) ready(c *gin.Context) {
	report := h.Run(c.Request.Context())
	if report.Status == "ok" {
		httpx.OK(c, report)
		return
	}
	// Dependency errors are not included: they can reveal hostnames and driver details.
	c.JSON(http.StatusServiceUnavailable, httpx.Envelope{
		Success: false,
		Data:    report,
		Error: &httpx.ErrorBody{
			Code:      apperr.CodeUnavailable,
			Message:   "One or more dependencies are unavailable",
			RequestID: c.GetString(httpx.RequestIDKey),
		},
	})
}

// Run executes all checks concurrently.
func (h *Handler) Run(ctx context.Context) Report {
	ctx, cancel := context.WithTimeout(ctx, h.timeout)
	defer cancel()

	names := make([]string, 0, len(h.checks))
	for name := range h.checks {
		names = append(names, name)
	}
	sort.Strings(names)

	var mu sync.Mutex
	var wg sync.WaitGroup
	results := make(map[string]CheckResult, len(names))
	status := "ok"

	for _, name := range names {
		wg.Add(1)
		go func(name string, check Checker) {
			defer wg.Done()
			start := time.Now()
			err := check(ctx)
			res := CheckResult{Status: "up", LatencyMs: time.Since(start).Milliseconds()}
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				res.Status = "down"
				status = "degraded"
			}
			results[name] = res
		}(name, h.checks[name])
	}
	wg.Wait()

	return Report{Status: status, Version: h.version, Time: time.Now().UTC(), Checks: results}
}
