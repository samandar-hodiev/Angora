package users

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
)

const userColumns = `id, email, role, status, email_verified_at, last_login_at, created_at, updated_at`

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func scanUser(row pgx.Row, extra ...any) (User, error) {
	var u User
	dest := append([]any{&u.ID, &u.Email, &u.Role, &u.Status, &u.EmailVerifiedAt, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt}, extra...)
	return u, row.Scan(dest...)
}

// CreateAccount inserts the user and an empty profile in one transaction, so an account
// never exists without a profile regardless of which client registered it.
func (r *PostgresRepository) CreateAccount(ctx context.Context, in NewAccount) (User, error) {
	var user User
	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		var err error
		user, err = scanUser(tx.QueryRow(ctx,
			`INSERT INTO users (email, password_hash, email_verified_at, auth_provider)
			 VALUES ($1, NULLIF($2, ''), CASE WHEN $3::boolean THEN now() END, COALESCE(NULLIF($4, ''), 'email'))
			 RETURNING `+userColumns,
			in.Email, in.PasswordHash, in.EmailVerified, in.AuthProvider,
		))
		if err != nil {
			if database.IsUniqueViolation(err) {
				return ErrEmailTaken
			}
			return fmt.Errorf("insert user: %w", err)
		}
		_, err = tx.Exec(ctx,
			`INSERT INTO profiles (user_id, display_name, timezone) VALUES ($1, $2, $3)`,
			user.ID, in.DisplayName, in.Timezone,
		)
		if err != nil {
			return fmt.Errorf("insert profile: %w", err)
		}
		return nil
	})
	return user, err
}

func (r *PostgresRepository) GetByID(ctx context.Context, id uuid.UUID) (User, error) {
	u, err := scanUser(r.pool.QueryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE id = $1 AND deleted_at IS NULL`, id))
	if database.IsNotFound(err) {
		return User{}, ErrNotFound
	}
	return u, err
}

func (r *PostgresRepository) GetCredentialsByEmail(ctx context.Context, email string) (Credentials, error) {
	var hash *string
	u, err := scanUser(r.pool.QueryRow(ctx,
		`SELECT `+userColumns+`, password_hash FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
		email), &hash)
	if database.IsNotFound(err) {
		return Credentials{}, ErrNotFound
	}
	if err != nil {
		return Credentials{}, err
	}
	c := Credentials{User: u}
	if hash != nil {
		c.PasswordHash = *hash
	}
	return c, nil
}

func (r *PostgresRepository) TouchLastLogin(ctx context.Context, id uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `UPDATE users SET last_login_at = now() WHERE id = $1`, id)
	return err
}

func (r *PostgresRepository) UpdatePassword(ctx context.Context, id uuid.UUID, passwordHash string) error {
	tag, err := r.pool.Exec(ctx, `UPDATE users SET password_hash = $2 WHERE id = $1 AND deleted_at IS NULL`, id, passwordHash)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) AuthStatus(ctx context.Context, id uuid.UUID) (string, bool, error) {
	var provider string
	var has bool
	err := r.pool.QueryRow(ctx, `SELECT auth_provider, password_hash IS NOT NULL FROM users WHERE id = $1`, id).Scan(&provider, &has)
	if database.IsNotFound(err) {
		return "", false, ErrNotFound
	}
	return provider, has, err
}

func (r *PostgresRepository) HasPassword(ctx context.Context, id uuid.UUID) (bool, error) {
	var has bool
	err := r.pool.QueryRow(ctx, `SELECT password_hash IS NOT NULL FROM users WHERE id = $1`, id).Scan(&has)
	if database.IsNotFound(err) {
		return false, ErrNotFound
	}
	return has, err
}

func (r *PostgresRepository) MarkEmailVerified(ctx context.Context, id uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, id)
	return err
}

func (r *PostgresRepository) List(ctx context.Context, offset, limit int) ([]User, int64, error) {
	var total int64
	if err := r.pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE deleted_at IS NULL`).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := r.pool.Query(ctx,
		`SELECT `+userColumns+` FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC OFFSET $1 LIMIT $2`,
		offset, limit)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	list := []User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, 0, err
		}
		list = append(list, u)
	}
	return list, total, rows.Err()
}
