package ai

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

// UsageRecord is one AI call as seen by cost tracking. It never contains prompts, user
// content or credentials.
type UsageRecord struct {
	ID            uuid.UUID
	UserID        *uuid.UUID
	Task          Task
	Provider      string
	Model         string
	Succeeded     bool
	Usage         Usage
	EstimatedCost float64
	Latency       time.Duration
	ErrorCode     string
	PromptVersion string
	Metadata      map[string]any
}

// UsageRecorder persists usage. Recording is best-effort and must not fail the call.
type UsageRecorder interface {
	Record(ctx context.Context, r UsageRecord)
}

type NopRecorder struct{}

func (NopRecorder) Record(context.Context, UsageRecord) {}

// PostgresUsageRecorder writes the per-call ledger (ai_requests) and the daily roll-up
// (ai_usage) in one transaction.
type PostgresUsageRecorder struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

func NewPostgresUsageRecorder(pool *pgxpool.Pool, log *slog.Logger) *PostgresUsageRecorder {
	return &PostgresUsageRecorder{pool: pool, log: log}
}

func (r *PostgresUsageRecorder) Record(ctx context.Context, rec UsageRecord) {
	status, failed := "succeeded", 0
	if !rec.Succeeded {
		status, failed = "failed", 1
	}
	if rec.Metadata == nil {
		rec.Metadata = map[string]any{}
	}

	// Detach from request cancellation: a client disconnect must not lose cost data.
	ctx = context.WithoutCancel(ctx)
	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO ai_requests (id, user_id, task, provider, model, status, input_tokens, output_tokens,
			                         audio_seconds, estimated_cost_usd, latency_ms, error_code, prompt_version,
			                         request_id, metadata)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
			rec.ID, rec.UserID, rec.Task, rec.Provider, rec.Model, status, rec.Usage.InputTokens,
			rec.Usage.OutputTokens, rec.Usage.AudioSeconds, rec.EstimatedCost, rec.Latency.Milliseconds(),
			rec.ErrorCode, rec.PromptVersion, logger.RequestID(ctx), rec.Metadata,
		); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO ai_usage (usage_date, user_id, provider, model, task, request_count, failed_count,
			                      input_tokens, output_tokens, audio_seconds, estimated_cost_usd)
			VALUES ((now() AT TIME ZONE 'UTC')::date, $1, $2, $3, $4, 1, $5, $6, $7, $8, $9)
			ON CONFLICT ON CONSTRAINT ai_usage_key DO UPDATE SET
				request_count      = ai_usage.request_count + 1,
				failed_count       = ai_usage.failed_count + EXCLUDED.failed_count,
				input_tokens       = ai_usage.input_tokens + EXCLUDED.input_tokens,
				output_tokens      = ai_usage.output_tokens + EXCLUDED.output_tokens,
				audio_seconds      = ai_usage.audio_seconds + EXCLUDED.audio_seconds,
				estimated_cost_usd = ai_usage.estimated_cost_usd + EXCLUDED.estimated_cost_usd,
				updated_at         = now()`,
			rec.UserID, rec.Provider, rec.Model, rec.Task, failed, rec.Usage.InputTokens,
			rec.Usage.OutputTokens, rec.Usage.AudioSeconds, rec.EstimatedCost,
		)
		return err
	})
	if err != nil {
		logger.FromContext(ctx, r.log).Error("ai usage record failed",
			slog.String("task", string(rec.Task)), slog.String("error", err.Error()))
	}
}
