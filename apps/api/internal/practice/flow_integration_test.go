package practice

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
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/middleware"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/internal/subscriptions"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
)

// The whole reading practice journey against PostgreSQL: list what is available, open a set,
// answer it, submit, and check that the score, the mistakes and the learner's skill standing
// all followed. Run with:
//
//	TEST_DATABASE_URL=postgres://localhost:5432/engora_test?sslmode=disable go test -p 1 -run TestReadingPractice ./internal/practice/

func TestReadingPracticeFlowPostgres(t *testing.T) {
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
		Email: fmt.Sprintf("reader-%d@example.com", time.Now().UnixNano()), DisplayName: "Reader", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, learner.ID) })

	setID, questionIDs := seedReadingSet(ctx, t, pool)

	module := NewModule(Deps{
		Pool:    pool,
		Plans:   subscriptions.NewService(subscriptions.NewPostgresStore(pool)),
		Tracker: &analytics.Memory{},
	})

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

	// The set is offered, and it reports how many questions it holds.
	w, listed := call(http.MethodGet, "/reading/sets", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("list sets: status = %d body = %s", w.Code, w.Body.String())
	}
	sets, _ := listed["data"].([]any)
	found := false
	for _, raw := range sets {
		set, _ := raw.(map[string]any)
		if set["id"] == setID.String() {
			found = true
			if count, _ := set["question_count"].(float64); count != 3 {
				t.Errorf("question_count = %v, want 3", set["question_count"])
			}
		}
	}
	if !found {
		t.Fatal("the seeded set was not listed")
	}

	// Opening it must not leak the answer key.
	w, detail := call(http.MethodGet, "/reading/sets/"+setID.String(), nil)
	if w.Code != http.StatusOK {
		t.Fatalf("open set: status = %d", w.Code)
	}
	if bytes.Contains(w.Body.Bytes(), []byte("answer_key")) {
		t.Fatal("the answer key was sent to the learner")
	}
	data, _ := detail["data"].(map[string]any)
	if questions, _ := data["questions"].([]any); len(questions) != 3 {
		t.Fatalf("questions = %d, want 3", len(questions))
	}

	// Start, answer two of three correctly, leave one blank.
	w, started := call(http.MethodPost, "/reading/sets/"+setID.String()+"/attempts", nil)
	if w.Code != http.StatusCreated {
		t.Fatalf("start attempt: status = %d body = %s", w.Code, w.Body.String())
	}
	attempt, _ := started["data"].(map[string]any)
	attemptID, _ := attempt["id"].(string)

	if w, _ := call(http.MethodPost, "/reading/attempts/"+attemptID+"/answers", map[string]any{
		"answers": map[string]any{
			questionIDs[0]: map[string]string{"option_id": "b"},
			questionIDs[1]: map[string]string{"option_id": "a"}, // wrong on purpose
		},
		"time_spent_ms": 45000,
	}); w.Code != http.StatusNoContent {
		t.Fatalf("save answers: status = %d", w.Code)
	}

	w, completed := call(http.MethodPost, "/reading/attempts/"+attemptID+"/complete", map[string]any{
		"answers": map[string]any{questionIDs[2]: map[string]string{"text": "  The National Museum. "}},
	})
	if w.Code != http.StatusOK {
		t.Fatalf("complete: status = %d body = %s", w.Code, w.Body.String())
	}
	result, _ := completed["data"].(map[string]any)
	if correct, _ := result["correct_count"].(float64); correct != 2 {
		t.Errorf("correct = %v, want 2 (one option right, one wrong, the text answer right)", result["correct_count"])
	}
	if score, _ := result["score"].(float64); score != 66.67 {
		t.Errorf("score = %v, want 66.67", result["score"])
	}
	marks, _ := result["marks"].([]any)
	if len(marks) != 3 {
		t.Fatalf("marks = %d, want one per question", len(marks))
	}

	// Submitting again must return the same result rather than re-score.
	w, again := call(http.MethodPost, "/reading/attempts/"+attemptID+"/complete", map[string]any{
		"answers": map[string]any{questionIDs[1]: map[string]string{"option_id": "c"}},
	})
	if w.Code != http.StatusOK {
		t.Fatalf("re-complete: status = %d", w.Code)
	}
	repeat, _ := again["data"].(map[string]any)
	if score, _ := repeat["score"].(float64); score != 66.67 {
		t.Errorf("a second submission changed the recorded score to %v", repeat["score"])
	}

	// The wrong answer became a mistake and a weakness, and the learner now has a reading
	// standing — this is what the recommendation engine reads.
	var mistakes int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM mistakes WHERE user_id = $1`, learner.ID).Scan(&mistakes); err != nil {
		t.Fatal(err)
	}
	if mistakes != 1 {
		t.Errorf("mistakes recorded = %d, want 1", mistakes)
	}
	var weaknesses int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM weaknesses WHERE user_id = $1`, learner.ID).Scan(&weaknesses); err != nil {
		t.Fatal(err)
	}
	if weaknesses != 1 {
		t.Errorf("weaknesses recorded = %d, want 1", weaknesses)
	}
	var sessions int
	var score float64
	if err := pool.QueryRow(ctx, `
		SELECT sp.sessions_count, sp.score::float8 FROM skill_progress sp
		JOIN skills s ON s.id = sp.skill_id WHERE sp.user_id = $1 AND s.code = 'reading'`, learner.ID).
		Scan(&sessions, &score); err != nil {
		t.Fatalf("no reading progress recorded: %v", err)
	}
	if sessions != 1 || score <= 0 {
		t.Errorf("skill progress = %d sessions, score %v", sessions, score)
	}

	// Another learner's attempt is not reachable.
	other, err := users.NewPostgresRepository(pool).CreateAccount(ctx, users.NewAccount{
		Email: fmt.Sprintf("other-%d@example.com", time.Now().UnixNano()), DisplayName: "Other", Timezone: "UTC", EmailVerified: true,
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
	r2.ServeHTTP(w2, httptest.NewRequest(http.MethodGet, "/api/v1/reading/attempts/"+attemptID, nil))
	if w2.Code != http.StatusNotFound {
		t.Errorf("another learner reading this attempt: status = %d, want 404", w2.Code)
	}
}

// seedReadingSet creates a published passage with three questions: two multiple choice and
// one short answer.
func seedReadingSet(ctx context.Context, t *testing.T, pool *pgxpool.Pool) (uuid.UUID, []string) {
	t.Helper()
	stamp := time.Now().UnixNano()

	var setID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO content_items (type, title, skill_id, level_id, difficulty, status, body, published_at)
		SELECT 'reading_passage', $1, s.id, l.id, 4, 'published',
		       '{"text": "The museum opened in 1921 and now holds over two million objects."}'::jsonb, now()
		FROM skills s, levels l WHERE s.code = 'reading' AND l.code = 'B1'
		RETURNING id`, fmt.Sprintf("Practice passage %d", stamp)).Scan(&setID); err != nil {
		t.Fatal(err)
	}

	items := []struct {
		prompt  string
		options string
		key     string
		topic   string
	}{
		{"When did the museum open?", `[{"id":"a","text":"1912"},{"id":"b","text":"1921"}]`, `{"option_id":"b"}`, "reading.detail"},
		{"What does the passage suggest about the collection?", `[{"id":"a","text":"It is small"},{"id":"b","text":"It is large"},{"id":"c","text":"It is closed"}]`, `{"option_id":"b"}`, "reading.inference"},
		{"Name the museum.", `[]`, `{"text":"the National Museum","accept":["National Museum"]}`, "reading.detail"},
	}

	ids := make([]string, 0, len(items))
	for i, item := range items {
		var id uuid.UUID
		itemType := "multiple_choice"
		if item.options == `[]` {
			itemType = "vocabulary_in_context"
		}
		if err := pool.QueryRow(ctx, `
			INSERT INTO assessment_items (slug, kind, skill, level_id, difficulty, topic, item_type,
			                              stimulus_id, position, prompt, options, answer_key, explanation, status, published_at)
			SELECT $1, 'reading_practice', 'reading', l.id, 4, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb,
			       'Explained in the passage.', 'published', now()
			FROM levels l WHERE l.code = 'B1'
			RETURNING id`,
			fmt.Sprintf("practice-item-%d-%d", stamp, i), item.topic, itemType, setID, i, item.prompt,
			item.options, item.key).Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id.String())
	}

	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM assessment_items WHERE stimulus_id = $1`, setID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM content_items WHERE id = $1`, setID)
	})
	return setID, ids
}
