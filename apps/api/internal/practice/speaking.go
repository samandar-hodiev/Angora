package practice

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/storage"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Speaking practice.
//
// The pipeline is three separate stages, on purpose: the recording is stored, then
// transcribed, then judged. Each stage writes its own row — audio_files, transcripts,
// ai_analyses — so a failure is attributable to a stage rather than to "the AI", and a
// transcript that already exists is never paid for twice.
//
// Audio never goes into PostgreSQL. The bytes live in object storage and the database keeps
// the key, the checksum and the duration.

// SpeakingEvaluator is the slice of the AI layer this file needs: one stage to turn audio
// into words, another to judge the words.
type SpeakingEvaluator interface {
	Transcribe(ctx context.Context, userID uuid.UUID, audio io.Reader, fileName, mimeType string) (*ai.TranscriptionResponse, error)
	EvaluateSpeaking(ctx context.Context, in ai.SpeakingAssessmentInput) (*ai.SpeakingAssessment, ai.EvaluationMeta, error)
}

// Storage is the object store audio is written to.
type Storage interface {
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	Provider() string
}

const (
	entitlementSpeakingPractice = "speaking.practice"
	entitlementSpeakingChecks   = "speaking.evaluations"

	// Below this a recording is a cough, not an answer, and the evaluator would be judging
	// noise. The learner is told rather than charged.
	minSpeechSeconds = 5
)

// SpeakingRoute is the upload route; the router gives it a larger body limit.
const SpeakingRoute = "/api/v1/speaking/sessions"

type SpeakingFeedback struct {
	Fluency      float64                `json:"fluency"`
	Grammar      float64                `json:"grammar"`
	Vocabulary   float64                `json:"vocabulary"`
	Relevance    float64                `json:"relevance"`
	CEFREstimate string                 `json:"cefr_estimate"`
	Confidence   float64                `json:"confidence"`
	Mistakes     []ai.AssessmentMistake `json:"mistakes"`
}

type SpeakingSession struct {
	ID     uuid.UUID  `json:"id"`
	TaskID *uuid.UUID `json:"task_id"`
	Prompt string     `json:"prompt"`
	/** practice for a single recording, live for a coached conversation. */
	Mode           string            `json:"mode"`
	Status         string            `json:"status"`
	Score          *float64          `json:"overall_score"`
	DurationMs     *int              `json:"duration_ms"`
	Transcript     string            `json:"transcript,omitempty"`
	WordsPerMinute *float64          `json:"words_per_minute,omitempty"`
	Feedback       *SpeakingFeedback `json:"feedback,omitempty"`
	/** Present for a live session: the conversation, in order. */
	Turns       []SpeakingTurn `json:"turns,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
	CompletedAt *time.Time     `json:"completed_at"`
}

func (m *Module) registerSpeakingRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/speaking", authz.RequirePermission(authz.PermLearningPractice))
	g.GET("/tasks", m.speakingTasks)
	g.POST("/sessions", m.submitSpeaking)
	g.GET("/sessions", m.listSpeakingSessions)
	g.GET("/sessions/:id", m.speakingSession)
	g.GET("/sessions/:id/turns", m.speakingTurns)
	g.GET("/live", m.liveSpeaking)
}

func (m *Module) speakingTasks(c *gin.Context) {
	var page httpx.Pagination
	if err := httpx.BindQuery(c, &page); err != nil {
		httpx.Fail(c, err)
		return
	}
	page = page.Normalize()

	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT ci.id, ci.title, l.code, ci.difficulty, ci.body, count(*) OVER ()
		FROM content_items ci
		JOIN skills s ON s.id = ci.skill_id
		LEFT JOIN levels l ON l.id = ci.level_id
		WHERE ci.status = 'published' AND s.code = 'speaking'
		ORDER BY l.code NULLS LAST, ci.difficulty, ci.title
		OFFSET $1 LIMIT $2`, page.Offset(), page.PageSize)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []WritingTask{}
	var total int64
	for rows.Next() {
		var t WritingTask
		if err := rows.Scan(&t.ID, &t.Title, &t.Level, &t.Difficulty, &t.Body, &total); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, t)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OKWithMeta(c, list, httpx.Meta{Page: page.Page, PageSize: page.PageSize, Total: total})
}

// submitSpeaking takes the recording and returns the report.
//
// Multipart rather than JSON because the payload is audio. The stages run in order and each
// one can fail on its own terms: a recording that cannot be stored never reaches the
// transcriber, and a transcript too short to judge never reaches the evaluator — and in both
// cases the learner's evaluation budget is given back.
func (m *Module) submitSpeaking(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	ctx := c.Request.Context()

	if m.plans != nil {
		if err := m.plans.RequireFeature(ctx, p.UserID, entitlementSpeakingPractice); err != nil {
			httpx.Fail(c, err)
			return
		}
	}
	if m.speaker == nil || m.store == nil {
		httpx.Fail(c, apperr.NotImplemented("Speaking feedback"))
		return
	}

	file, header, err := c.Request.FormFile("audio")
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Attach your recording as the 'audio' field"))
		return
	}
	defer func() { _ = file.Close() }()

	var taskID *uuid.UUID
	if raw := c.Request.FormValue("task_id"); raw != "" {
		parsed, err := uuid.Parse(raw)
		if err != nil {
			httpx.Fail(c, apperr.BadRequest("Invalid task id"))
			return
		}
		taskID = &parsed
	}
	durationMs := 0
	if raw := c.Request.FormValue("duration_ms"); raw != "" {
		var parsed int
		if _, err := fmt.Sscanf(raw, "%d", &parsed); err == nil && parsed > 0 {
			durationMs = parsed
		}
	}

	policy := storage.AudioPolicy(m.maxUpload)
	data, err := io.ReadAll(io.LimitReader(file, m.maxUpload+1))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("The recording could not be read. Please try again."))
		return
	}
	head := data[:min(len(data), 512)]
	allowed, err := policy.Validate(header.Header.Get("Content-Type"), int64(len(data)), head)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	prompt, level := m.speakingPrompt(ctx, p.UserID, taskID)

	// Stage one: store the bytes. Nothing else happens until they are safe.
	key := storage.NewKey("audio", p.UserID, allowed.Extension, time.Now())
	if err := m.store.Put(ctx, key, bytes.NewReader(data), int64(len(data)), allowed.Canonical); err != nil {
		httpx.Fail(c, apperr.New(apperr.CodeUnavailable, "We couldn't save your recording. Please try again."))
		return
	}
	sum := sha256.Sum256(data)
	checksum := hex.EncodeToString(sum[:])

	var audioID, sessionID uuid.UUID
	if err := m.pool.QueryRow(ctx, `
		INSERT INTO audio_files (user_id, storage_provider, storage_key, mime_type, size_bytes, duration_ms,
		                         checksum_sha256, purpose, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'speaking_practice', 'uploaded') RETURNING id`,
		p.UserID, m.store.Provider(), key, allowed.Canonical, len(data), durationMs, checksum).Scan(&audioID); err != nil {
		httpx.Fail(c, err)
		return
	}
	if err := m.pool.QueryRow(ctx, `
		INSERT INTO speaking_sessions (user_id, content_item_id, mode, status, audio_file_id, duration_ms,
		                               client_platform, submitted_at)
		VALUES ($1, $2, 'practice', 'analyzing', $3, $4, $5, now()) RETURNING id`,
		p.UserID, taskID, audioID, durationMs, httpx.ClientPlatform(c)).Scan(&sessionID); err != nil {
		httpx.Fail(c, err)
		return
	}

	// Charge once, for the evaluation that is about to run.
	if m.usage != nil {
		if err := m.usage.ConsumeUsage(ctx, p.UserID, entitlementSpeakingChecks, 1); err != nil {
			m.failSpeaking(ctx, sessionID)
			httpx.Fail(c, err)
			return
		}
	}
	refund := func() {
		if m.usage != nil {
			_ = m.usage.ReleaseUsage(ctx, p.UserID, entitlementSpeakingChecks, 1)
		}
	}

	// Stage two: words.
	transcription, err := m.speaker.Transcribe(ctx, p.UserID, bytes.NewReader(data), header.Filename, allowed.Canonical)
	if err != nil || transcription == nil {
		refund()
		m.failSpeaking(ctx, sessionID)
		httpx.Fail(c, apperr.New(apperr.CodeUnavailable, "We couldn't hear that recording. Please try again."))
		return
	}

	speechSeconds := transcription.DurationSeconds
	if speechSeconds <= 0 && durationMs > 0 {
		speechSeconds = float64(durationMs) / 1000
	}
	if speechSeconds < minSpeechSeconds || len(transcription.Text) < 15 {
		refund()
		m.failSpeaking(ctx, sessionID)
		httpx.Fail(c, apperr.BadRequest("That recording was too short to give feedback on. Try speaking for at least a few sentences."))
		return
	}

	var transcriptID uuid.UUID
	if err := m.pool.QueryRow(ctx, `
		INSERT INTO transcripts (user_id, audio_file_id, text, provider, model)
		VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		p.UserID, audioID, transcription.Text, "", transcription.Model).Scan(&transcriptID); err != nil {
		httpx.Fail(c, err)
		return
	}

	words := countWords(transcription.Text)
	wpm := 0.0
	if speechSeconds > 0 {
		wpm = float64(words) / speechSeconds * 60
	}

	// Stage three: judgement, on the words rather than the audio.
	target, err := cefr.Parse(level)
	if err != nil {
		target = cefr.MustParse("B1")
	}
	assessment, meta, err := m.speaker.EvaluateSpeaking(ctx, ai.SpeakingAssessmentInput{
		UserID: p.UserID, TaskPrompt: prompt, TargetLevel: target,
		Transcript: transcription.Text, SpeechSeconds: speechSeconds, WordsPerMinute: wpm,
	})
	if err != nil || assessment == nil {
		refund()
		m.failSpeaking(ctx, sessionID)
		httpx.Fail(c, apperr.New(apperr.CodeUnavailable, "Speaking feedback is temporarily unavailable"))
		return
	}

	overall := (assessment.Fluency + assessment.Grammar + assessment.Vocabulary + assessment.Relevance) / 4
	if err := m.recordSpeakingResult(ctx, p.UserID, sessionID, transcriptID, assessment, meta, overall); err != nil {
		httpx.Fail(c, err)
		return
	}

	if m.track != nil {
		m.track.Track(ctx, analytics.Server("speaking_practice_completed", p.UserID, map[string]any{
			"session_id": sessionID.String(), "seconds": speechSeconds, "score": overall,
		}))
	}
	m.respondWithSpeakingSession(c, sessionID, p.UserID)
}

// speakingPrompt resolves the task's prompt and the level to judge against.
func (m *Module) speakingPrompt(ctx context.Context, userID uuid.UUID, taskID *uuid.UUID) (string, string) {
	prompt, level := "Speak about a topic of your choice.", "B1"
	if taskID != nil {
		var body []byte
		var taskLevel *string
		if err := m.pool.QueryRow(ctx, `
			SELECT ci.body, l.code FROM content_items ci
			JOIN skills s ON s.id = ci.skill_id
			LEFT JOIN levels l ON l.id = ci.level_id
			WHERE ci.id = $1 AND ci.status = 'published' AND s.code = 'speaking'`, *taskID).
			Scan(&body, &taskLevel); err == nil {
			var task struct {
				Prompt string `json:"prompt"`
			}
			_ = json.Unmarshal(body, &task)
			if task.Prompt != "" {
				prompt = task.Prompt
			}
			if taskLevel != nil {
				level = *taskLevel
			}
		}
	}
	var learnerLevel *string
	_ = m.pool.QueryRow(ctx, `
		SELECT l.code FROM profiles pr JOIN levels l ON l.id = pr.current_level_id WHERE pr.user_id = $1`,
		userID).Scan(&learnerLevel)
	if learnerLevel != nil {
		level = *learnerLevel
	}
	return prompt, level
}

func (m *Module) failSpeaking(ctx context.Context, id uuid.UUID) {
	_, _ = m.pool.Exec(ctx, `UPDATE speaking_sessions SET status = 'failed' WHERE id = $1`, id)
}

func (m *Module) recordSpeakingResult(
	ctx context.Context, userID, sessionID, transcriptID uuid.UUID,
	assessment *ai.SpeakingAssessment, meta ai.EvaluationMeta, overall float64,
) error {
	tx, err := m.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	payload, err := json.Marshal(assessment)
	if err != nil {
		return err
	}

	var analysisID uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO ai_analyses (user_id, subject_type, subject_id, analysis_type, status, result,
		                         overall_score, schema_version, model_version, prompt_version,
		                         rubric_version, analysis_version, provider, completed_at)
		VALUES ($1, 'speaking_session', $2, 'speaking_evaluation', 'completed', $3, $4, $5, $6, $7, $8, $9, $10, now())
		RETURNING id`,
		userID, sessionID, payload, overall, meta.SchemaVersion, meta.ModelVersion,
		meta.PromptVersion, meta.RubricVersion, meta.AnalysisVersion, meta.Provider).Scan(&analysisID); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE speaking_sessions
		SET status = 'completed', transcript_id = $2, analysis_id = $3, overall_score = $4, completed_at = now()
		WHERE id = $1`, sessionID, transcriptID, analysisID, overall); err != nil {
		return err
	}

	for _, mistake := range assessment.Mistakes {
		if _, err := tx.Exec(ctx, `
			INSERT INTO mistakes (user_id, skill_id, category, source_type, source_id, analysis_id,
			                      original_text, corrected_text, explanation, severity)
			SELECT $1, s.id, $2, 'speaking_session', $3, $4, $5, $6, $7, $8
			FROM skills s WHERE s.code = 'speaking'`,
			userID, mistake.Category, sessionID, analysisID, mistake.Original, mistake.Correction,
			mistake.Explanation, normalizeSeverity(mistake.Severity)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO weaknesses (user_id, skill_id, category, severity_score, evidence_count)
			SELECT $1, s.id, $2, 40, 1 FROM skills s WHERE s.code = 'speaking'
			ON CONFLICT (user_id, category) DO UPDATE SET
				severity_score = LEAST(100, weaknesses.severity_score + 6),
				evidence_count = weaknesses.evidence_count + 1,
				last_detected_at = now(), status = 'active'`, userID, mistake.Category); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO skill_progress (user_id, skill_id, score, sessions_count, last_practiced_at)
		SELECT $1, s.id, $2, 1, now() FROM skills s WHERE s.code = 'speaking'
		ON CONFLICT (user_id, skill_id) DO UPDATE SET
			score = round((skill_progress.score * 0.7 + EXCLUDED.score * 0.3)::numeric, 2),
			sessions_count = skill_progress.sessions_count + 1,
			last_practiced_at = now()`, userID, overall); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (m *Module) listSpeakingSessions(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var page httpx.Pagination
	if err := httpx.BindQuery(c, &page); err != nil {
		httpx.Fail(c, err)
		return
	}
	page = page.Normalize()

	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT sp.id, sp.content_item_id, coalesce(ci.title, ''), sp.mode, sp.status,
		       sp.overall_score::float8, sp.duration_ms, sp.created_at, sp.completed_at, count(*) OVER ()
		FROM speaking_sessions sp
		LEFT JOIN content_items ci ON ci.id = sp.content_item_id
		WHERE sp.user_id = $1 AND sp.mode IN ('practice', 'live')
		ORDER BY sp.created_at DESC
		OFFSET $2 LIMIT $3`, p.UserID, page.Offset(), page.PageSize)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []SpeakingSession{}
	var total int64
	for rows.Next() {
		var s SpeakingSession
		if err := rows.Scan(&s.ID, &s.TaskID, &s.Prompt, &s.Mode, &s.Status, &s.Score, &s.DurationMs,
			&s.CreatedAt, &s.CompletedAt, &total); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, s)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OKWithMeta(c, list, httpx.Meta{Page: page.Page, PageSize: page.PageSize, Total: total})
}

func (m *Module) speakingSession(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid session id"))
		return
	}
	m.respondWithSpeakingSession(c, id, p.UserID)
}

func (m *Module) respondWithSpeakingSession(c *gin.Context, id, userID uuid.UUID) {
	var (
		s          SpeakingSession
		raw        []byte
		transcript *string
	)
	ctx := c.Request.Context()
	err := m.pool.QueryRow(ctx, `
		SELECT sp.id, sp.content_item_id, coalesce(ci.title, ''), sp.mode, sp.status,
		       sp.overall_score::float8, sp.duration_ms, sp.created_at, sp.completed_at, a.result, t.text
		FROM speaking_sessions sp
		LEFT JOIN content_items ci ON ci.id = sp.content_item_id
		LEFT JOIN ai_analyses a ON a.id = sp.analysis_id
		LEFT JOIN transcripts t ON t.id = sp.transcript_id
		WHERE sp.id = $1 AND sp.user_id = $2`, id, userID).
		Scan(&s.ID, &s.TaskID, &s.Prompt, &s.Mode, &s.Status, &s.Score, &s.DurationMs, &s.CreatedAt,
			&s.CompletedAt, &raw, &transcript)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.NotFound("Session"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if s.Mode == "live" {
		// A live session's transcript_id points at its last turn, because a transcripts row
		// belongs to one recording. The conversation itself lives in speaking_turns.
		turns, err := m.turnsOf(ctx, id, userID)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		s.Turns = turns
		parts := make([]string, 0, len(turns))
		for _, t := range turns {
			parts = append(parts, t.Transcript)
		}
		joined := strings.Join(parts, "\n\n")
		transcript = &joined
	}
	if transcript != nil {
		s.Transcript = *transcript
		if s.DurationMs != nil && *s.DurationMs > 0 {
			wpm := float64(countWords(*transcript)) / (float64(*s.DurationMs) / 1000) * 60
			s.WordsPerMinute = &wpm
		}
	}
	if len(raw) > 0 {
		var feedback SpeakingFeedback
		if json.Unmarshal(raw, &feedback) == nil {
			s.Feedback = &feedback
		}
	}
	httpx.OK(c, s)
}
