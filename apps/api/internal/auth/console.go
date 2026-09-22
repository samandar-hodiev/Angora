package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
)

// Owner Console sign-in.
//
// Two doors, and they are deliberately different:
//
//	the owner   signs in with a code to one configured address. No password exists to be
//	            guessed, reused or handed to anybody, and the address is set in the
//	            environment rather than in a table the platform itself can edit.
//	staff       sign in with the ordinary email-and-password login. The owner creates the
//	            account and chooses the first password out of band; the account is told to
//	            replace it.
//
// What both share is that the console checks a role afterwards. Signing in is not the same
// question as being allowed in, and conflating the two is how a learner account ends up one
// redirect away from an admin page.

const (
	PurposeConsoleSignIn = "console_signin"

	ActionConsoleSignIn        = "console.signed_in"
	ActionConsoleSignInRefused = "console.sign_in_refused"
)

func (s *Service) ownerConfigured() bool { return s.ownerEmail != "" }

// isOwnerAddress compares against the configured owner, case-insensitively. It is the only
// place that decides who the owner is.
func (s *Service) isOwnerAddress(email string) bool {
	return s.ownerConfigured() && strings.EqualFold(normalizeEmail(email), s.ownerEmail)
}

// StartOwnerSignIn emails a code to the owner.
//
// Any other address is refused outright rather than silently doing nothing. This is a
// console, not a public sign-up: somebody typing the wrong address here needs to be told
// they have the wrong door, and the address that does work is the business owner's, which
// is not a secret worth a confusing error message.
func (s *Service) StartOwnerSignIn(ctx context.Context, email string, client ClientInfo) (EmailChallenge, error) {
	if !s.ownerConfigured() {
		return EmailChallenge{}, apperr.NotImplemented("Owner sign-in")
	}
	if !s.isOwnerAddress(email) {
		s.audit.Record(ctx, audit.Entry{Action: ActionConsoleSignInRefused, EntityType: "console",
			IP: client.IP, UserAgent: client.UserAgent,
			Metadata: map[string]any{"email": normalizeEmail(email), "reason": "not_owner"}})
		return EmailChallenge{}, apperr.Forbidden("This email cannot sign in to the Owner Console.")
	}
	return s.StartEmailChallenge(ctx, s.ownerEmail, PurposeConsoleSignIn, client)
}

func (s *Service) ResendOwnerSignIn(ctx context.Context, email string, client ClientInfo) (EmailChallenge, error) {
	if !s.ownerConfigured() {
		return EmailChallenge{}, apperr.NotImplemented("Owner sign-in")
	}
	if !s.isOwnerAddress(email) {
		return EmailChallenge{}, apperr.Forbidden("This email cannot sign in to the Owner Console.")
	}
	return s.ResendEmailChallenge(ctx, s.ownerEmail, PurposeConsoleSignIn, client)
}

// VerifyOwnerSignIn checks the code and returns a session for the owner.
//
// The account is created on the first successful sign-in rather than seeded at startup. That
// keeps one rule instead of two: the owner is whoever controls the configured mailbox, and
// nothing exists until somebody proves they do. On every later sign-in the role is asserted
// again, so an owner accidentally demoted in the users table is put back by signing in.
func (s *Service) VerifyOwnerSignIn(ctx context.Context, email, code string, client ClientInfo) (Session, error) {
	if !s.ownerConfigured() {
		return Session{}, apperr.NotImplemented("Owner sign-in")
	}
	if !s.isOwnerAddress(email) {
		return Session{}, apperr.Forbidden("This email cannot sign in to the Owner Console.")
	}
	if err := s.ConsumeEmailCode(ctx, s.ownerEmail, PurposeConsoleSignIn, code); err != nil {
		return Session{}, err
	}

	creds, err := s.users.GetCredentialsByEmail(ctx, s.ownerEmail)
	switch {
	case err == nil:
		if creds.Role != authz.RoleOwner {
			if err := s.users.SetRole(ctx, creds.ID, authz.RoleOwner); err != nil {
				return Session{}, fmt.Errorf("promote owner: %w", err)
			}
			creds.Role = authz.RoleOwner
		}
	case errors.Is(err, users.ErrNotFound):
		created, err := s.users.CreateAccount(ctx, users.NewAccount{
			Email: s.ownerEmail, Timezone: "UTC", EmailVerified: true, AuthProvider: "email", Role: authz.RoleOwner,
		})
		if err != nil {
			return Session{}, fmt.Errorf("create owner account: %w", err)
		}
		creds.User = created
	default:
		return Session{}, err
	}

	s.audit.Record(ctx, audit.Entry{ActorID: &creds.ID, Action: ActionConsoleSignIn, EntityType: "console",
		EntityID: creds.ID.String(), IP: client.IP, UserAgent: client.UserAgent,
		Metadata: map[string]any{"method": "owner_code"}})
	s.tracker.Track(ctx, analytics.Event{Name: analytics.EventLoginCompleted, UserID: &creds.ID, Source: "server",
		Platform: client.Platform, Properties: map[string]any{"method": "owner_code"}})

	return s.startSession(ctx, creds.User, newFamilyID(), client)
}
