// Package ratelimit provides a fixed-window rate limiter backed by Redis and a gin
// middleware that applies it per client.
package ratelimit

import (
	"context"
	"log/slog"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"

	"github.com/samandar-hodiev/engora/apps/api/internal/platform/cache"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

type Decision struct {
	Allowed    bool
	Limit      int
	Remaining  int
	RetryAfter time.Duration
}

type Limiter interface {
	Allow(ctx context.Context, key string, limit int, window time.Duration) (Decision, error)
}

// RedisLimiter counts hits per key per fixed window using INCR + EXPIRE.
type RedisLimiter struct {
	client *redis.Client
	now    func() time.Time
}

func NewRedisLimiter(client *redis.Client) *RedisLimiter {
	return &RedisLimiter{client: client, now: time.Now}
}

func (l *RedisLimiter) Allow(ctx context.Context, key string, limit int, window time.Duration) (Decision, error) {
	now := l.now()
	windowStart := now.Truncate(window)
	redisKey := cache.Key("ratelimit", key, strconv.FormatInt(windowStart.Unix(), 10))

	var incr *redis.IntCmd
	_, err := l.client.TxPipelined(ctx, func(p redis.Pipeliner) error {
		incr = p.Incr(ctx, redisKey)
		p.Expire(ctx, redisKey, window)
		return nil
	})
	if err != nil {
		return Decision{}, err
	}

	count := int(incr.Val())
	d := Decision{Allowed: count <= limit, Limit: limit, Remaining: max(limit-count, 0)}
	if !d.Allowed {
		d.RetryAfter = windowStart.Add(window).Sub(now)
	}
	return d, nil
}

// Middleware limits requests per client IP for one named bucket (e.g. "auth").
// If Redis is unavailable it fails open and logs: an outage of a cache must not lock
// every learner out of the product.
func Middleware(l Limiter, bucket string, limit int, window time.Duration, base *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		d, err := l.Allow(c.Request.Context(), bucket+":"+c.ClientIP(), limit, window)
		if err != nil {
			logger.FromContext(c.Request.Context(), base).Warn("rate limiter unavailable, allowing request",
				slog.String("bucket", bucket), slog.String("error", err.Error()))
			c.Next()
			return
		}

		c.Header("X-RateLimit-Limit", strconv.Itoa(d.Limit))
		c.Header("X-RateLimit-Remaining", strconv.Itoa(d.Remaining))
		if !d.Allowed {
			seconds := max(int(d.RetryAfter.Seconds()), 1)
			c.Header("Retry-After", strconv.Itoa(seconds))
			httpx.WriteError(c, apperr.New(apperr.CodeRateLimited, "Too many requests, please try again later").
				WithDetails(map[string]any{"retry_after_seconds": seconds}))
			return
		}
		c.Next()
	}
}
