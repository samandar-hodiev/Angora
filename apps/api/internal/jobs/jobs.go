// Package jobs runs long operations (AI transcription, evaluation, report generation)
// outside the HTTP request cycle.
//
//	client ──POST──▶ API: validate, store input, Enqueue ──202 {job_id}──▶ client
//	                                   │
//	                      Redis queue  ▼
//	                 worker: Reserve → handler (transcribe → analyse → save to Postgres)
//	                                   │
//	                 Finish → job state in Redis ──GET /api/v1/jobs/:id──▶ client
//
// Redis holds the queue and short-lived job state; results are always persisted to
// PostgreSQL by the handler. The Queue interface allows moving to a dedicated broker
// later without touching handlers or API modules.
package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type Status string

const (
	StatusQueued    Status = "queued"
	StatusRunning   Status = "running"
	StatusRetrying  Status = "retrying"
	StatusSucceeded Status = "succeeded"
	StatusFailed    Status = "failed"
)

// Job types are namespaced by owning module.
const (
	TypeSpeakingEvaluate = "speaking.evaluate" // Phase 2
	TypeWritingEvaluate  = "writing.evaluate"  // Phase 3
)

const defaultMaxAttempts = 3

type Job struct {
	ID          uuid.UUID       `json:"id"`
	Type        string          `json:"type"`
	UserID      *uuid.UUID      `json:"user_id,omitempty"`
	Payload     json.RawMessage `json:"payload"`
	Attempts    int             `json:"attempts"`
	MaxAttempts int             `json:"max_attempts"`
	EnqueuedAt  time.Time       `json:"enqueued_at"`

	// raw is the exact serialized form that was reserved; the Redis queue needs it to
	// remove the job from the processing list.
	raw string
}

// New creates a job with a JSON payload. userID scopes who may read its state.
func New(jobType string, userID *uuid.UUID, payload any) (Job, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return Job{}, fmt.Errorf("marshal job payload: %w", err)
	}
	return Job{
		ID:          uuid.New(),
		Type:        jobType,
		UserID:      userID,
		Payload:     raw,
		MaxAttempts: defaultMaxAttempts,
		EnqueuedAt:  time.Now().UTC(),
	}, nil
}

// State is the pollable status of a job. Result holds references (e.g. analysis_id),
// never large payloads.
type State struct {
	ID        uuid.UUID      `json:"id"`
	Type      string         `json:"type"`
	UserID    *uuid.UUID     `json:"user_id,omitempty"`
	Status    Status         `json:"status"`
	Attempts  int            `json:"attempts"`
	ErrorCode string         `json:"error_code,omitempty"`
	Result    map[string]any `json:"result,omitempty"`
	UpdatedAt time.Time      `json:"updated_at"`
}

type Outcome struct {
	Status    Status // StatusSucceeded, StatusRetrying or StatusFailed
	ErrorCode string
	Result    map[string]any
}

var ErrStateNotFound = errors.New("job state not found")

type Queue interface {
	Enqueue(ctx context.Context, job Job) error
	// Reserve waits up to wait for a job. It returns (nil, nil) when none arrived.
	Reserve(ctx context.Context, wait time.Duration) (*Job, error)
	// Finish records the outcome; StatusRetrying puts the job back on the queue.
	Finish(ctx context.Context, job *Job, outcome Outcome) error
	State(ctx context.Context, id uuid.UUID) (*State, error)
}

func stateOf(job *Job, status Status) State {
	return State{
		ID: job.ID, Type: job.Type, UserID: job.UserID, Status: status,
		Attempts: job.Attempts, UpdatedAt: time.Now().UTC(),
	}
}
