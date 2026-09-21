package ielts

import (
	"bytes"
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

// A whole mock exam against PostgreSQL: start, sit four sections, submit, and check the band
// the learner is given. Run with:
//
//	TEST_DATABASE_URL=postgres://localhost:5432/engora_test?sslmode=disable go test -p 1 -run TestIELTSMock ./internal/ielts/

func TestIELTSMockExamFlowPostgres(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	if err := database.MigrateUp(url); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Connect(ctx, database.Options{URL: url, MaxConns: 4})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	learner, err := users.NewPostgresRepository(pool).CreateAccount(ctx, users.NewAccount{
		Email: fmt.Sprintf("ielts-%d@example.com", time.Now().UnixNano()), DisplayName: "Candidate", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, learner.ID) })

	slug := fmt.Sprintf("mock-%d", time.Now().UnixNano())
	if _, err := pool.Exec(ctx, `
		INSERT INTO ielts_exams (slug, title, description, sections, status, published_at)
		VALUES ($1, 'Academic mock 1', 'A full practice paper.', $2::jsonb, 'published', now())`,
		slug, `[
			{"skill":"listening","time_limit_seconds":1800},
			{"skill":"reading","time_limit_seconds":3600},
			{"skill":"writing","time_limit_seconds":3600},
			{"skill":"speaking","time_limit_seconds":900}
		]`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM ielts_exams WHERE slug = $1`, slug) })

	// No entitlement service: the exam itself is under test, not the paywall (which has its
	// own tests in the subscriptions package).
	module := NewModule(Deps{Pool: pool})

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: learner.ID, Role: authz.RoleUser, SessionID: uuid.New()})
		c.Next()
	})
	module.RegisterRoutes(r.Group("/api/v1"))

	call := func(method, path string, body any) (*httptest.ResponseRecorder, map[string]any) {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		req := httptest.NewRequest(method, "/api/v1"+path, &buf)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var envelope map[string]any
		if w.Body.Len() > 0 {
			_ = json.Unmarshal(w.Body.Bytes(), &envelope)
		}
		return w, envelope
	}

	w, listed := call(http.MethodGet, "/ielts/exams", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("list exams: status = %d body = %s", w.Code, w.Body.String())
	}
	exams, _ := listed["data"].([]any)
	found := false
	for _, raw := range exams {
		exam, _ := raw.(map[string]any)
		if exam["slug"] == slug {
			found = true
			if minutes, _ := exam["total_minutes"].(float64); minutes != 165 {
				t.Errorf("total_minutes = %v, want 165", exam["total_minutes"])
			}
		}
	}
	if !found {
		t.Fatal("the published exam was not listed")
	}

	w, started := call(http.MethodPost, "/ielts/exams/"+slug+"/attempts", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("start: status = %d body = %s", w.Code, w.Body.String())
	}
	attempt, _ := started["data"].(map[string]any)
	attemptID, _ := attempt["id"].(string)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM ielts_attempts WHERE id = $1`, attemptID) })

	// Starting again returns the sitting already open rather than a second one.
	if w, again := call(http.MethodPost, "/ielts/exams/"+slug+"/attempts", nil); w.Code == http.StatusOK {
		second, _ := again["data"].(map[string]any)
		if second["id"] != attemptID {
			t.Error("a second start created another sitting; only one may be open")
		}
	}

	// Sit the paper: 30/40 listening (band 7), 27/40 reading (6.5), and rubric scores for the
	// productive papers.
	for _, section := range []struct {
		skill string
		body  map[string]any
	}{
		{"listening", map[string]any{"correct": 30, "total": 40}},
		{"reading", map[string]any{"correct": 27, "total": 40}},
		{"writing", map[string]any{"rubric_score": 62}},
		{"speaking", map[string]any{"rubric_score": 72}},
	} {
		if w, _ := call(http.MethodPost, "/ielts/attempts/"+attemptID+"/sections/"+section.skill, section.body); w.Code != http.StatusOK {
			t.Fatalf("%s section: status = %d", section.skill, w.Code)
		}
	}

	if w, _ := call(http.MethodPost, "/ielts/attempts/"+attemptID+"/sections/singing", map[string]any{"rubric_score": 50}); w.Code != http.StatusBadRequest {
		t.Errorf("an unknown section: status = %d, want 400", w.Code)
	}

	w, completed := call(http.MethodPost, "/ielts/attempts/"+attemptID+"/complete", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("complete: status = %d body = %s", w.Code, w.Body.String())
	}
	result, _ := completed["data"].(map[string]any)
	if status, _ := result["status"].(string); status != "completed" {
		t.Errorf("status = %q, want completed", status)
	}
	// 7 + 6.5 + 5.5 + 6.5 = 25.5 / 4 = 6.375 → 6.5
	if band, _ := result["overall_band"].(float64); band != 6.5 {
		t.Errorf("overall_band = %v, want 6.5", result["overall_band"])
	}
	sections, _ := result["sections"].(map[string]any)
	listening, _ := sections["listening"].(map[string]any)
	if band, _ := listening["band"].(float64); band != 7 {
		t.Errorf("listening band = %v, want 7", listening["band"])
	}

	// Submitting again returns the recorded result rather than re-scoring it.
	_, repeat := call(http.MethodPost, "/ielts/attempts/"+attemptID+"/complete", nil)
	again, _ := repeat["data"].(map[string]any)
	if band, _ := again["overall_band"].(float64); band != 6.5 {
		t.Errorf("a second submission changed the band to %v", again["overall_band"])
	}

	// Another learner cannot read this sitting.
	other, err := users.NewPostgresRepository(pool).CreateAccount(ctx, users.NewAccount{
		Email: fmt.Sprintf("ielts-other-%d@example.com", time.Now().UnixNano()), DisplayName: "Other", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, other.ID) })

	r2 := gin.New()
	r2.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: other.ID, Role: authz.RoleUser, SessionID: uuid.New()})
		c.Next()
	})
	module.RegisterRoutes(r2.Group("/api/v1"))
	w2 := httptest.NewRecorder()
	r2.ServeHTTP(w2, httptest.NewRequest(http.MethodGet, "/api/v1/ielts/attempts/"+attemptID, nil))
	if w2.Code != http.StatusNotFound {
		t.Errorf("another learner reading this sitting: status = %d, want 404", w2.Code)
	}
}
