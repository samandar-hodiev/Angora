// Package analytics records product events without tying Engora to an analytics vendor.
//
// Business code depends on Tracker. The default implementation stores events in PostgreSQL
// (analytics_events); forwarding to a vendor (PostHog, Amplitude, ...) is another Tracker
// or a job that reads that table. State-changing events (placement_completed, ...) are
// emitted by the server where the change happens, so every client reports them identically;
// clients only send UI-only events through POST /api/v1/analytics/events.
package analytics

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

const (
	EventSignupStarted               = "signup_started"
	EventSignupCompleted             = "signup_completed"
	EventOnboardingStarted           = "onboarding_started"
	EventOnboardingCompleted         = "onboarding_completed"
	EventGoalSelected                = "goal_selected"
	EventDailyTimeSelected           = "daily_time_selected"
	EventLevelSelected               = "level_selected"
	EventPlacementStarted            = "placement_started"
	EventPlacementSectionStarted     = "placement_section_started"
	EventPlacementSectionCompleted   = "placement_section_completed"
	EventPlacementCompleted          = "placement_completed"
	EventPlacementAbandoned          = "placement_abandoned"
	EventAssessmentResultViewed      = "assessment_result_viewed"
	EventPersonalizedPlanCreated     = "personalized_plan_created"
	EventFirstLearningSessionStarted = "first_learning_session_started"
	EventSignupGoogleClicked         = "signup_google_clicked"
	EventSignupEmailClicked          = "signup_email_clicked"
	EventEmailVerificationSent       = "email_verification_sent"
	EventEmailVerificationCompleted  = "email_verification_completed"
	EventLoginStarted                = "login_started"
	EventLoginCompleted              = "login_completed"
	EventForgotPasswordStarted       = "forgot_password_started"
	EventPasswordResetCompleted      = "password_reset_completed"
	EventProfileSetupStarted         = "profile_setup_started"
	EventProfileSetupCompleted       = "profile_setup_completed"
)

// clientEvents are the events clients may report. Everything else is server-emitted.
var clientEvents = map[string]bool{
	EventSignupStarted:               true,
	EventSignupCompleted:             true,
	EventSignupGoogleClicked:         true,
	EventSignupEmailClicked:          true,
	EventLoginStarted:                true,
	EventLoginCompleted:              true,
	EventForgotPasswordStarted:       true,
	EventPasswordResetCompleted:      true,
	EventProfileSetupStarted:         true,
	EventAssessmentResultViewed:      true,
	EventFirstLearningSessionStarted: true,
}

type Event struct {
	Name        string
	UserID      *uuid.UUID
	AnonymousID string
	Properties  map[string]any
	Source      string // server | client
	Platform    string
	OccurredAt  time.Time
}

type Tracker interface {
	// Track never fails the caller: analytics must not break product flows.
	Track(ctx context.Context, e Event)
}

// Server is a convenience for server-emitted events about a user.
func Server(name string, userID uuid.UUID, props map[string]any) Event {
	return Event{Name: name, UserID: &userID, Properties: props, Source: "server"}
}

type PostgresTracker struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

func NewPostgresTracker(pool *pgxpool.Pool, log *slog.Logger) *PostgresTracker {
	return &PostgresTracker{pool: pool, log: log}
}

func (t *PostgresTracker) Track(ctx context.Context, e Event) {
	if e.Properties == nil {
		e.Properties = map[string]any{}
	}
	if e.Source == "" {
		e.Source = "server"
	}
	if e.Platform == "" {
		e.Platform = "unknown"
	}
	if e.OccurredAt.IsZero() {
		e.OccurredAt = time.Now()
	}
	// Detach from request cancellation so a closed connection does not drop the event.
	ctx = context.WithoutCancel(ctx)
	if _, err := t.pool.Exec(ctx, `
		INSERT INTO analytics_events (user_id, anonymous_id, name, properties, source, client_platform, occurred_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		e.UserID, e.AnonymousID, e.Name, e.Properties, e.Source, e.Platform, e.OccurredAt); err != nil {
		logger.FromContext(ctx, t.log).Warn("analytics event dropped",
			slog.String("event", e.Name), slog.String("error", err.Error()))
	}
}

type Nop struct{}

func (Nop) Track(context.Context, Event) {}

// Memory keeps events in memory; for tests.
type Memory struct {
	mu     sync.Mutex
	events []Event
}

func (m *Memory) Track(_ context.Context, e Event) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, e)
}

func (m *Memory) Names() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	names := make([]string, len(m.events))
	for i, e := range m.events {
		names[i] = e.Name
	}
	return names
}

// ---- client ingestion ------------------------------------------------------------------

type clientEvent struct {
	Name        string         `json:"name" binding:"required,max=64"`
	AnonymousID string         `json:"anonymous_id" binding:"omitempty,max=64"`
	Properties  map[string]any `json:"properties"`
	OccurredAt  *time.Time     `json:"occurred_at"`
}

type ingestRequest struct {
	Events []clientEvent `json:"events" binding:"required,min=1,max=20,dive"`
}

const maxPropertiesBytes = 4096

// RegisterRoutes mounts POST /analytics/events. Authentication is optional (signup_started
// happens before an account exists); rateLimit protects it from abuse.
func RegisterRoutes(v1 *gin.RouterGroup, tracker Tracker, rateLimit gin.HandlerFunc) {
	v1.POST("/analytics/events", rateLimit, func(c *gin.Context) {
		var req ingestRequest
		if err := httpx.BindJSON(c, &req); err != nil {
			httpx.Fail(c, err)
			return
		}
		var userID *uuid.UUID
		if p, ok := authz.PrincipalFrom(c); ok {
			userID = &p.UserID
		}
		platform := strings.ToLower(c.GetHeader("X-Client-Platform"))
		switch platform {
		case "web", "ios", "android":
		default:
			platform = "unknown"
		}

		now := time.Now()
		for i, ev := range req.Events {
			if !clientEvents[ev.Name] {
				httpx.Fail(c, apperr.Validation(map[string]any{"fields": map[string]any{
					"events[" + itoa(i) + "].name": "is not an accepted client event"}}))
				return
			}
			if raw, _ := json.Marshal(ev.Properties); len(raw) > maxPropertiesBytes {
				httpx.Fail(c, apperr.Validation(map[string]any{"fields": map[string]any{
					"events[" + itoa(i) + "].properties": "is too large"}}))
				return
			}
		}
		for _, ev := range req.Events {
			occurred := now
			// Accept client timestamps only within a sane window (offline queues, clock skew).
			if ev.OccurredAt != nil && ev.OccurredAt.After(now.Add(-24*time.Hour)) && ev.OccurredAt.Before(now.Add(5*time.Minute)) {
				occurred = *ev.OccurredAt
			}
			tracker.Track(c.Request.Context(), Event{
				Name: ev.Name, UserID: userID, AnonymousID: ev.AnonymousID, Properties: ev.Properties,
				Source: "client", Platform: platform, OccurredAt: occurred,
			})
		}
		httpx.Accepted(c, gin.H{"accepted": len(req.Events)})
	})
}

func itoa(i int) string {
	if i < 10 {
		return string(rune('0' + i))
	}
	return itoa(i/10) + string(rune('0'+i%10))
}
