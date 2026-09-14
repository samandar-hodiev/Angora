package middleware

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

type validateBody struct {
	Email string `json:"email" binding:"required,email"`
	Name  string `json:"display_name" binding:"required,min=2"`
}

func newRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	log := logger.Discard()
	reporter := observability.LogReporter{Log: log}

	r := gin.New()
	r.Use(RequestID(log), Recovery(reporter), SecurityHeaders(true),
		CORS([]string{"https://app.engora.test"}), BodyLimit(64), Errors(reporter))
	r.NoRoute(NotFound())

	r.GET("/internal", func(c *gin.Context) {
		httpx.Fail(c, errors.New("pq: password authentication failed for user engora"))
	})
	r.GET("/conflict", func(c *gin.Context) {
		httpx.Fail(c, apperr.Conflict("Already exists"))
	})
	r.GET("/panic", func(c *gin.Context) { panic("boom: secret stack detail") })
	r.POST("/validate", func(c *gin.Context) {
		var body validateBody
		if err := httpx.BindJSON(c, &body); err != nil {
			httpx.Fail(c, err)
			return
		}
		httpx.OK(c, body)
	})
	return r
}

func do(r http.Handler, req *http.Request) (*httptest.ResponseRecorder, httpx.Envelope) {
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var env httpx.Envelope
	_ = json.Unmarshal(w.Body.Bytes(), &env)
	return w, env
}

func TestInternalErrorsAreNotExposed(t *testing.T) {
	w, env := do(newRouter(), httptest.NewRequest(http.MethodGet, "/internal", nil))
	if w.Code != http.StatusInternalServerError || env.Error.Code != apperr.CodeInternal {
		t.Fatalf("got %d %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "password") {
		t.Errorf("internal error leaked: %s", w.Body.String())
	}
	if env.Error.RequestID == "" || env.Error.RequestID != w.Header().Get(RequestIDHeader) {
		t.Error("error body must carry the request id from the response header")
	}
}

func TestAppErrorsMapToStatus(t *testing.T) {
	w, env := do(newRouter(), httptest.NewRequest(http.MethodGet, "/conflict", nil))
	if w.Code != http.StatusConflict || env.Success || env.Error.Message != "Already exists" {
		t.Errorf("got %d %s", w.Code, w.Body.String())
	}
}

func TestPanicRecovery(t *testing.T) {
	w, env := do(newRouter(), httptest.NewRequest(http.MethodGet, "/panic", nil))
	if w.Code != http.StatusInternalServerError || env.Error.Code != apperr.CodeInternal {
		t.Fatalf("got %d %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "boom") {
		t.Errorf("panic detail leaked: %s", w.Body.String())
	}
}

func TestValidationErrorsUseJSONFieldNames(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/validate", strings.NewReader(`{"email":"nope"}`))
	w, env := do(newRouter(), req)
	if w.Code != http.StatusUnprocessableEntity || env.Error.Code != apperr.CodeValidation {
		t.Fatalf("got %d %s", w.Code, w.Body.String())
	}
	fields := env.Error.Details["fields"].(map[string]any)
	if fields["email"] != "must be a valid email address" || fields["display_name"] != "is required" {
		t.Errorf("fields = %v", fields)
	}
}

func TestMalformedAndOversizedBodies(t *testing.T) {
	r := newRouter()
	w, env := do(r, httptest.NewRequest(http.MethodPost, "/validate", strings.NewReader(`{"email":`)))
	if w.Code != http.StatusBadRequest || env.Error.Code != apperr.CodeBadRequest {
		t.Errorf("malformed: %d %s", w.Code, w.Body.String())
	}
	big := `{"email":"a@b.co","display_name":"` + strings.Repeat("x", 100) + `"}`
	w, env = do(r, httptest.NewRequest(http.MethodPost, "/validate", strings.NewReader(big)))
	if w.Code != http.StatusRequestEntityTooLarge || env.Error.Code != apperr.CodePayloadTooLarge {
		t.Errorf("oversized: %d %s", w.Code, w.Body.String())
	}
}

func TestUnknownRouteUsesEnvelope(t *testing.T) {
	w, env := do(newRouter(), httptest.NewRequest(http.MethodGet, "/api/v9/nothing", nil))
	if w.Code != http.StatusNotFound || env.Error == nil || env.Error.Code != apperr.CodeNotFound {
		t.Errorf("got %d %s", w.Code, w.Body.String())
	}
}

func TestIncomingRequestIDIsPropagated(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/conflict", nil)
	req.Header.Set(RequestIDHeader, "mobile-trace-12345")
	w, _ := do(newRouter(), req)
	if got := w.Header().Get(RequestIDHeader); got != "mobile-trace-12345" {
		t.Errorf("request id = %q", got)
	}

	req = httptest.NewRequest(http.MethodGet, "/conflict", nil)
	req.Header.Set(RequestIDHeader, "bad id\nwith injection")
	w, _ = do(newRouter(), req)
	if got := w.Header().Get(RequestIDHeader); got == "" || strings.Contains(got, "injection") {
		t.Errorf("invalid incoming request id must be replaced, got %q", got)
	}
}

func TestSecurityHeadersAndCORS(t *testing.T) {
	r := newRouter()
	req := httptest.NewRequest(http.MethodOptions, "/validate", nil)
	req.Header.Set("Origin", "https://app.engora.test")
	w, _ := do(r, req)
	if w.Code != http.StatusNoContent || w.Header().Get("Access-Control-Allow-Origin") != "https://app.engora.test" {
		t.Errorf("allowed preflight: %d %v", w.Code, w.Header())
	}

	req = httptest.NewRequest(http.MethodOptions, "/validate", nil)
	req.Header.Set("Origin", "https://evil.test")
	w, _ = do(r, req)
	if w.Code != http.StatusForbidden || w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("disallowed preflight: %d %v", w.Code, w.Header())
	}

	w, _ = do(r, httptest.NewRequest(http.MethodGet, "/conflict", nil))
	for _, h := range []string{"X-Content-Type-Options", "X-Frame-Options", "Strict-Transport-Security"} {
		if w.Header().Get(h) == "" {
			t.Errorf("missing security header %s", h)
		}
	}
}
