package cache

import (
	"context"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
)

// GetOrLoad returns the cached JSON value at key, or calls load and caches its result.
// Redis failures degrade to calling load: the cache is an optimisation, never a
// dependency for correctness.
func GetOrLoad[T any](ctx context.Context, client *redis.Client, key string, ttl time.Duration,
	load func(context.Context) (T, error)) (T, error) {
	if client != nil {
		if raw, err := client.Get(ctx, key).Bytes(); err == nil {
			var cached T
			if json.Unmarshal(raw, &cached) == nil {
				return cached, nil
			}
		}
	}

	value, err := load(ctx)
	if err != nil {
		return value, err
	}
	if client != nil {
		if raw, err := json.Marshal(value); err == nil {
			_ = client.Set(ctx, key, raw, ttl).Err()
		}
	}
	return value, nil
}
