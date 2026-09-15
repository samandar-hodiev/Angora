// Package users owns user accounts: identity, role and account status.
// Learner-facing details (display name, goals, levels) belong to the profiles module.
package users

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
)

type Status string

const (
	StatusActive    Status = "active"
	StatusSuspended Status = "suspended"
	StatusDeleted   Status = "deleted"
)

// User is the public representation of an account. It never carries the password hash.
type User struct {
	ID              uuid.UUID  `json:"id"`
	Email           string     `json:"email"`
	Role            authz.Role `json:"role"`
	Status          Status     `json:"status"`
	EmailVerifiedAt *time.Time `json:"email_verified_at"`
	LastLoginAt     *time.Time `json:"last_login_at"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// Credentials is used only by authentication.
type Credentials struct {
	User
	PasswordHash string
}

// NewAccount creates a user and their profile atomically.
type NewAccount struct {
	Email        string
	PasswordHash string
	DisplayName  string
	Timezone     string
}

var (
	ErrNotFound   = errors.New("user not found")
	ErrEmailTaken = errors.New("email already registered")
)

type Repository interface {
	CreateAccount(ctx context.Context, in NewAccount) (User, error)
	GetByID(ctx context.Context, id uuid.UUID) (User, error)
	GetCredentialsByEmail(ctx context.Context, email string) (Credentials, error)
	TouchLastLogin(ctx context.Context, id uuid.UUID) error
	UpdatePassword(ctx context.Context, id uuid.UUID, passwordHash string) error
	List(ctx context.Context, offset, limit int) ([]User, int64, error)
}
