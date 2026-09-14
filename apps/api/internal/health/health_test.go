package health

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func serve(checks map[string]Checker, path string) (*httptest.ResponseRecorder, map[string]any) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	NewHandler("test", checks).RegisterRoutes(r, r.Group("/api/v1"))

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	return w, body
}

func up(context.Context) error   { return nil }
func down(context.Context) error { return errors.New("dial tcp 10.0.0.5:5432: connection refused") }

func TestHealthOK(t *testing.T) {
	for _, path := range []string{"/health", "/api/v1/health"} {
		w, body := serve(map[string]Checker{"database": up, "redis": up}, path)
		if w.Code != http.StatusOK {
			t.Fatalf("%s: status %d, want 200", path, w.Code)
		}
		data := body["data"].(map[string]any)
		if data["status"] != "ok" {
			t.Errorf("%s: status = %v", path, data["status"])
		}
		checks := data["checks"].(map[string]any)
		if checks["database"].(map[string]any)["status"] != "up" {
			t.Errorf("%s: database check = %v", path, checks["database"])
		}
	}
}

func TestHealthDegradedHidesErrorDetails(t *testing.T) {
	w, body := serve(map[string]Checker{"database": down, "redis": up}, "/health")
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d, want 503", w.Code)
	}
	if body["success"] != false {
		t.Error("success must be false when degraded")
	}
	checks := body["data"].(map[string]any)["checks"].(map[string]any)
	if checks["database"].(map[string]any)["status"] != "down" || checks["redis"].(map[string]any)["status"] != "up" {
		t.Errorf("checks = %v", checks)
	}
	if got := w.Body.String(); strings.Contains(got, "10.0.0.5") || strings.Contains(got, "connection refused") {
		t.Errorf("internal error details leaked: %s", got)
	}
}

func TestLivenessHasNoDependencies(t *testing.T) {
	w, _ := serve(map[string]Checker{"database": down}, "/health/live")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", w.Code)
	}
}
