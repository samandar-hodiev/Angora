package assessment

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/jobs"
	"github.com/samandar-hodiev/engora/apps/api/internal/levels"
	"github.com/samandar-hodiev/engora/apps/api/internal/onboarding"
	"github.com/samandar-hodiev/engora/apps/api/internal/personalization"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/storage"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
)

type stubEvaluator struct{}

func (stubEvaluator) EvaluateWriting(_ context.Context, in ai.WritingAssessmentInput) (*ai.WritingAssessment, ai.EvaluationMeta, error) {
	return &ai.WritingAssessment{TaskResponse: 62, Grammar: 48, Vocabulary: 64, Coherence: 58, CEFREstimate: "B1", Confidence: 0.8,
			Mistakes: []ai.AssessmentMistake{{Category: "grammar.tense.past_simple", Original: "I go", Correction: "I went", Explanation: "Past", Severity: "medium"}}},
		ai.EvaluationMeta{Versions: ai.Versions{SchemaVersion: ai.PlacementSchemaVersion, ModelVersion: "stub", PromptVersion: "p", RubricVersion: "r", AnalysisVersion: "a"}, Provider: "stub"}, nil
}

func (stubEvaluator) EvaluateSpeaking(_ context.Context, in ai.SpeakingAssessmentInput) (*ai.SpeakingAssessment, ai.EvaluationMeta, error) {
	return &ai.SpeakingAssessment{Fluency: 60, Grammar: 55, Vocabulary: 58, Relevance: 70, CEFREstimate: "B1", Confidence: 0.7, Mistakes: []ai.AssessmentMistake{}},
		ai.EvaluationMeta{Versions: ai.Versions{SchemaVersion: ai.PlacementSchemaVersion, ModelVersion: "stub", PromptVersion: "p", RubricVersion: "r", AnalysisVersion: "a"}, Provider: "stub"}, nil
}

func (stubEvaluator) Transcribe(_ context.Context, _ uuid.UUID, audio io.Reader, _, _ string) (*ai.TranscriptionResponse, error) {
	_, _ = io.Copy(io.Discard, audio)
	return &ai.TranscriptionResponse{Text: strings.Repeat("I like my hometown because it is green and calm ", 8), DurationSeconds: 50, Model: "stub"}, nil
}

// webm returns bytes that pass audio sniffing (EBML header), distinct per variant.
func webm(variant byte) []byte {
	b := append([]byte{0x1A, 0x45, 0xDF, 0xA3}, make([]byte, 600)...)
	b[100] = variant
	return b
}

// TestPlacementFlowPostgres drives the whole onboarding placement journey against PostgreSQL:
// goals → daily time → find my level → four sequential sections → AI evaluation jobs →
// results → personalised plan → completed onboarding, plus timer expiry, idempotency,
// retake limits and abandoning. Run with:
//
//	TEST_DATABASE_URL=... go test -p 1 -run TestPlacementFlowPostgres ./internal/assessment/
func TestPlacementFlowPostgres(t *testing.T) {
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
	defer pool.Close()
	var items int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM assessment_items WHERE status = 'published'`).Scan(&items)
	if items == 0 {
		t.Skip("placement content not seeded (go run ./cmd/seed placement)")
	}

	user, err := users.NewPostgresRepository(pool).CreateAccount(ctx, users.NewAccount{
		Email: fmt.Sprintf("placement-%d@example.com", time.Now().UnixNano()), DisplayName: "Placement Learner", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, user.ID) })

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	queue := jobs.NewMemoryQueue(16)
	tracker := &analytics.Memory{}
	plans := personalization.NewService(pool, tracker)
	onb := onboarding.NewService(pool, plans, tracker)
	svc := NewService(Deps{Pool: pool, Storage: store, Queue: queue, Evaluator: stubEvaluator{}, Plans: plans, Progress: onb,
		Tracker: tracker, Log: slog.New(slog.DiscardHandler), MaxUploadBytes: 5 << 20})
	onb.SetPlacement(svc)
	uid := user.ID

	// Account setup must come before onboarding.
	if _, err := onb.Start(ctx, uid); !apperr.Is(err, apperr.CodeConflict) {
		t.Fatalf("onboarding before profile setup should conflict, got %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE profiles SET profile_completed_at = now() WHERE user_id = $1`, uid); err != nil {
		t.Fatal(err)
	}

	must := func(st onboarding.State, err error) onboarding.State {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		return st
	}
	must(onb.Start(ctx, uid))
	must(onb.SetGoals(ctx, uid, []string{"speak_confidently", "work"}))
	must(onb.SetDailyTime(ctx, uid, 30))
	must(onb.ChoosePlacement(ctx, uid))
	must(onb.Navigate(ctx, uid, onboarding.StepPlacementStartLevel))
	st := must(onb.StartPlacement(ctx, uid, "B1", "web"))
	if st.Step != onboarding.StepPlacementReading || st.AssessmentID == nil || st.PlacementStartLevel == nil || st.PlacementStartLevel.String() != "B1" {
		t.Fatalf("after start: %+v", st)
	}
	id := *st.AssessmentID
	if again := must(onb.StartPlacement(ctx, uid, "B1", "web")); *again.AssessmentID != id {
		t.Error("starting twice must return the same assessment")
	}

	// Sections unlock strictly in order.
	if _, err := svc.StartSection(ctx, uid, id, "writing"); !apperr.Is(err, apperr.CodeConflict) {
		t.Errorf("writing should be locked, got %v", err)
	}

	// Reading: every answer correct.
	reading, err := svc.StartSection(ctx, uid, id, "reading")
	if err != nil {
		t.Fatal(err)
	}
	if len(reading.Items) != 10 || reading.Section.DeadlineAt == nil || len(reading.Stimuli) == 0 {
		t.Fatalf("reading content: %d items, stimuli %d", len(reading.Items), len(reading.Stimuli))
	}
	for _, it := range reading.Items {
		var key string
		if err := pool.QueryRow(ctx, `SELECT answer_key->>'option_id' FROM assessment_items WHERE id = $1`, it.ID).Scan(&key); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.SaveAnswer(ctx, uid, id, "reading", it.ID, AnswerInput{Response: json.RawMessage(`{"option_id":"` + key + `"}`)}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.SaveAnswer(ctx, uid, id, "reading", reading.Items[0].ID, AnswerInput{Response: json.RawMessage(`{"option_id":"zz"}`)}); !apperr.Is(err, apperr.CodeValidation) {
		t.Errorf("unknown option must be rejected, got %v", err)
	}
	resumed, err := svc.Content(ctx, uid, id, "reading")
	if err != nil || len(resumed.Answers) != 10 {
		t.Fatalf("answers must survive a refresh: %d, %v", len(resumed.Answers), err)
	}
	a, err := svc.SubmitSection(ctx, uid, id, "reading")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SubmitSection(ctx, uid, id, "reading"); err != nil {
		t.Errorf("duplicate submit must be a no-op, got %v", err)
	}
	if a.Sections[0].Status != SectionCompleted || a.Sections[1].Status != SectionAvailable || *a.CurrentSkill != "listening" {
		t.Fatalf("after reading: %+v", a.Sections)
	}
	if st := must(onb.Get(ctx, uid)); st.Step != onboarding.StepPlacementListening {
		t.Errorf("onboarding step = %s", st.Step)
	}

	// Listening: no answers. The transcript stays hidden until the section is submitted.
	listening, err := svc.StartSection(ctx, uid, id, "listening")
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range listening.Stimuli {
		if s.Transcript != nil {
			t.Error("transcript must be hidden during the section")
		}
	}
	if _, err := svc.SubmitSection(ctx, uid, id, "listening"); err != nil {
		t.Fatal(err)
	}
	if review, _ := svc.Content(ctx, uid, id, "listening"); len(review.Stimuli) > 0 && review.Stimuli[0].Transcript == nil {
		t.Error("transcript should be available after submission")
	}

	// Writing: saved draft, submitted, evaluated by a job.
	writing, err := svc.StartSection(ctx, uid, id, "writing")
	if err != nil {
		t.Fatal(err)
	}
	essay := strings.Repeat("Last summer I travelled to Samarkand with my family and we visited beautiful old buildings. ", 12)
	if _, err := svc.SaveAnswer(ctx, uid, id, "writing", writing.Items[0].ID, AnswerInput{Response: json.RawMessage(`{"text":` + mustJSON(essay) + `}`)}); err != nil {
		t.Fatal(err)
	}
	if a, err = svc.SubmitSection(ctx, uid, id, "writing"); err != nil || a.Sections[2].Status != SectionEvaluating || a.Sections[3].Status != SectionAvailable {
		t.Fatalf("after writing: %+v %v", a.Sections, err)
	}
	runJobs(t, queue, svc)

	// Speaking: two tasks, retake limit and idempotent re-upload.
	speaking, err := svc.StartSection(ctx, uid, id, "speaking")
	if err != nil {
		t.Fatal(err)
	}
	if len(speaking.Items) != 2 || speaking.Section.MaxAttempts != 2 {
		t.Fatalf("speaking content: %+v", speaking.Section)
	}
	first := speaking.Items[0].ID
	at1, err := svc.UploadRecording(ctx, uid, id, first, "audio/webm", 604, strings.NewReader(string(webm(1))), 40000, "web")
	if err != nil {
		t.Fatal(err)
	}
	if again, err := svc.UploadRecording(ctx, uid, id, first, "audio/webm", 604, strings.NewReader(string(webm(1))), 40000, "web"); err != nil || again.ID != at1.ID {
		t.Errorf("re-uploading the same recording must return the same attempt: %v", err)
	}
	if _, err := svc.UploadRecording(ctx, uid, id, first, "audio/webm", 604, strings.NewReader(string(webm(2))), 42000, "web"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UploadRecording(ctx, uid, id, first, "audio/webm", 604, strings.NewReader(string(webm(3))), 42000, "web"); !apperr.Is(err, apperr.CodeConflict) {
		t.Errorf("a third attempt must be refused, got %v", err)
	}
	if _, err := svc.UploadRecording(ctx, uid, id, speaking.Items[1].ID, "text/plain", 5, strings.NewReader("hello"), 1000, "web"); err == nil {
		t.Error("non-audio uploads must be rejected")
	}
	if _, err := svc.UploadRecording(ctx, uid, id, speaking.Items[1].ID, "audio/webm", 604, strings.NewReader(string(webm(4))), 60000, "web"); err != nil {
		t.Fatal(err)
	}
	if a, err = svc.SubmitSection(ctx, uid, id, "speaking"); err != nil || a.Status != StatusProcessing {
		t.Fatalf("after speaking: %s %v", a.Status, err)
	}
	if st := must(onb.Get(ctx, uid)); st.Step != onboarding.StepPlacementProcessing {
		t.Errorf("onboarding step = %s", st.Step)
	}
	runJobs(t, queue, svc)

	// Results.
	result, err := svc.Result(ctx, uid, id)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Skills) != 4 || result.Skills[0].Skill != "reading" || result.Summary.Text == "" {
		t.Fatalf("result: %+v", result)
	}
	if result.Skills[0].CEFR.Value() <= result.Skills[1].CEFR.Value() {
		t.Errorf("all-correct reading (%s) should beat unanswered listening (%s)", result.Skills[0].CEFR, result.Skills[1].CEFR)
	}
	if st := must(onb.Get(ctx, uid)); st.Step != onboarding.StepPlacementResults {
		t.Errorf("onboarding step = %s", st.Step)
	}
	summary, err := levels.Load(ctx, pool, uid)
	if err != nil || summary.Assessed == nil || summary.CurrentEstimated == nil || summary.SelfReported != nil {
		t.Errorf("level history: %+v %v", summary, err)
	}
	var planItems int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM learning_plan_items i JOIN learning_plans p ON p.id = i.learning_plan_id
		WHERE p.user_id = $1 AND p.status = 'active' AND p.source_assessment_id = $2`, uid, id).Scan(&planItems)
	if planItems != 3 {
		t.Errorf("30 minutes should give a 3-item plan, got %d", planItems)
	}
	var weaknesses int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM weaknesses WHERE user_id = $1`, uid).Scan(&weaknesses)
	if weaknesses == 0 {
		t.Error("focus areas and mistakes should become weaknesses")
	}

	must(onb.ResultsViewed(ctx, uid))
	if st := must(onb.Complete(ctx, uid)); st.Step != onboarding.StepCompleted || st.CompletedAt == nil {
		t.Errorf("complete: %+v", st)
	}

	// A retake from the profile: the timer is enforced by the server, then it is abandoned.
	retake, err := svc.StartPlacement(ctx, uid, result.Overall.CEFR.Shift(0), "profile", "web")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.StartSection(ctx, uid, retake, "reading"); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE assessment_sections SET deadline_at = now() - interval '1 hour' WHERE assessment_id = $1 AND skill = 'reading'`, retake); err != nil {
		t.Fatal(err)
	}
	expired, err := svc.Get(ctx, uid, retake)
	if err != nil || expired.Sections[0].Status != SectionCompleted {
		t.Fatalf("an overdue section must be auto-submitted: %+v %v", expired.Sections, err)
	}
	if err := svc.AbandonPlacement(ctx, uid, retake); err != nil {
		t.Fatal(err)
	}
	if st := must(onb.Get(ctx, uid)); st.Step != onboarding.StepCompleted {
		t.Error("a profile retake must not change onboarding")
	}
	history, err := svc.History(ctx, uid)
	if err != nil || len(history) != 2 || history[0].Status != StatusAbandoned || history[1].OverallCEFR == nil {
		t.Errorf("history must keep both assessments: %+v %v", history, err)
	}
}

func runJobs(t *testing.T, queue *jobs.MemoryQueue, svc *Service) {
	t.Helper()
	for {
		job, err := queue.Reserve(context.Background(), 10*time.Millisecond)
		if err != nil {
			t.Fatal(err)
		}
		if job == nil {
			return
		}
		if _, err := svc.HandleEvaluationJob(context.Background(), job); err != nil {
			t.Fatalf("job %s: %v", job.Type, err)
		}
	}
}

func mustJSON(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

var _ = pgxpool.Pool{}
