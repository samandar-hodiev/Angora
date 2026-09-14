package jobs

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

func newTestWorker(q Queue) *Worker {
	w := NewWorker(q, logger.Discard(), observability.LogReporter{Log: logger.Discard()})
	w.PollWait = 10 * time.Millisecond
	w.JobTimeout = time.Second
	return w
}

// drain processes jobs synchronously until the queue is empty.
func drain(t *testing.T, w *Worker, q Queue) {
	t.Helper()
	for i := 0; i < 20; i++ {
		job, err := q.Reserve(context.Background(), 10*time.Millisecond)
		if err != nil {
			t.Fatal(err)
		}
		if job == nil {
			return
		}
		w.Process(context.Background(), job)
	}
	t.Fatal("queue did not drain")
}

func enqueue(t *testing.T, q Queue, jobType string) Job {
	t.Helper()
	user := uuid.New()
	job, err := New(jobType, &user, map[string]string{"audio_file_id": uuid.NewString()})
	if err != nil {
		t.Fatal(err)
	}
	if err := q.Enqueue(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	return job
}

func stateOfJob(t *testing.T, q Queue, id uuid.UUID) *State {
	t.Helper()
	s, err := q.State(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestWorkerSuccess(t *testing.T) {
	q := NewMemoryQueue(10)
	w := newTestWorker(q)
	w.Handle("test.ok", func(context.Context, *Job) (map[string]any, error) {
		return map[string]any{"analysis_id": "abc"}, nil
	})
	job := enqueue(t, q, "test.ok")
	drain(t, w, q)

	s := stateOfJob(t, q, job.ID)
	if s.Status != StatusSucceeded || s.Result["analysis_id"] != "abc" || s.Attempts != 1 {
		t.Errorf("state = %+v", s)
	}
}

func TestWorkerRetriesTransientErrors(t *testing.T) {
	q := NewMemoryQueue(10)
	w := newTestWorker(q)
	calls := 0
	w.Handle("test.flaky", func(context.Context, *Job) (map[string]any, error) {
		calls++
		if calls < 3 {
			return nil, errors.New("provider timeout")
		}
		return nil, nil
	})
	job := enqueue(t, q, "test.flaky")
	drain(t, w, q)

	s := stateOfJob(t, q, job.ID)
	if s.Status != StatusSucceeded || s.Attempts != 3 {
		t.Errorf("state = %+v, want succeeded after 3 attempts", s)
	}
}

func TestWorkerGivesUpAfterMaxAttempts(t *testing.T) {
	q := NewMemoryQueue(10)
	w := newTestWorker(q)
	w.Handle("test.broken", func(context.Context, *Job) (map[string]any, error) {
		panic("nil pointer somewhere")
	})
	job := enqueue(t, q, "test.broken")
	drain(t, w, q)

	s := stateOfJob(t, q, job.ID)
	if s.Status != StatusFailed || s.Attempts != defaultMaxAttempts || s.ErrorCode != "processing_error" {
		t.Errorf("state = %+v", s)
	}
}

func TestWorkerPermanentAndUnknown(t *testing.T) {
	q := NewMemoryQueue(10)
	w := newTestWorker(q)
	w.Handle("test.invalid", func(context.Context, *Job) (map[string]any, error) {
		return nil, Permanent("audio_unreadable", errors.New("ffprobe: invalid data"))
	})
	invalid := enqueue(t, q, "test.invalid")
	unknown := enqueue(t, q, "test.unregistered")
	drain(t, w, q)

	if s := stateOfJob(t, q, invalid.ID); s.Status != StatusFailed || s.Attempts != 1 || s.ErrorCode != "audio_unreadable" {
		t.Errorf("permanent: state = %+v", s)
	}
	if s := stateOfJob(t, q, unknown.ID); s.Status != StatusFailed || s.ErrorCode != "unknown_job_type" {
		t.Errorf("unknown: state = %+v", s)
	}
}

// TestRedisQueue runs against a real Redis when TEST_REDIS_URL is set, e.g.
// TEST_REDIS_URL=redis://localhost:6379/15 go test ./internal/jobs/
func TestRedisQueue(t *testing.T) {
	url := os.Getenv("TEST_REDIS_URL")
	if url == "" {
		t.Skip("TEST_REDIS_URL not set")
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		t.Fatal(err)
	}
	client := redis.NewClient(opts)
	defer client.Close()

	q := NewRedisQueue(client, "test-"+uuid.NewString())
	w := newTestWorker(q)
	attempts := 0
	w.Handle("test.redis", func(context.Context, *Job) (map[string]any, error) {
		attempts++
		if attempts == 1 {
			return nil, errors.New("transient")
		}
		return map[string]any{"ok": true}, nil
	})

	job := enqueue(t, q, "test.redis")
	if s := stateOfJob(t, q, job.ID); s.Status != StatusQueued {
		t.Fatalf("after enqueue: %+v", s)
	}
	drain(t, w, q)

	s := stateOfJob(t, q, job.ID)
	if s.Status != StatusSucceeded || s.Attempts != 2 || s.Result["ok"] != true {
		t.Errorf("state = %+v", s)
	}
	if n := client.LLen(context.Background(), q.processing).Val(); n != 0 {
		t.Errorf("processing list not cleaned up: %d items", n)
	}
	client.Del(context.Background(), q.queue, q.processing, q.dead, q.stateKey(job.ID))
}
