package cache

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestKey(t *testing.T) {
	if got := Key("ratelimit", "auth", "1.2.3.4"); got != "engora:ratelimit:auth:1.2.3.4" {
		t.Errorf("Key = %q", got)
	}
}

func TestConnectFailsFastOnBadURL(t *testing.T) {
	if _, err := Connect(context.Background(), "not a url", time.Second); err == nil {
		t.Error("expected parse error")
	}
}

// TestRedisIntegration runs when TEST_REDIS_URL is set, e.g. redis://localhost:6379/15.
func TestRedisIntegration(t *testing.T) {
	url := os.Getenv("TEST_REDIS_URL")
	if url == "" {
		t.Skip("TEST_REDIS_URL not set")
	}
	ctx := context.Background()
	client, err := Connect(ctx, url, 5*time.Second)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer client.Close()

	key := Key("test", uuid.NewString())
	defer client.Del(ctx, key)

	loads := 0
	load := func(context.Context) ([]string, error) {
		loads++
		return []string{"speaking", "writing"}, nil
	}
	for i := 0; i < 3; i++ {
		got, err := GetOrLoad(ctx, client, key, time.Minute, load)
		if err != nil || len(got) != 2 {
			t.Fatalf("GetOrLoad = %v, %v", got, err)
		}
	}
	if loads != 1 {
		t.Errorf("loader called %d times, want 1 (later calls must hit the cache)", loads)
	}
}
