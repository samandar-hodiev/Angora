// Package observability holds error reporting and basic in-process metrics.
//
// ErrorReporter is an abstraction so an error tracker (Sentry, Rollbar, ...) can be added
// later by implementing one interface; today errors are reported to the structured log.
package observability

import (
	"context"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

// ErrorReporter receives unexpected errors (5xx, panics, failed jobs).
type ErrorReporter interface {
	Report(ctx context.Context, err error, attrs ...slog.Attr)
}

// LogReporter reports errors to the structured log.
type LogReporter struct {
	Log *slog.Logger
}

func (r LogReporter) Report(ctx context.Context, err error, attrs ...slog.Attr) {
	args := make([]any, 0, len(attrs)+2)
	args = append(args, slog.String("error", err.Error()))
	for _, a := range attrs {
		args = append(args, a)
	}
	logger.FromContext(ctx, r.Log).ErrorContext(ctx, "unexpected error", args...)
}

// NewErrorReporter selects an implementation from ERROR_TRACKER.
func NewErrorReporter(kind string, log *slog.Logger) ErrorReporter {
	switch kind {
	// case "sentry": return newSentryReporter(...)
	default:
		return LogReporter{Log: log}
	}
}

// latencyBucketsMs are the upper bounds of the request latency histogram.
var latencyBucketsMs = []int64{10, 50, 100, 250, 500, 1000, 2500, 5000}

// Metrics is a dependency-free set of HTTP counters. It is intentionally small; when the
// platform needs dashboards and alerting it can be replaced by an OpenTelemetry or
// Prometheus exporter behind the same middleware.
type Metrics struct {
	startedAt     time.Time
	requests      atomic.Int64
	inFlight      atomic.Int64
	statusClasses [6]atomic.Int64 // index 1..5 => 1xx..5xx
	latency       []atomic.Int64  // len(latencyBucketsMs)+1, last is +Inf
}

func NewMetrics() *Metrics {
	return &Metrics{
		startedAt: time.Now(),
		latency:   make([]atomic.Int64, len(latencyBucketsMs)+1),
	}
}

func (m *Metrics) Begin() { m.inFlight.Add(1) }

func (m *Metrics) End(status int, elapsed time.Duration) {
	m.inFlight.Add(-1)
	m.requests.Add(1)
	if class := status / 100; class >= 1 && class <= 5 {
		m.statusClasses[class].Add(1)
	}
	ms := elapsed.Milliseconds()
	for i, bound := range latencyBucketsMs {
		if ms <= bound {
			m.latency[i].Add(1)
			return
		}
	}
	m.latency[len(latencyBucketsMs)].Add(1)
}

// Snapshot returns a JSON-friendly view of the counters.
func (m *Metrics) Snapshot() map[string]any {
	status := map[string]int64{}
	for class := 1; class <= 5; class++ {
		status[string(rune('0'+class))+"xx"] = m.statusClasses[class].Load()
	}
	latency := map[string]int64{}
	for i, bound := range latencyBucketsMs {
		latency["le_"+itoa(bound)+"ms"] = m.latency[i].Load()
	}
	latency["gt_"+itoa(latencyBucketsMs[len(latencyBucketsMs)-1])+"ms"] = m.latency[len(latencyBucketsMs)].Load()

	return map[string]any{
		"uptime_seconds":     int64(time.Since(m.startedAt).Seconds()),
		"requests_total":     m.requests.Load(),
		"requests_in_flight": m.inFlight.Load(),
		"responses_by_class": status,
		"latency_histogram":  latency,
	}
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
