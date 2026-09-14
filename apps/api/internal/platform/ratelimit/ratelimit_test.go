package ratelimit

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

type countingLimiter struct {
	hits map[string]int
	err  error
}

func (l *countingLimiter) Allow(_ context.Context, key string, limit int, _ time.Duration) (Decision, error) {
	if l.err != nil {
		return Decision{}, l.err
	}
	l.hits[key]++
	n := l.hits[key]
	return Decision{Allowed: n <= limit, Limit: limit, Remaining: max(limit-n, 0), RetryAfter: 30 * time.Second}, nil
}

func newRouter(l Limiter, limit int) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/login", Middleware(l, "auth", limit, time.Minute, logger.Discard()), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})
	return r
}

func post(r http.Handler) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/login", nil))
	return w
}

func TestBlocksAfterLimit(t *testing.T) {
	r := newRouter(&countingLimiter{hits: map[string]int{}}, 2)

	for i := 0; i < 2; i++ {
		if w := post(r); w.Code != http.StatusOK {
			t.Fatalf("request %d: status %d, want 200", i+1, w.Code)
		}
	}
	w := post(r)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status %d, want 429", w.Code)
	}
	if w.Header().Get("Retry-After") != "30" {
		t.Errorf("Retry-After = %q, want 30", w.Header().Get("Retry-After"))
	}
}

func TestFailsOpenWhenLimiterErrors(t *testing.T) {
	r := newRouter(&countingLimiter{err: errors.New("redis down")}, 1)
	for i := 0; i < 3; i++ {
		if w := post(r); w.Code != http.StatusOK {
			t.Fatalf("status %d, want 200 when limiter is unavailable", w.Code)
		}
	}
}
