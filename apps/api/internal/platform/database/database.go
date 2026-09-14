// Package database owns the PostgreSQL connection pool, migrations and error helpers.
package database

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DBTX is satisfied by both *pgxpool.Pool and pgx.Tx, so repositories can run inside or
// outside a transaction without knowing which.
type DBTX interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Options struct {
	URL      string
	MaxConns int32
	// ConnectTimeout bounds the total time spent retrying the initial connection, which
	// matters when the API container starts before PostgreSQL is ready.
	ConnectTimeout time.Duration
}

// Connect creates a pool and waits until the database answers a ping.
func Connect(ctx context.Context, opts Options) (*pgxpool.Pool, error) {
	pc, err := pgxpool.ParseConfig(opts.URL)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	if opts.MaxConns > 0 {
		pc.MaxConns = opts.MaxConns
	}
	pc.MaxConnIdleTime = 5 * time.Minute
	pc.HealthCheckPeriod = 30 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, pc)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	timeout := opts.ConnectTimeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	if err := retryPing(ctx, timeout, pool.Ping); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect to postgres: %w", err)
	}
	return pool, nil
}

func retryPing(ctx context.Context, timeout time.Duration, ping func(context.Context) error) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	backoff := 250 * time.Millisecond
	for {
		pingCtx, pingCancel := context.WithTimeout(ctx, 3*time.Second)
		err := ping(pingCtx)
		pingCancel()
		if err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return err
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, 2*time.Second)
	}
}

// WithTx runs fn in a transaction, committing on success and rolling back on error.
func WithTx(ctx context.Context, pool *pgxpool.Pool, fn func(tx pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// PostgreSQL error codes used by repositories.
const (
	codeUniqueViolation     = "23505"
	codeForeignKeyViolation = "23503"
)

// IsUniqueViolation reports whether err is a unique constraint violation.
func IsUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == codeUniqueViolation
}

// IsForeignKeyViolation reports whether err is a foreign key violation.
func IsForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == codeForeignKeyViolation
}

// IsNotFound reports whether err means a query returned no rows.
func IsNotFound(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}
