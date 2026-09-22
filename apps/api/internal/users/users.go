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
	Email string
	// PasswordHash is empty for accounts created through an external identity (Google).
	PasswordHash string
	DisplayName  string
	Timezone     string
	// EmailVerified marks the email as verified at creation (by a code or an identity provider).
	EmailVerified bool
	// AuthProvider is how the account was created: email (default) | google | apple | phone.
	AuthProvider string
	// Role the account starts with. Empty means USER. Only two callers set it: owner sign-in
	// and the owner adding staff, both of which have already established who is asking.
	Role authz.Role
	// MustChangePassword marks a password somebody else chose. Staff accounts start this way.
	MustChangePassword bool
	// CreatedBy is the operator who created this account, for the staff list.
	CreatedBy *uuid.UUID
}

var (
	ErrNotFound   = errors.New("user not found")
	ErrEmailTaken = errors.New("email already registered")
)

type Repository interface {
	CreateAccount(ctx context.Context, in NewAccount) (User, error)
	SetRole(ctx context.Context, id uuid.UUID, role authz.Role) error
	GetByID(ctx context.Context, id uuid.UUID) (User, error)
	GetCredentialsByEmail(ctx context.Context, email string) (Credentials, error)
	TouchLastLogin(ctx context.Context, id uuid.UUID) error
	UpdatePassword(ctx context.Context, id uuid.UUID, passwordHash string) error
	MarkEmailVerified(ctx context.Context, id uuid.UUID) error
	HasPassword(ctx context.Context, id uuid.UUID) (bool, error)
	// AuthStatus returns the account's primary auth provider and whether a password is set.
	AuthStatus(ctx context.Context, id uuid.UUID) (provider string, hasPassword bool, err error)
	List(ctx context.Context, offset, limit int) ([]User, int64, error)
}
