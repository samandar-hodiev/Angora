// Package cache owns the Redis client.
//
// Redis holds only disposable state: caches, rate-limit counters, job queues and job
// state, short-lived tokens. PostgreSQL is the source of truth; losing Redis must never
// lose learning data.
package cache

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Connect parses REDIS_URL, creates a client and waits for a successful PING.
func Connect(ctx context.Context, url string, timeout time.Duration) (*redis.Client, error) {
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("parse REDIS_URL: %w", err)
	}
	client := redis.NewClient(opts)

	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	backoff := 250 * time.Millisecond
	for {
		err = client.Ping(ctx).Err()
		if err == nil {
			return client, nil
		}
		select {
		case <-ctx.Done():
			_ = client.Close()
			return nil, fmt.Errorf("connect to redis: %w", err)
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, 2*time.Second)
	}
}

// Key builds namespaced keys ("engora:ratelimit:auth:1.2.3.4") so different concerns
// never collide and can be inspected or flushed by prefix.
func Key(parts ...string) string {
	key := "engora"
	for _, p := range parts {
		key += ":" + p
	}
	return key
}
