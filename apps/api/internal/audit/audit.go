// Package audit records security- and business-relevant actions (logins, role changes,
// content publication, subscription changes) to the audit_logs table.
package audit

import (
	"context"
	"log/slog"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

const (
	ActionRegistered     = "auth.registered"
	ActionLoggedIn       = "auth.logged_in"
	ActionLoginFailed    = "auth.login_failed"
	ActionLoggedOut      = "auth.logged_out"
	ActionTokenReuse     = "auth.refresh_token_reuse_detected"
	ActionProfileUpdated = "profile.updated"
)

type Entry struct {
	ActorID    *uuid.UUID
	Action     string
	EntityType string
	EntityID   string
	Metadata   map[string]any
	IP         string
	UserAgent  string
}

// Recorder writes audit entries. Recording is best-effort: a failed audit write is logged
// but never fails the user's request.
type Recorder interface {
	Record(ctx context.Context, e Entry)
}

type PostgresRecorder struct {
	db  database.DBTX
	log *slog.Logger
}

func NewPostgresRecorder(db database.DBTX, log *slog.Logger) *PostgresRecorder {
	return &PostgresRecorder{db: db, log: log}
}

func (r *PostgresRecorder) Record(ctx context.Context, e Entry) {
	if e.Metadata == nil {
		e.Metadata = map[string]any{}
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata, ip_address, user_agent, request_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		e.ActorID, e.Action, e.EntityType, e.EntityID, e.Metadata, e.IP, e.UserAgent, logger.RequestID(ctx),
	)
	if err != nil {
		logger.FromContext(ctx, r.log).Warn("audit log write failed",
			slog.String("action", e.Action), slog.String("error", err.Error()))
	}
}

// Nop discards entries; used in tests.
type Nop struct{}

func (Nop) Record(context.Context, Entry) {}
