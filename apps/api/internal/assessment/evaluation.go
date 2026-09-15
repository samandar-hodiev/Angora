package assessment

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"path"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/assessment/scoring"
	"github.com/samandar-hodiev/engora/apps/api/internal/jobs"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/storage"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

// The evaluation pipeline for productive skills.
//
//	writing:  submission ─▶ structured AI evaluation (task response, grammar, vocabulary,
//	          coherence, CEFR estimate, mistakes) ─▶ measured word count ─▶ scoring
//	speaking: audio (object storage) ─▶ speech-to-text ─▶ transcript ─▶ audio metrics
//	          (speech time, words per minute, pauses) ─▶ pronunciation analysis (not configured:
//	          marked unavailable) ─▶ structured AI linguistic evaluation ─▶ scoring
//
// Each response's AI result is stored in ai_analyses with full version pinning before the
// section is scored, so a retry never pays for (or changes) an evaluation twice.

type evaluatePayload struct {
	AssessmentID uuid.UUID `json:"assessment_id"`
	Skill        string    `json:"skill"`
}

var errPermanent = errors.New("permanent evaluation failure")

// HandleEvaluationJob is registered with the job worker for JobEvaluateSection.
func (s *Service) HandleEvaluationJob(ctx context.Context, job *jobs.Job) (map[string]any, error) {
	var p evaluatePayload
	if err := json.Unmarshal(job.Payload, &p); err != nil || p.AssessmentID == uuid.Nil {
		return nil, jobs.Permanent("invalid_payload", fmt.Errorf("decode payload: %v", err))
	}
	err := s.evaluateSection(ctx, p.AssessmentID, p.Skill)
	if err == nil {
		return map[string]any{"assessment_id": p.AssessmentID, "skill": p.Skill}, nil
	}
	if errors.Is(err, errPermanent) {
		s.markSectionFailed(ctx, p.AssessmentID, p.Skill, "evaluation_failed")
		return nil, jobs.Permanent("evaluation_failed", err)
	}
	if job.Attempts >= job.MaxAttempts {
		s.markSectionFailed(ctx, p.AssessmentID, p.Skill, "evaluation_unavailable")
	}
	return nil, err
}

func (s *Service) evaluateSection(ctx context.Context, id uuid.UUID, skill string) error {
	var userID, sectionID uuid.UUID
	var status string
	err := s.pool.QueryRow(ctx, `
		SELECT a.user_id, sec.id, sec.status FROM assessment_sections sec JOIN assessments a ON a.id = sec.assessment_id
		WHERE sec.assessment_id = $1 AND sec.skill = $2`, id, skill).Scan(&userID, &sectionID, &status)
	if database.IsNotFound(err) {
		return fmt.Errorf("%w: section not found", errPermanent)
	}
	if err != nil {
		return err
	}
	switch status {
	case SectionCompleted:
		return s.maybeFinalize(ctx, id)
	case SectionEvaluating, SectionFailed:
	default:
		return fmt.Errorf("%w: section is %s", errPermanent, status)
	}

	var result scoring.SkillResult
	switch skill {
	case scoring.SkillWriting:
		result, err = s.evaluateWriting(ctx, userID, sectionID)
	case scoring.SkillSpeaking:
		result, err = s.evaluateSpeaking(ctx, userID, sectionID)
	default:
		return fmt.Errorf("%w: %s is not evaluated asynchronously", errPermanent, skill)
	}
	if err != nil {
		return err
	}

	err = database.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := insertSkillResult(ctx, tx, id, result); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE assessment_sections SET status = 'completed', completed_at = now(), error_code = '' WHERE id = $1`, sectionID)
		return err
	})
	if err != nil {
		return err
	}
	return s.maybeFinalize(ctx, id)
}

type taskInfo struct {
	itemID   uuid.UUID
	prompt   string
	settings map[string]any
	level    cefr.Level
	band     string
}

func intSetting(settings map[string]any, key string) int {
	if v, ok := settings[key].(float64); ok {
		return int(v)
	}
	return 0
}

// storedAnalysis is what ai_analyses.result holds for placement evaluations.
type storedAnalysis struct {
	Writing  *ai.WritingAssessment  `json:"writing,omitempty"`
	Speaking *ai.SpeakingAssessment `json:"speaking,omitempty"`
	Metrics  map[string]any         `json:"metrics"`
	// Skipped is set when no AI call was made (e.g. an empty answer).
	Skipped string `json:"skipped,omitempty"`
}

func (s *Service) evaluateWriting(ctx context.Context, userID, sectionID uuid.UUID) (scoring.SkillResult, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT w.id, w.text, w.word_count, w.status, a.result, i.id, i.prompt, i.settings, l.code, si.band
		FROM assessment_section_items si
		JOIN assessment_items i ON i.id = si.item_id
		JOIN levels l ON l.id = i.level_id
		LEFT JOIN writing_submissions w ON w.assessment_section_id = si.section_id AND w.assessment_item_id = si.item_id
		LEFT JOIN ai_analyses a ON a.id = w.analysis_id
		WHERE si.section_id = $1 ORDER BY si.position`, sectionID)
	if err != nil {
		return scoring.SkillResult{}, err
	}
	type row struct {
		submissionID *uuid.UUID
		text         *string
		words        *int
		status       *string
		stored       []byte
		task         taskInfo
	}
	var list []row
	for rows.Next() {
		var r row
		var code string
		if err := rows.Scan(&r.submissionID, &r.text, &r.words, &r.status, &r.stored, &r.task.itemID, &r.task.prompt,
			&r.task.settings, &code, &r.task.band); err != nil {
			rows.Close()
			return scoring.SkillResult{}, err
		}
		r.task.level, _ = cefr.Parse(code)
		list = append(list, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return scoring.SkillResult{}, err
	}

	var tasks []scoring.ProductiveTask
	for _, r := range list {
		minWords := intSetting(r.task.settings, "min_words")
		task := scoring.ProductiveTask{Band: r.task.band, Level: r.task.level, MinWords: minWords}
		if r.submissionID == nil || r.text == nil || countWords(*r.text) == 0 {
			task.Missing = true
			tasks = append(tasks, task)
			continue
		}
		task.Words = countWords(*r.text)

		var assessment *ai.WritingAssessment
		if r.status != nil && *r.status == "completed" && len(r.stored) > 0 {
			var stored storedAnalysis
			if err := json.Unmarshal(r.stored, &stored); err == nil {
				assessment = stored.Writing
			}
		} else {
			assessment, err = s.runWritingEvaluation(ctx, userID, *r.submissionID, r.task, *r.text, task.Words)
			if err != nil {
				return scoring.SkillResult{}, err
			}
		}
		if assessment != nil {
			task.Criteria = map[string]*float64{
				"task_response": &assessment.TaskResponse, "grammar": &assessment.Grammar,
				"vocabulary": &assessment.Vocabulary, "coherence": &assessment.Coherence,
			}
			if est, err := cefr.Parse(assessment.CEFREstimate); err == nil {
				task.AIEstimate, task.AIConfidence = &est, assessment.Confidence
			}
		} else {
			low := 5.0
			task.Criteria = map[string]*float64{"task_response": &low, "grammar": &low, "vocabulary": &low, "coherence": &low}
		}
		tasks = append(tasks, task)
	}
	return scoring.ScoreWriting(tasks), nil
}

// runWritingEvaluation calls the AI (unless the answer is too short to evaluate) and stores
// the analysis, mistakes and submission state atomically.
func (s *Service) runWritingEvaluation(ctx context.Context, userID, submissionID uuid.UUID, task taskInfo, text string, words int) (*ai.WritingAssessment, error) {
	stored := storedAnalysis{Metrics: map[string]any{"words": words, "min_words": intSetting(task.settings, "min_words")}}
	meta := ai.EvaluationMeta{Versions: ai.Versions{SchemaVersion: ai.PlacementSchemaVersion, ModelVersion: "rules", PromptVersion: "none",
		RubricVersion: ai.PlacementRubricVersion, AnalysisVersion: "placement_writing_rules.v1"}, Provider: "rules"}

	if words < 10 {
		stored.Skipped = "too_short"
	} else {
		if _, err := s.pool.Exec(ctx, `UPDATE writing_submissions SET status = 'analyzing' WHERE id = $1`, submissionID); err != nil {
			return nil, err
		}
		out, m, err := s.evaluator.EvaluateWriting(ctx, ai.WritingAssessmentInput{
			UserID: userID, TaskPrompt: task.prompt, TargetLevel: task.level, MinWords: intSetting(task.settings, "min_words"),
			MaxWords: intSetting(task.settings, "max_words"), Text: text, WordCount: words,
		})
		if err != nil {
			logger.FromContext(ctx, s.log).Warn("writing evaluation failed", slog.String("error", err.Error()))
			if errors.Is(err, ai.ErrInvalidEvaluation) {
				return nil, err // retry: models occasionally return malformed output
			}
			return nil, err
		}
		stored.Writing, meta = out, m
	}

	var mistakes []ai.AssessmentMistake
	var score *float64
	if stored.Writing != nil {
		mistakes = stored.Writing.Mistakes
		avg := (stored.Writing.TaskResponse + stored.Writing.Grammar + stored.Writing.Vocabulary + stored.Writing.Coherence) / 4
		score = &avg
	}
	err := s.saveAnalysis(ctx, userID, "writing_submission", submissionID, "placement_writing", "writing", stored, score, meta, mistakes,
		`UPDATE writing_submissions SET status = 'completed', analysis_id = $2, overall_score = $3, completed_at = now() WHERE id = $1`)
	if err != nil {
		return nil, err
	}
	return stored.Writing, nil
}

func (s *Service) saveAnalysis(ctx context.Context, userID uuid.UUID, subjectType string, subjectID uuid.UUID, analysisType, skill string,
	stored storedAnalysis, score *float64, meta ai.EvaluationMeta, mistakes []ai.AssessmentMistake, updateSubject string) error {
	var requestID *uuid.UUID
	if meta.AIRequestID != uuid.Nil {
		requestID = &meta.AIRequestID
	}
	return database.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var analysisID uuid.UUID
		if err := tx.QueryRow(ctx, `
			INSERT INTO ai_analyses (user_id, subject_type, subject_id, analysis_type, status, result, overall_score,
			                         schema_version, model_version, prompt_version, rubric_version, analysis_version, provider,
			                         ai_request_id, completed_at)
			VALUES ($1, $2, $3, $4, 'completed', $5, $6, $7, $8, $9, $10, $11, $12,
			        (SELECT id FROM ai_requests WHERE id = $13), now())
			RETURNING id`,
			userID, subjectType, subjectID, analysisType, stored, score, meta.SchemaVersion, meta.ModelVersion, meta.PromptVersion,
			meta.RubricVersion, meta.AnalysisVersion, meta.Provider, requestID).Scan(&analysisID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, updateSubject, subjectID, analysisID, score); err != nil {
			return err
		}
		for _, m := range mistakes {
			if _, err := tx.Exec(ctx, `
				INSERT INTO mistakes (user_id, skill_id, category, source_type, source_id, analysis_id, original_text, corrected_text, explanation, severity)
				VALUES ($1, (SELECT id FROM skills WHERE code = $2), $3, $4, $5, $6, $7, $8, $9, $10)`,
				userID, skill, m.Category, subjectType, subjectID, analysisID, m.Original, m.Correction, m.Explanation, m.Severity); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Service) evaluateSpeaking(ctx context.Context, userID, sectionID uuid.UUID) (scoring.SkillResult, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT i.id, i.prompt, i.settings, l.code, si.band,
		       sp.id, sp.status, sp.duration_ms, sp.transcript_id, a.result, af.storage_key, af.mime_type
		FROM assessment_section_items si
		JOIN assessment_items i ON i.id = si.item_id
		JOIN levels l ON l.id = i.level_id
		LEFT JOIN LATERAL (
		    SELECT * FROM speaking_sessions x
		    WHERE x.assessment_section_id = si.section_id AND x.assessment_item_id = si.item_id
		      AND x.status IN ('submitted', 'analyzing', 'completed', 'failed')
		    ORDER BY x.attempt_number DESC LIMIT 1) sp ON true
		LEFT JOIN ai_analyses a ON a.id = sp.analysis_id
		LEFT JOIN audio_files af ON af.id = sp.audio_file_id
		WHERE si.section_id = $1 ORDER BY si.position`, sectionID)
	if err != nil {
		return scoring.SkillResult{}, err
	}
	type row struct {
		task         taskInfo
		sessionID    *uuid.UUID
		status       *string
		durationMs   *int
		transcriptID *uuid.UUID
		stored       []byte
		key, mime    *string
	}
	var list []row
	for rows.Next() {
		var r row
		var code string
		if err := rows.Scan(&r.task.itemID, &r.task.prompt, &r.task.settings, &code, &r.task.band,
			&r.sessionID, &r.status, &r.durationMs, &r.transcriptID, &r.stored, &r.key, &r.mime); err != nil {
			rows.Close()
			return scoring.SkillResult{}, err
		}
		r.task.level, _ = cefr.Parse(code)
		list = append(list, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return scoring.SkillResult{}, err
	}

	var tasks []scoring.ProductiveTask
	for _, r := range list {
		expected := math.Max(float64(intSetting(r.task.settings, "response_seconds"))*0.5, 15)
		task := scoring.ProductiveTask{Band: r.task.band, Level: r.task.level, ExpectedSeconds: expected}
		if r.sessionID == nil {
			task.Missing = true
			tasks = append(tasks, task)
			continue
		}

		var stored storedAnalysis
		if r.status != nil && *r.status == "completed" && len(r.stored) > 0 {
			if err := json.Unmarshal(r.stored, &stored); err != nil {
				return scoring.SkillResult{}, err
			}
		} else {
			if r.key == nil || r.mime == nil {
				return scoring.SkillResult{}, fmt.Errorf("%w: recording metadata missing", errPermanent)
			}
			durationMs := 0
			if r.durationMs != nil {
				durationMs = *r.durationMs
			}
			stored, err = s.runSpeakingEvaluation(ctx, userID, *r.sessionID, r.transcriptID, r.task, *r.key, *r.mime, durationMs)
			if err != nil {
				return scoring.SkillResult{}, err
			}
		}

		task.Words, _ = stored.Metrics["words"].(int)
		if w, ok := stored.Metrics["words"].(float64); ok {
			task.Words = int(w)
		}
		if sec, ok := stored.Metrics["speech_seconds"].(float64); ok {
			task.SpeechSeconds = sec
		}
		// No pronunciation analyzer is configured: the criterion is recorded as unavailable
		// and the scoring engine renormalises weights and lowers confidence.
		task.Criteria = map[string]*float64{"pronunciation": nil}
		if a := stored.Speaking; a != nil {
			task.Criteria["fluency"], task.Criteria["grammar"] = &a.Fluency, &a.Grammar
			task.Criteria["vocabulary"], task.Criteria["relevance"] = &a.Vocabulary, &a.Relevance
			if est, err := cefr.Parse(a.CEFREstimate); err == nil {
				task.AIEstimate, task.AIConfidence = &est, a.Confidence
			}
		} else {
			low := 5.0
			task.Criteria["fluency"], task.Criteria["grammar"], task.Criteria["vocabulary"], task.Criteria["relevance"] = &low, &low, &low, &low
		}
		tasks = append(tasks, task)
	}
	return scoring.ScoreSpeaking(tasks), nil
}

func (s *Service) runSpeakingEvaluation(ctx context.Context, userID, sessionID uuid.UUID, transcriptID *uuid.UUID, task taskInfo,
	key, mime string, durationMs int) (storedAnalysis, error) {
	var text string
	var speechSeconds float64
	var segments []ai.TranscriptSegment

	if transcriptID != nil {
		if err := s.pool.QueryRow(ctx, `SELECT text, segments FROM transcripts WHERE id = $1`, *transcriptID).Scan(&text, &segments); err != nil {
			return storedAnalysis{}, err
		}
	} else {
		body, _, err := s.store.Get(ctx, key)
		if errors.Is(err, storage.ErrNotFound) {
			return storedAnalysis{}, fmt.Errorf("%w: recording not found in storage", errPermanent)
		}
		if err != nil {
			return storedAnalysis{}, err
		}
		tr, err := s.evaluator.Transcribe(ctx, userID, body, "answer"+path.Ext(key), mime)
		body.Close()
		if err != nil {
			return storedAnalysis{}, err
		}
		text, segments, speechSeconds = tr.Text, tr.Segments, tr.DurationSeconds
		if segments == nil {
			segments = []ai.TranscriptSegment{}
		}
		var requestID *uuid.UUID
		if tr.AIRequestID != uuid.Nil {
			requestID = &tr.AIRequestID
		}
		err = database.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
			var tid uuid.UUID
			if err := tx.QueryRow(ctx, `
				INSERT INTO transcripts (user_id, audio_file_id, language, text, segments, model, ai_request_id)
				SELECT $1, sp.audio_file_id, $2, $3, $4, $5, (SELECT id FROM ai_requests WHERE id = $6)
				FROM speaking_sessions sp WHERE sp.id = $7 RETURNING id`,
				userID, "en", text, segments, tr.Model, requestID, sessionID).Scan(&tid); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `UPDATE speaking_sessions SET transcript_id = $2, status = 'analyzing' WHERE id = $1`, sessionID, tid)
			return err
		})
		if err != nil {
			return storedAnalysis{}, err
		}
	}

	// Audio metrics, measured deterministically.
	if speechSeconds <= 0 {
		speechSeconds = float64(durationMs) / 1000
	}
	if n := len(segments); n > 0 && segments[n-1].EndMs > 0 {
		speechSeconds = math.Min(math.Max(speechSeconds, float64(segments[n-1].EndMs)/1000), math.Max(speechSeconds, 1))
	}
	words := countWords(text)
	wpm := 0.0
	if speechSeconds > 0 {
		wpm = float64(words) / (speechSeconds / 60)
	}
	var pauseRatio *float64
	if len(segments) > 1 && speechSeconds > 0 {
		var paused float64
		for i := 1; i < len(segments); i++ {
			if gap := float64(segments[i].StartMs-segments[i-1].EndMs) / 1000; gap > 0.7 {
				paused += gap
			}
		}
		r := math.Min(paused/speechSeconds, 1)
		pauseRatio = &r
	}
	stored := storedAnalysis{Metrics: map[string]any{
		"words": words, "speech_seconds": math.Round(speechSeconds*10) / 10, "words_per_minute": math.Round(wpm),
		"pronunciation": "unavailable",
	}}
	if pauseRatio != nil {
		stored.Metrics["pause_ratio"] = math.Round(*pauseRatio*100) / 100
	}

	meta := ai.EvaluationMeta{Versions: ai.Versions{SchemaVersion: ai.PlacementSchemaVersion, ModelVersion: "rules", PromptVersion: "none",
		RubricVersion: ai.PlacementRubricVersion, AnalysisVersion: "placement_speaking_rules.v1"}, Provider: "rules"}
	if words < 8 {
		stored.Skipped = "too_short"
	} else {
		out, m, err := s.evaluator.EvaluateSpeaking(ctx, ai.SpeakingAssessmentInput{
			UserID: userID, TaskPrompt: task.prompt, TargetLevel: task.level, Transcript: text,
			SpeechSeconds: speechSeconds, WordsPerMinute: wpm, PauseRatio: pauseRatio,
		})
		if err != nil {
			logger.FromContext(ctx, s.log).Warn("speaking evaluation failed", slog.String("error", err.Error()))
			return storedAnalysis{}, err
		}
		stored.Speaking, meta = out, m
	}

	var mistakes []ai.AssessmentMistake
	var score *float64
	if stored.Speaking != nil {
		mistakes = stored.Speaking.Mistakes
		avg := (stored.Speaking.Fluency + stored.Speaking.Grammar + stored.Speaking.Vocabulary + stored.Speaking.Relevance) / 4
		score = &avg
	}
	err := s.saveAnalysis(ctx, userID, "speaking_session", sessionID, "placement_speaking", "speaking", stored, score, meta, mistakes,
		`UPDATE speaking_sessions SET status = 'completed', analysis_id = $2, overall_score = $3, completed_at = now() WHERE id = $1`)
	return stored, err
}
