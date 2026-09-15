package auth

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/mail"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
)

// TestGoogleLoginPostgres exercises the Google flow against real PostgreSQL repositories
// (accounts without passwords, identity linking, email verification). Run with -p 1 so it
// does not overlap the migration test:
//
//	TEST_DATABASE_URL=postgres://localhost:5432/engora_test?sslmode=disable go test -p 1 ./internal/auth/
func TestGoogleLoginPostgres(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	if err := database.MigrateUp(url); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Connect(ctx, database.Options{URL: url, MaxConns: 2})
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	stamp := time.Now().UnixNano()
	newEmail := fmt.Sprintf("google-new-%d@example.com", stamp)
	existingEmail := fmt.Sprintf("google-existing-%d@example.com", stamp)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE email IN ($1, $2)`, newEmail, existingEmail)
	})

	build := func(identity GoogleIdentity) *Service {
		svc, err := NewService(Deps{
			Users: users.NewPostgresRepository(pool), Tokens: NewPostgresTokenRepository(pool),
			Resets: NewPostgresResetStore(pool), Identities: NewPostgresIdentityStore(pool),
			Hasher: fastHasher, Issuer: NewTokenIssuer(testSecret, "engora", time.Minute),
			Audit: audit.Nop{}, Mailer: mail.Nop{}, Google: stubGoogle{identity: identity},
		}, Options{RefreshTTL: time.Hour})
		if err != nil {
			t.Fatal(err)
		}
		return svc
	}

	// New account via Google.
	svc := build(GoogleIdentity{Subject: fmt.Sprintf("sub-new-%d", stamp), Email: newEmail, Name: "Google Learner"})
	first, err := svc.LoginWithGoogle(ctx, GoogleLoginInput{IDToken: "t", Timezone: "Asia/Tashkent"}, client)
	if err != nil {
		t.Fatalf("create via Google: %v", err)
	}
	if !first.IsNewUser || first.User.EmailVerifiedAt == nil {
		t.Errorf("new Google account must be new and verified: %+v", first.User)
	}
	var displayName, timezone string
	if err := pool.QueryRow(ctx, `SELECT display_name, timezone FROM profiles WHERE user_id = $1`, first.User.ID).Scan(&displayName, &timezone); err != nil {
		t.Fatal(err)
	}
	if displayName != "Google Learner" || timezone != "Asia/Tashkent" {
		t.Errorf("profile = %q / %q", displayName, timezone)
	}
	second, err := svc.LoginWithGoogle(ctx, GoogleLoginInput{IDToken: "t"}, client)
	if err != nil || second.IsNewUser || second.User.ID != first.User.ID {
		t.Fatalf("returning Google login: %+v, %v", second.User, err)
	}
	if _, err := svc.Login(ctx, LoginInput{Email: newEmail, Password: "anything-at-all"}, client); !apperr.Is(err, apperr.CodeUnauthorized) {
		t.Errorf("password login on a Google-only account must fail, err = %v", err)
	}

	// Existing password account gets Google linked.
	existing, err := svc.Register(ctx, RegisterInput{Email: existingEmail, Password: "correct-horse", DisplayName: "Existing"}, client)
	if err != nil {
		t.Fatal(err)
	}
	linked, err := build(GoogleIdentity{Subject: fmt.Sprintf("sub-existing-%d", stamp), Email: existingEmail}).
		LoginWithGoogle(ctx, GoogleLoginInput{IDToken: "t"}, client)
	if err != nil || linked.IsNewUser || linked.User.ID != existing.User.ID {
		t.Fatalf("link existing: %+v, %v", linked.User, err)
	}
	var identities int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM user_identities WHERE user_id = $1 AND provider = 'google'`, existing.User.ID).Scan(&identities)
	if identities != 1 {
		t.Errorf("identities linked = %d, want 1", identities)
	}
}
