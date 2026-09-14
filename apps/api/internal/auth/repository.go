package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
)

type RefreshToken struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	FamilyID   uuid.UUID
	TokenHash  string
	Platform   string
	UserAgent  string
	IP         string
	ExpiresAt  time.Time
	RevokedAt  *time.Time
	ReplacedBy *uuid.UUID
	CreatedAt  time.Time
}

var ErrTokenNotFound = errors.New("refresh token not found")

type TokenRepository interface {
	Create(ctx context.Context, t RefreshToken) error
	GetByHash(ctx context.Context, hash string) (RefreshToken, error)
	// Rotate revokes current and stores next atomically. It returns false when current
	// was already revoked, which signals concurrent use or replay of the token.
	Rotate(ctx context.Context, currentID uuid.UUID, next RefreshToken) (bool, error)
	RevokeFamily(ctx context.Context, familyID uuid.UUID) error
}

type PostgresTokenRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresTokenRepository(pool *pgxpool.Pool) *PostgresTokenRepository {
	return &PostgresTokenRepository{pool: pool}
}

func insertToken(ctx context.Context, db database.DBTX, t RefreshToken) error {
	_, err := db.Exec(ctx, `
		INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, platform, user_agent, ip_address, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		t.ID, t.UserID, t.FamilyID, t.TokenHash, t.Platform, t.UserAgent, t.IP, t.ExpiresAt)
	return err
}

func (r *PostgresTokenRepository) Create(ctx context.Context, t RefreshToken) error {
	return insertToken(ctx, r.pool, t)
}

func (r *PostgresTokenRepository) GetByHash(ctx context.Context, hash string) (RefreshToken, error) {
	var t RefreshToken
	err := r.pool.QueryRow(ctx, `
		SELECT id, user_id, family_id, token_hash, platform, user_agent, ip_address,
		       expires_at, revoked_at, replaced_by, created_at
		FROM refresh_tokens WHERE token_hash = $1`, hash,
	).Scan(&t.ID, &t.UserID, &t.FamilyID, &t.TokenHash, &t.Platform, &t.UserAgent, &t.IP,
		&t.ExpiresAt, &t.RevokedAt, &t.ReplacedBy, &t.CreatedAt)
	if database.IsNotFound(err) {
		return RefreshToken{}, ErrTokenNotFound
	}
	return t, err
}

func (r *PostgresTokenRepository) Rotate(ctx context.Context, currentID uuid.UUID, next RefreshToken) (bool, error) {
	rotated := false
	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		if err := insertToken(ctx, tx, next); err != nil {
			return fmt.Errorf("insert rotated token: %w", err)
		}
		tag, err := tx.Exec(ctx, `
			UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2
			WHERE id = $1 AND revoked_at IS NULL`, currentID, next.ID)
		if err != nil {
			return fmt.Errorf("revoke current token: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return errAlreadyRevoked
		}
		rotated = true
		return nil
	})
	if errors.Is(err, errAlreadyRevoked) {
		return false, nil
	}
	return rotated, err
}

var errAlreadyRevoked = errors.New("token already revoked")

func (r *PostgresTokenRepository) RevokeFamily(ctx context.Context, familyID uuid.UUID) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, familyID)
	return err
}
