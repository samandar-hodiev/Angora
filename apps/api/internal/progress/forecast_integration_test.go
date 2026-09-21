package progress

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/middleware"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
)

// The progress forecast against PostgreSQL. What matters is not that it produces a date —
// it is that it refuses to, whenever refusing is the honest answer. Run with:
//
//	TEST_DATABASE_URL=postgres://localhost:5432/engora_test?sslmode=disable go test -p 1 -run TestForecast ./internal/progress/

func TestForecastPostgres(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	if err := database.MigrateUp(dbURL); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Connect(ctx, database.Options{URL: dbURL, MaxConns: 4})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	var contentID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO content_items (type, title, status) VALUES ('reading_passage', 'Forecast fixture', 'published')
		RETURNING id`).Scan(&contentID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM content_items WHERE id = $1`, contentID) })

	repo := users.NewPostgresRepository(pool)
	newLearner := func(name string) uuid.UUID {
		t.Helper()
		u, err := repo.CreateAccount(ctx, users.NewAccount{
			Email:       fmt.Sprintf("%s-%d@example.com", name, time.Now().UnixNano()),
			DisplayName: name, Timezone: "UTC", EmailVerified: true,
		})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, u.ID) })
		_, _ = pool.Exec(ctx, `
			UPDATE profiles SET current_level_id = (SELECT id FROM levels WHERE code = 'B1') WHERE user_id = $1`, u.ID)
		return u.ID
	}

	// seed writes completed reading attempts, weeksAgo weeks in the past.
	seed := func(userID uuid.UUID, weeksAgo int, score float64, n int) {
		t.Helper()
		for i := 0; i < n; i++ {
			if _, err := pool.Exec(ctx, `
				INSERT INTO reading_attempts (user_id, content_item_id, mode, status, score, time_spent_ms, created_at, completed_at)
				VALUES ($1, $2, 'practice', 'completed', $3, 300000,
				        now() - make_interval(weeks => $4, hours => $5),
				        now() - make_interval(weeks => $4, hours => $5))`,
				userID, contentID, score, weeksAgo, i); err != nil {
				t.Fatal(err)
			}
		}
	}

	module := NewModule(pool)
	gin.SetMode(gin.TestMode)

	forecastFor := func(userID uuid.UUID) map[string]any {
		t.Helper()
		r := gin.New()
		r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
			authz.SetPrincipal(c, authz.Principal{UserID: userID, Role: authz.RoleUser, SessionID: uuid.New()})
			c.Next()
		})
		module.RegisterRoutes(r.Group("/api/v1"))

		req := httptest.NewRequest(http.MethodGet, "/api/v1/progress/forecast", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
		}
		var envelope map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &envelope)
		data, _ := envelope["data"].(map[string]any)
		return data
	}

	t.Run("a learner with almost no practice gets no forecast", func(t *testing.T) {
		learner := newLearner("newcomer")
		seed(learner, 1, 60, 2)
		d := forecastFor(learner)
		if available, _ := d["available"].(bool); available {
			t.Error("a forecast was offered from two sessions")
		}
		if reason, _ := d["reason"].(string); reason != "not_enough_practice" {
			t.Errorf("reason = %q, want not_enough_practice", reason)
		}
		if d["projected_date"] != nil {
			t.Errorf("projected_date = %v, want null", d["projected_date"])
		}
	})

	t.Run("a steady climb produces a date and a next level", func(t *testing.T) {
		learner := newLearner("climber")
		for i, score := range []float64{55, 60, 64, 69, 74, 78} {
			seed(learner, 6-i, score, 3)
		}
		d := forecastFor(learner)
		if available, _ := d["available"].(bool); !available {
			t.Fatalf("no forecast for a clear upward trend: %v", d)
		}
		if trend, _ := d["trend_per_week"].(float64); trend <= 0 {
			t.Errorf("trend_per_week = %v, want positive", d["trend_per_week"])
		}
		if next, _ := d["next_level"].(string); next != "B2" {
			t.Errorf("next_level = %q, want B2 for a B1 learner", next)
		}
		weeks, _ := d["weeks_to_next_level"].(float64)
		if weeks <= 0 || weeks > maxProjectedWeeks {
			t.Errorf("weeks_to_next_level = %v, want a plausible positive number", d["weeks_to_next_level"])
		}
		if d["projected_date"] == nil {
			t.Error("an available forecast must carry a date")
		}
		if conf, _ := d["confidence"].(float64); conf < 0.9 {
			t.Errorf("confidence = %v, want high for a nearly straight line", d["confidence"])
		}
	})

	t.Run("a flat learner is told there is no trend, not given a date", func(t *testing.T) {
		learner := newLearner("plateau")
		for i := 0; i < 6; i++ {
			seed(learner, 6-i, 62, 3)
		}
		d := forecastFor(learner)
		if available, _ := d["available"].(bool); available {
			t.Errorf("a date was projected from a flat trend: %v", d)
		}
		if reason, _ := d["reason"].(string); reason != "no_upward_trend" {
			t.Errorf("reason = %q, want no_upward_trend", reason)
		}
	})

	t.Run("a learner going backwards is never given an encouraging date", func(t *testing.T) {
		learner := newLearner("slipping")
		for i, score := range []float64{78, 74, 69, 64, 60, 55} {
			seed(learner, 6-i, score, 3)
		}
		d := forecastFor(learner)
		if available, _ := d["available"].(bool); available {
			t.Errorf("a date was projected for a falling trend: %v", d)
		}
		if trend, _ := d["trend_per_week"].(float64); trend >= 0 {
			t.Errorf("trend_per_week = %v, want negative", d["trend_per_week"])
		}
	})

	t.Run("a learner already at mastery is told they are ready now", func(t *testing.T) {
		learner := newLearner("ready")
		for i, score := range []float64{86, 87, 88, 89, 90, 92} {
			seed(learner, 6-i, score, 3)
		}
		d := forecastFor(learner)
		if reason, _ := d["reason"].(string); reason != "ready_now" {
			t.Errorf("reason = %q, want ready_now", reason)
		}
		if weeks, _ := d["weeks_to_next_level"].(float64); weeks != 0 {
			t.Errorf("weeks_to_next_level = %v, want 0", d["weeks_to_next_level"])
		}
	})
}
