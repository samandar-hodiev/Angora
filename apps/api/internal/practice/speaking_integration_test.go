package practice

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/middleware"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/internal/storage"
	"github.com/samandar-hodiev/engora/apps/api/internal/subscriptions"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
)

// The speaking pipeline against PostgreSQL: store, transcribe, judge — and the failures in
// between. Run with:
//
//	TEST_DATABASE_URL=postgres://localhost:5432/engora_test?sslmode=disable go test -p 1 -run TestSpeakingPractice ./internal/practice/

type stubSpeaker struct {
	transcript     string
	seconds        float64
	failTranscribe bool
	failEvaluate   bool
	transcribes    int
	evaluates      int
}

func (s *stubSpeaker) Transcribe(_ context.Context, _ uuid.UUID, audio io.Reader, _, _ string) (*ai.TranscriptionResponse, error) {
	s.transcribes++
	_, _ = io.Copy(io.Discard, audio)
	if s.failTranscribe {
		return nil, fmt.Errorf("transcription unavailable")
	}
	return &ai.TranscriptionResponse{Text: s.transcript, DurationSeconds: s.seconds, Model: "stub"}, nil
}

func (s *stubSpeaker) EvaluateSpeaking(context.Context, ai.SpeakingAssessmentInput) (*ai.SpeakingAssessment, ai.EvaluationMeta, error) {
	s.evaluates++
	if s.failEvaluate {
		return nil, ai.EvaluationMeta{}, fmt.Errorf("evaluator unavailable")
	}
	return &ai.SpeakingAssessment{
			Fluency: 58, Grammar: 50, Vocabulary: 62, Relevance: 70, CEFREstimate: "B1", Confidence: 0.7,
			Mistakes: []ai.AssessmentMistake{
				{Category: "speaking.pronunciation", Original: "I go there yesterday", Correction: "I went there yesterday",
					Explanation: "Past time needs the past simple.", Severity: "medium"},
			},
		},
		ai.EvaluationMeta{Versions: ai.Versions{SchemaVersion: "1", ModelVersion: "stub", PromptVersion: "p1",
			RubricVersion: "r1", AnalysisVersion: "a1"}, Provider: "stub"}, nil
}

// webm returns bytes that pass audio sniffing (EBML header).
func webm() []byte {
	return append([]byte{0x1A, 0x45, 0xDF, 0xA3}, make([]byte, 800)...)
}

func TestSpeakingPracticeFlowPostgres(t *testing.T) {
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
		Email: fmt.Sprintf("speaker-%d@example.com", time.Now().UnixNano()), DisplayName: "Speaker", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, learner.ID) })

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	speaker := &stubSpeaker{
		transcript: strings.Repeat("I went to the market with my brother and we bought fruit for the week. ", 4),
		seconds:    42,
	}
	plans := subscriptions.NewService(subscriptions.NewPostgresStore(pool))
	module := NewModule(Deps{Pool: pool, Plans: plans, Usage: plans, Speaker: speaker, Storage: store,
		MaxUploadBytes: 5 << 20, Tracker: &analytics.Memory{}})

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: learner.ID, Role: authz.RoleUser, SessionID: uuid.New()})
		c.Next()
	})
	module.RegisterRoutes(r.Group("/api/v1"))

	upload := func(durationMs string) (*httptest.ResponseRecorder, map[string]any) {
		t.Helper()
		var buf bytes.Buffer
		writer := multipart.NewWriter(&buf)
		// A browser's MediaRecorder blob carries its own type; the server requires it and
		// checks it against the bytes, so the test sends what a real client sends.
		headers := textproto.MIMEHeader{}
		headers.Set("Content-Disposition", `form-data; name="audio"; filename="answer.webm"`)
		headers.Set("Content-Type", "audio/webm")
		part, err := writer.CreatePart(headers)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(webm()); err != nil {
			t.Fatal(err)
		}
		_ = writer.WriteField("duration_ms", durationMs)
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/v1/speaking/sessions", &buf)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var envelope map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &envelope)
		return w, envelope
	}

	used := func() int {
		var n int
		_ = pool.QueryRow(ctx, `
			SELECT coalesce(sum(used), 0) FROM usage_counters
			WHERE user_id = $1 AND entitlement_key = 'speaking.evaluations'`, learner.ID).Scan(&n)
		return n
	}

	t.Run("a recording becomes a report", func(t *testing.T) {
		w, body := upload("42000")
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
		}
		data, _ := body["data"].(map[string]any)
		if status, _ := data["status"].(string); status != "completed" {
			t.Errorf("status = %q, want completed", status)
		}
		if transcript, _ := data["transcript"].(string); transcript == "" {
			t.Error("the transcript must come back with the report")
		}
		feedback, _ := data["feedback"].(map[string]any)
		if feedback == nil {
			t.Fatal("no feedback returned")
		}
		if score, _ := data["overall_score"].(float64); score != 60 {
			t.Errorf("overall_score = %v, want 60", data["overall_score"])
		}
		if wpm, _ := data["words_per_minute"].(float64); wpm <= 0 {
			t.Error("words per minute was not computed")
		}

		// Each stage left its own row.
		var audio, transcripts, analyses int
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM audio_files WHERE user_id = $1`, learner.ID).Scan(&audio)
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM transcripts WHERE user_id = $1`, learner.ID).Scan(&transcripts)
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM ai_analyses WHERE user_id = $1`, learner.ID).Scan(&analyses)
		if audio != 1 || transcripts != 1 || analyses != 1 {
			t.Errorf("audio = %d, transcripts = %d, analyses = %d — each stage must record its own row", audio, transcripts, analyses)
		}

		var sessions int
		_ = pool.QueryRow(ctx, `
			SELECT coalesce(sum(sessions_count), 0) FROM skill_progress sp JOIN skills s ON s.id = sp.skill_id
			WHERE sp.user_id = $1 AND s.code = 'speaking'`, learner.ID).Scan(&sessions)
		if sessions != 1 {
			t.Errorf("speaking sessions = %d, want 1", sessions)
		}
	})

	t.Run("a recording too short to judge is refused and refunded", func(t *testing.T) {
		before := used()
		speaker.transcript = "Um."
		speaker.seconds = 2
		t.Cleanup(func() {
			speaker.transcript = strings.Repeat("I went to the market with my brother and we bought fruit. ", 4)
			speaker.seconds = 42
		})
		evaluatesBefore := speaker.evaluates

		w, _ := upload("2000")
		if w.Code != http.StatusUnprocessableEntity && w.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want a refusal for a two-second recording", w.Code)
		}
		if speaker.evaluates != evaluatesBefore {
			t.Error("the evaluator was called on a recording too short to judge")
		}
		if after := used(); after != before {
			t.Errorf("usage = %d, want %d — a refused recording must be refunded", after, before)
		}
	})

	t.Run("a transcription failure is refunded and recorded", func(t *testing.T) {
		before := used()
		speaker.failTranscribe = true
		t.Cleanup(func() { speaker.failTranscribe = false })

		w, _ := upload("30000")
		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("status = %d, want 503", w.Code)
		}
		if after := used(); after != before {
			t.Errorf("usage = %d, want %d — a failed transcription must be refunded", after, before)
		}
		var failed int
		_ = pool.QueryRow(ctx, `
			SELECT count(*) FROM speaking_sessions WHERE user_id = $1 AND status = 'failed'`, learner.ID).Scan(&failed)
		if failed == 0 {
			t.Error("the failed session must be visible rather than silently dropped")
		}
	})

	t.Run("a non-audio upload never reaches the pipeline", func(t *testing.T) {
		transcribesBefore := speaker.transcribes
		var buf bytes.Buffer
		writer := multipart.NewWriter(&buf)
		// Declared as audio, but the bytes are text: the sniff has to catch it.
		headers := textproto.MIMEHeader{}
		headers.Set("Content-Disposition", `form-data; name="audio"; filename="notes.webm"`)
		headers.Set("Content-Type", "audio/webm")
		part, _ := writer.CreatePart(headers)
		_, _ = part.Write([]byte("this is not audio, it is a text file pretending to be one"))
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/v1/speaking/sessions", &buf)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code < 400 {
			t.Fatalf("status = %d, want a refusal for a non-audio upload", w.Code)
		}
		if speaker.transcribes != transcribesBefore {
			t.Error("a text file was sent to the transcriber")
		}
	})
}
