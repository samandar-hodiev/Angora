// Package account is what a learner can do to their own account: take their data with them,
// and close it.
//
// Both are deliberately kept out of the admin module. An owner deleting somebody else's
// account is a moderation action with different rules and a different audit trail; this is a
// person acting on their own record, and the only thing standing between a stray click and
// an irreversible deletion is a code sent to their mailbox.
package account

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/auth"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// ActionDeleted records the account ending. The entry outlives the row it describes: the
// audit log's actor is ON DELETE SET NULL, so what remains is a dated, addressed note that
// an account was deleted at this person's own request — which is exactly what anyone asking
// later ("where did my data go?") needs to see.
const ActionDeleted = "account.deleted"

// Challenger is the email-code half of the auth service. Deletion needs a code and nothing
// else from it, so that is all this module asks for.
type Challenger interface {
	StartEmailChallenge(ctx context.Context, email, purpose string, client auth.ClientInfo) (auth.EmailChallenge, error)
	ResendEmailChallenge(ctx context.Context, email, purpose string, client auth.ClientInfo) (auth.EmailChallenge, error)
	ConsumeEmailCode(ctx context.Context, email, purpose, code string) error
}

type Module struct {
	pool    *pgxpool.Pool
	codes   Challenger
	audit   audit.Recorder
	limiter gin.HandlerFunc
}

type Deps struct {
	Pool  *pgxpool.Pool
	Codes Challenger
	Audit audit.Recorder
	// Limiter is the same per-IP limit the auth routes use. Deletion sends email, so it is
	// rate limited for the same reason sign-up is.
	Limiter gin.HandlerFunc
}

func NewModule(d Deps) *Module {
	return &Module{pool: d.Pool, codes: d.Codes, audit: d.Audit, limiter: d.Limiter}
}

func (m *Module) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/account", authz.RequireAuthenticated())
	g.GET("/export", m.export)

	del := g.Group("/deletion")
	if m.limiter != nil {
		del.Use(m.limiter)
	}
	del.POST("/start", m.startDeletion)
	del.POST("/resend", m.resendDeletion)
	del.POST("/confirm", m.confirmDeletion)
}

// ---- deletion -------------------------------------------------------------------------

type ConfirmInput struct {
	// Email is typed by the person, not taken from the session. Someone who mistypes their
	// own address is someone who is not sure which account they are in, and that is a
	// moment to stop rather than to proceed.
	Email string `json:"email" binding:"required,email,max=254"`
	Code  string `json:"code" binding:"required,len=6,numeric"`
}

func (m *Module) currentEmail(c *gin.Context) (uuid.UUID, string, error) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		return uuid.Nil, "", err
	}
	var email string
	err = m.pool.QueryRow(c.Request.Context(), `SELECT email FROM users WHERE id = $1`, p.UserID).Scan(&email)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return uuid.Nil, "", err
		}
		return uuid.Nil, "", apperr.Unauthorized("This account no longer exists")
	}
	return p.UserID, email, nil
}

func (m *Module) startDeletion(c *gin.Context) { m.issue(c, false) }

func (m *Module) resendDeletion(c *gin.Context) { m.issue(c, true) }

// issue sends the deletion code to the address on the account — never to one supplied by the
// caller, which would turn "delete my account" into a way to mail arbitrary people.
func (m *Module) issue(c *gin.Context, resend bool) {
	_, email, err := m.currentEmail(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	client := auth.ClientInfoFrom(c)
	send := m.codes.StartEmailChallenge
	if resend {
		send = m.codes.ResendEmailChallenge
	}
	challenge, err := send(c.Request.Context(), email, auth.PurposeAccountDelete, client)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, challenge)
}

func (m *Module) confirmDeletion(c *gin.Context) {
	var in ConfirmInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	userID, email, err := m.currentEmail(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if !strings.EqualFold(strings.TrimSpace(in.Email), email) {
		httpx.Fail(c, apperr.Validation(map[string]any{
			"reason": "email_mismatch",
			"fields": map[string]any{"email": "This is not the email address on this account."},
		}))
		return
	}
	if err := m.codes.ConsumeEmailCode(c.Request.Context(), email, auth.PurposeAccountDelete, in.Code); err != nil {
		httpx.Fail(c, err)
		return
	}

	// Recorded before the row goes, so the entry is written while there is still an actor to
	// attribute it to. The email is copied into the metadata because the actor column is
	// about to become null.
	m.audit.Record(c.Request.Context(), audit.Entry{
		ActorID: &userID, Action: ActionDeleted, EntityType: "user", EntityID: userID.String(),
		IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
		Metadata: map[string]any{"email": email, "self_service": true},
	})

	// One statement. Every foreign key into users is ON DELETE CASCADE for the learner's own
	// rows or ON DELETE SET NULL for rows that outlive them, so this removes the account,
	// its sessions, its progress and any subscription attached to it.
	tag, err := m.pool.Exec(c.Request.Context(), `DELETE FROM users WHERE id = $1`, userID)
	if err != nil {
		httpx.Fail(c, fmt.Errorf("delete account: %w", err))
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Fail(c, apperr.Unauthorized("This account no longer exists"))
		return
	}
	c.Status(http.StatusNoContent)
}

// ---- export ---------------------------------------------------------------------------

// exportQuery gathers the learner's own record in one round trip.
//
// What it does not include is as deliberate as what it does: no password hash, no refresh
// tokens, no request logs from the AI provider. Those are credentials and operational
// plumbing, not a record of anything the learner did, and putting them in a file people
// email to themselves would be a small act of carelessness.
const exportQuery = `
SELECT json_build_object(
  'account', (SELECT to_jsonb(u) - 'password_hash' FROM users u WHERE u.id = $1),
  'profile', (SELECT to_jsonb(p) FROM profiles p WHERE p.user_id = $1),
  'levels', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM user_levels t WHERE t.user_id = $1),
  'skill_progress', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM skill_progress t WHERE t.user_id = $1),
  'streaks', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM streaks t WHERE t.user_id = $1),
  'assessments', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM assessments t WHERE t.user_id = $1),
  'assessment_results', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM assessment_results t WHERE t.user_id = $1),
  'grammar_progress', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM user_grammar_progress t WHERE t.user_id = $1),
  'grammar_attempts', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM grammar_attempts t WHERE t.user_id = $1),
  'grammar_errors', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM grammar_user_errors t WHERE t.user_id = $1),
  'vocabulary', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM user_vocabulary t WHERE t.user_id = $1),
  'vocabulary_reviews', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM vocabulary_reviews t WHERE t.user_id = $1),
  'mistakes', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM mistakes t WHERE t.user_id = $1),
  'weaknesses', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM weaknesses t WHERE t.user_id = $1),
  'writing', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM writing_submissions t WHERE t.user_id = $1),
  'speaking', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM speaking_sessions t WHERE t.user_id = $1),
  'listening', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM listening_attempts t WHERE t.user_id = $1),
  'reading', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM reading_attempts t WHERE t.user_id = $1),
  'ielts', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM ielts_attempts t WHERE t.user_id = $1),
  'coach_conversations', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM coach_conversations t WHERE t.user_id = $1),
  'learning_plans', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM learning_plans t WHERE t.user_id = $1),
  'recommendations', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM recommendations t WHERE t.user_id = $1),
  'achievements', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM user_achievements t WHERE t.user_id = $1),
  'onboarding', (SELECT to_jsonb(t) FROM onboarding_progress t WHERE t.user_id = $1),
  'notification_preferences', (SELECT to_jsonb(t) FROM notification_preferences t WHERE t.user_id = $1),
  'notifications', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM notifications t WHERE t.user_id = $1),
  'subscriptions', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM subscriptions t WHERE t.user_id = $1),
  'payments', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM payment_transactions t WHERE t.user_id = $1),
  'usage', (SELECT coalesce(json_agg(to_jsonb(t)), '[]'::json) FROM usage_counters t WHERE t.user_id = $1),
  'sign_in_methods', (SELECT coalesce(json_agg(jsonb_build_object('provider', t.provider, 'created_at', t.created_at)), '[]'::json)
                      FROM user_identities t WHERE t.user_id = $1)
)`

func (m *Module) export(c *gin.Context) {
	userID, email, err := m.currentEmail(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var raw []byte
	if err := m.pool.QueryRow(c.Request.Context(), exportQuery, userID).Scan(&raw); err != nil {
		httpx.Fail(c, fmt.Errorf("export account: %w", err))
		return
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		httpx.Fail(c, fmt.Errorf("export account: %w", err))
		return
	}
	data["exported_at"] = time.Now().UTC().Format(time.RFC3339)
	data["account_email"] = email

	// The ordinary envelope, not a file download: every client here sends a bearer token, so
	// nothing can reach this by following a link, and the client that asked for it is the one
	// that knows what to name the file.
	httpx.OK(c, data)
}
