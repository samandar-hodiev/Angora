package grammar

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/storage"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// VisualRoute is where generated diagrams are served from.
const VisualRoute = "/api/v1/grammar/visuals"

// Tutor is the grammar module's view of the AI layer. The module depends on this interface,
// never on a provider, so grammar works with a mock provider in tests and in development.
type Tutor interface {
	ExplainGrammar(ctx context.Context, topic ai.GrammarTopicContext, learner ai.GrammarLearner) (*ai.GrammarExplanation, *ai.EvaluationMeta, error)
	AskGrammar(ctx context.Context, topic ai.GrammarTopicContext, learner ai.GrammarLearner, history []ai.Message, question string) (*ai.TextResponse, error)
	AnalyzeGrammarWriting(ctx context.Context, topic ai.GrammarTopicContext, learner ai.GrammarLearner, task, text string) (*ai.GrammarWritingAnalysis, *ai.EvaluationMeta, error)
	VisualizeGrammar(ctx context.Context, topic ai.GrammarTopicContext, compare *ai.GrammarTopicContext, kind string, learner ai.GrammarLearner) (*ai.GeneratedVisual, uuid.UUID, error)
}

// WritingCorrection is one correction shown to the learner.
type WritingCorrection struct {
	Wrong string `json:"wrong"`
	Right string `json:"right"`
	Why   string `json:"why"`
	// Kind is target_grammar | grammar | vocabulary | spelling | style, so the client can
	// group them and a beginner can be shown grammar only.
	Kind string `json:"kind"`
}

// writingResult is what submitAnswer needs back from an AI analysis.
type writingResult struct {
	TargetUsedCorrectly bool
	Score               float64
	Summary             string
	Corrections         []WritingCorrection
	AnalysisID          *uuid.UUID
}

// ExplanationResponse is the AI explanation with where it came from, so the client can say
// "generated for your level" and show it as distinct from the canonical rule.
type ExplanationResponse struct {
	Topic       string                 `json:"topic"`
	Level       string                 `json:"level"`
	Language    string                 `json:"language"`
	Explanation *ai.GrammarExplanation `json:"explanation"`
	// Cached is true when this came from the shared cache rather than a fresh generation.
	Cached bool `json:"cached"`
}

// POST /grammar/topics/:slug/ai/explain
//
// The same topic, at the same level, in the same language, is one generation shared by every
// learner who asks for it — not one per learner. It is the most requested AI call in the
// product and the one whose output varies least between learners, so it is cached in the
// database and read back for free.
func (m *Module) aiExplain(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	ctx := c.Request.Context()

	if m.tutor == nil {
		httpx.Fail(c, apperr.NotImplemented("AI grammar explanations"))
		return
	}

	subject, err := m.aiSubject(ctx, p.UserID, c.Param("slug"))
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	level := subject.learner.Level.BaseCode()
	language := subject.learner.Language

	var cached []byte
	err = m.pool.QueryRow(ctx, `
		SELECT body FROM grammar_ai_explanations
		WHERE grammar_topic_id = $1 AND level_code = $2 AND language = $3 AND prompt_version = $4
		ORDER BY created_at DESC LIMIT 1`,
		subject.topicID, level, language, ai.GrammarExplainPrompt).Scan(&cached)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, err)
		return
	}
	if len(cached) > 0 {
		var explanation ai.GrammarExplanation
		if json.Unmarshal(cached, &explanation) == nil {
			if err := m.markEngagement(ctx, p.UserID, subject.topicID, "explained_at"); err != nil {
				m.log.Warn("grammar explanation view not recorded", "topic", subject.topic.Slug, "error", err.Error())
			}
			m.track(ctx, p.UserID, EventAIExplain, map[string]any{"topic": subject.topic.Slug, "cached": true})
			httpx.OK(c, ExplanationResponse{
				Topic: subject.topic.Slug, Level: level, Language: language,
				Explanation: &explanation, Cached: true,
			})
			return
		}
	}

	explanation, meta, err := m.tutor.ExplainGrammar(ctx, subject.topic, subject.learner)
	if err != nil {
		httpx.Fail(c, m.aiFailure(err, "AI explanation"))
		return
	}

	body, err := json.Marshal(explanation)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if _, err := m.pool.Exec(ctx, `
		INSERT INTO grammar_ai_explanations
			(grammar_topic_id, level_code, language, body, model, prompt_version, ai_request_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (grammar_topic_id, level_code, language, prompt_version) DO NOTHING`,
		subject.topicID, level, language, body, meta.ModelVersion, ai.GrammarExplainPrompt,
		nullUUID(meta.AIRequestID)); err != nil {
		// The learner has their explanation; failing to cache it only costs the next call.
		m.log.Warn("grammar explanation not cached", "topic", subject.topic.Slug, "error", err.Error())
	}

	// Reading the explanation is an understanding signal. Mastery recomputes from it; this
	// only records that it happened, for this learner.
	if err := m.markEngagement(ctx, p.UserID, subject.topicID, "explained_at"); err != nil {
		m.log.Warn("grammar explanation view not recorded", "topic", subject.topic.Slug, "error", err.Error())
	}

	m.track(ctx, p.UserID, EventAIExplain, map[string]any{"topic": subject.topic.Slug, "cached": false})
	httpx.OK(c, ExplanationResponse{
		Topic: subject.topic.Slug, Level: level, Language: language, Explanation: explanation,
	})
}

type askRequest struct {
	Question string `json:"question" binding:"required,min=2,max=500"`
	// History is the running conversation for this topic. It is capped hard: a tutor thread
	// about one grammar point does not need twenty turns, and an unbounded history is an
	// unbounded bill.
	History []struct {
		Role    string `json:"role" binding:"required,oneof=user assistant"`
		Content string `json:"content" binding:"required,max=2000"`
	} `json:"history" binding:"omitempty,max=8"`
}

// TutorReply is one answer from the contextual tutor.
type TutorReply struct {
	Topic  string `json:"topic"`
	Answer string `json:"answer"`
}

// POST /grammar/topics/:slug/ai/ask
func (m *Module) aiAsk(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	ctx := c.Request.Context()

	if m.tutor == nil {
		httpx.Fail(c, apperr.NotImplemented("The AI grammar tutor"))
		return
	}

	var req askRequest
	if err := httpx.BindJSON(c, &req); err != nil {
		httpx.Fail(c, err)
		return
	}

	subject, err := m.aiSubject(ctx, p.UserID, c.Param("slug"))
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	history := make([]ai.Message, 0, len(req.History))
	for _, msg := range req.History {
		history = append(history, ai.Message{Role: msg.Role, Content: msg.Content})
	}

	reply, err := m.tutor.AskGrammar(ctx, subject.topic, subject.learner, history, req.Question)
	if err != nil {
		httpx.Fail(c, m.aiFailure(err, "The AI tutor"))
		return
	}

	m.track(ctx, p.UserID, EventAITutor, map[string]any{"topic": subject.topic.Slug})
	httpx.OK(c, TutorReply{Topic: subject.topic.Slug, Answer: reply.Text})
}

type visualRequest struct {
	Kind string `json:"kind" binding:"omitempty,oneof=timeline flow comparison_table transformation rule_diagram concept_map"`
	// Compare draws this topic against another one.
	Compare string `json:"compare" binding:"omitempty,max=64"`
}

// POST /grammar/topics/:slug/ai/visual
//
//	request → is this visual already drawn? → yes: return it
//	                                        → no:  draw it, validate, store, return
//
// Canonical visuals are shared: a timeline of the Past Simple is the same timeline for every
// learner, so it is generated once in the product's lifetime rather than once per click.
func (m *Module) aiVisual(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	ctx := c.Request.Context()

	if m.tutor == nil || m.storage == nil {
		httpx.Fail(c, apperr.NotImplemented("AI grammar visuals"))
		return
	}

	var req visualRequest
	if err := bindOptionalJSON(c, &req); err != nil {
		httpx.Fail(c, err)
		return
	}
	if req.Kind == "" {
		req.Kind = "timeline"
	}

	subject, err := m.aiSubject(ctx, p.UserID, c.Param("slug"))
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	var (
		compareCtx *ai.GrammarTopicContext
		compareID  *uuid.UUID
	)
	if req.Compare != "" {
		other, err := m.aiSubject(ctx, p.UserID, req.Compare)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		compareCtx = &other.topic
		id := other.topicID
		compareID = &id
	}

	// The cache lookup, before anything expensive happens.
	var existing Visual
	err = m.pool.QueryRow(ctx, `
		SELECT id, kind, alt_text, caption, status
		FROM grammar_visuals
		WHERE grammar_topic_id = $1 AND kind = $2 AND user_id IS NULL AND status = 'ready'
		  AND compare_topic_id IS NOT DISTINCT FROM $3`,
		subject.topicID, req.Kind, compareID).
		Scan(&existing.ID, &existing.Kind, &existing.AltText, &existing.Caption, &existing.Status)
	if err == nil {
		existing.URL = VisualRoute + "/" + existing.ID.String()
		if err := m.markEngagement(ctx, p.UserID, subject.topicID, "visual_viewed_at"); err != nil {
			m.log.Warn("grammar visual view not recorded", "topic", subject.topic.Slug, "error", err.Error())
		}
		m.track(ctx, p.UserID, EventAIVisual, map[string]any{"topic": subject.topic.Slug, "cached": true})
		httpx.OK(c, existing)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, err)
		return
	}

	generated, requestID, err := m.tutor.VisualizeGrammar(ctx, subject.topic, compareCtx, req.Kind, subject.learner)
	if err != nil {
		httpx.Fail(c, m.aiFailure(err, "Visual generation"))
		return
	}

	visualID := uuid.New()
	key := fmt.Sprintf("grammar/visuals/%s/%s.svg", subject.topic.Slug, visualID)
	if err := storage.ValidateKey(key); err != nil {
		httpx.Fail(c, apperr.Wrap(err, apperr.CodeInternal, "Something went wrong"))
		return
	}
	svg := []byte(generated.SVG)
	// Images never go in PostgreSQL: the database holds where it is and what it shows.
	if err := m.storage.Put(ctx, key, bytes.NewReader(svg), int64(len(svg)), "image/svg+xml"); err != nil {
		httpx.Fail(c, apperr.Wrap(err, apperr.CodeUnavailable, "The visual could not be saved, please try again"))
		return
	}

	if _, err := m.pool.Exec(ctx, `
		INSERT INTO grammar_visuals
			(id, grammar_topic_id, compare_topic_id, kind, storage_provider, storage_key,
			 mime_type, alt_text, caption, status, ai_request_id)
		VALUES ($1, $2, $3, $4, $5, $6, 'image/svg+xml', $7, $8, 'ready', $9)`,
		visualID, subject.topicID, compareID, req.Kind, m.storage.Provider(), key,
		generated.AltText, generated.Caption, nullUUID(requestID)); err != nil {
		httpx.Fail(c, err)
		return
	}

	if err := m.markEngagement(ctx, p.UserID, subject.topicID, "visual_viewed_at"); err != nil {
		m.log.Warn("grammar visual view not recorded", "topic", subject.topic.Slug, "error", err.Error())
	}

	m.track(ctx, p.UserID, EventAIVisual, map[string]any{"topic": subject.topic.Slug, "cached": false, "kind": req.Kind})
	httpx.OK(c, Visual{
		ID: visualID, Kind: req.Kind, URL: VisualRoute + "/" + visualID.String(),
		AltText: generated.AltText, Caption: generated.Caption, Status: "ready",
	})
}

// GET /grammar/visuals/:id — serve a canonical diagram.
//
// Public, like avatars and wallpapers, so an <img> tag works without the client having to
// proxy an authenticated fetch. What makes that safe is what it will not serve: the query
// requires user_id IS NULL, so a personal visual can never be reached from here whatever id
// is guessed.
func (m *Module) visual(c *gin.Context) {
	ctx := c.Request.Context()

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.NotFound("Visual"))
		return
	}

	var key, mimeType string
	err = m.pool.QueryRow(ctx, `
		SELECT storage_key, mime_type FROM grammar_visuals
		WHERE id = $1 AND status = 'ready' AND user_id IS NULL`, id).Scan(&key, &mimeType)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.NotFound("Visual"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	body, info, err := m.storage.Get(ctx, key)
	if err != nil {
		httpx.Fail(c, apperr.Wrap(err, apperr.CodeUnavailable, "The visual is temporarily unavailable"))
		return
	}
	defer body.Close()

	// Shared content, so it may be cached by the browser rather than re-fetched per page.
	c.Header("Cache-Control", "public, max-age=86400")
	c.DataFromReader(200, info.Size, mimeType, body, nil)
}

// analyzeFreeWriting marks one free-writing answer. It is the only AI call the practice
// engine makes, and it is made once per answer.
func (m *Module) analyzeFreeWriting(ctx context.Context, userID uuid.UUID, q Question, text string) (*writingResult, error) {
	if m.tutor == nil {
		return nil, errors.New("no AI tutor configured")
	}
	if strings.TrimSpace(text) == "" {
		return &writingResult{Summary: "Nothing was written."}, nil
	}

	topicID, err := m.questionTopicID(ctx, q.ID)
	if err != nil {
		return nil, err
	}
	subject, err := m.aiSubjectByID(ctx, userID, topicID)
	if err != nil {
		return nil, err
	}

	// A per-answer timeout: a slow provider must not hold a learner's practice session open.
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()

	analysis, meta, err := m.tutor.AnalyzeGrammarWriting(ctx, subject.topic, subject.learner, q.Prompt, text)
	if err != nil {
		return nil, err
	}

	out := &writingResult{
		TargetUsedCorrectly: analysis.TargetUsedCorrectly,
		Score:               analysis.Score,
		Summary:             analysis.Summary,
		Corrections:         make([]WritingCorrection, 0, len(analysis.Corrections)),
	}
	for i, correction := range analysis.Corrections {
		kind := "grammar"
		if i < len(analysis.Kinds) {
			kind = analysis.Kinds[i]
		}
		out.Corrections = append(out.Corrections, WritingCorrection{
			Wrong: correction.Wrong, Right: correction.Right, Why: correction.Why, Kind: kind,
		})
	}

	// Grammar mistakes found in the learner's own sentences belong in the same mistakes
	// table as everything else, linked to this topic so the coach can act on them.
	for _, correction := range out.Corrections {
		if correction.Kind != "grammar" && correction.Kind != "target_grammar" {
			continue
		}
		if _, err := m.pool.Exec(ctx, `
			INSERT INTO mistakes (user_id, skill_id, category, source_type, source_id,
			                      original_text, corrected_text, explanation, severity, grammar_topic_id)
			VALUES ($1, (SELECT id FROM skills WHERE code = 'grammar'), $2, 'exercise', $3, $4, $5, $6, 'medium', $7)`,
			userID, "grammar."+subject.topic.Slug, uuid.MustParse(q.ID),
			truncate(correction.Wrong, 500), truncate(correction.Right, 500),
			truncate(correction.Why, 1000), topicID); err != nil {
			m.log.Warn("grammar writing mistake not recorded", "topic", subject.topic.Slug, "error", err.Error())
		}
	}
	if !analysis.TargetUsedCorrectly {
		if err := m.recordError(ctx, userID, topicID, q, text, "", "writing"); err != nil {
			m.log.Warn("grammar writing error not recorded", "topic", subject.topic.Slug, "error", err.Error())
		}
	}
	_ = meta
	return out, nil
}

// aiContext is everything an AI call needs about one topic and one learner.
type aiContext struct {
	topicID uuid.UUID
	topic   ai.GrammarTopicContext
	learner ai.GrammarLearner
}

func (m *Module) aiSubject(ctx context.Context, userID uuid.UUID, slug string) (aiContext, error) {
	topicID, err := m.topicIDBySlug(ctx, slug)
	if err != nil {
		return aiContext{}, err
	}
	return m.aiSubjectByID(ctx, userID, topicID)
}

// aiSubjectByID assembles the prompt context from the canonical content and the learner's
// own record. The AI is told the rule the product teaches, not asked to recall one.
func (m *Module) aiSubjectByID(ctx context.Context, userID, topicID uuid.UUID) (aiContext, error) {
	out := aiContext{topicID: topicID}

	var (
		level    *string
		bodyRaw  []byte
		category string
	)
	err := m.pool.QueryRow(ctx, `
		SELECT t.slug, t.name, l.code, COALESCE(c.name, ''), t.description,
		       COALESCE(gc.body, 'null'::jsonb)
		FROM grammar_topics t
		LEFT JOIN levels l ON l.id = t.level_id
		LEFT JOIN grammar_categories c ON c.id = t.category_id
		LEFT JOIN grammar_content gc ON gc.grammar_topic_id = t.id AND gc.status = 'published'
		WHERE t.id = $1`, topicID).
		Scan(&out.topic.Slug, &out.topic.Name, &level, &category, &out.topic.Summary, &bodyRaw)
	if err != nil {
		return out, err
	}
	out.topic.Category = category
	if level != nil {
		out.topic.Level = *level
	}

	if len(bodyRaw) > 0 && string(bodyRaw) != "null" {
		var content Content
		if json.Unmarshal(bodyRaw, &content) == nil {
			if content.Explanation != "" {
				out.topic.Summary = content.Explanation
			}
			for _, f := range content.Formulas {
				out.topic.Formulas = append(out.topic.Formulas, f.Label+": "+f.Pattern)
			}
			out.topic.SignalWords = content.SignalWords
			for _, mistake := range content.CommonMistakes {
				out.topic.CommonMistakes = append(out.topic.CommonMistakes,
					fmt.Sprintf("%s → %s (%s)", mistake.Wrong, mistake.Right, mistake.Why))
			}
		}
	}

	relatedRows, err := m.pool.Query(ctx, `
		SELECT t.name FROM grammar_relations r
		JOIN grammar_topics t ON t.id = r.to_topic_id
		WHERE r.from_topic_id = $1 AND r.kind IN ('related', 'compare', 'commonly_confused')
		ORDER BY r.sort_order LIMIT 6`, topicID)
	if err != nil {
		return out, err
	}
	defer relatedRows.Close()
	for relatedRows.Next() {
		var name string
		if err := relatedRows.Scan(&name); err != nil {
			return out, err
		}
		out.topic.RelatedTopics = append(out.topic.RelatedTopics, name)
	}
	if err := relatedRows.Err(); err != nil {
		return out, err
	}

	out.learner, err = m.learnerContext(ctx, userID, topicID)
	return out, err
}

// learnerContext reads the learner's level, language and recent errors from where they
// already live: the profile and the mistake record. Nothing is duplicated into grammar.
func (m *Module) learnerContext(ctx context.Context, userID, topicID uuid.UUID) (ai.GrammarLearner, error) {
	learner := ai.GrammarLearner{UserID: userID, Level: cefr.MustParse("B1"), Language: "en"}

	var levelCode, language *string
	err := m.pool.QueryRow(ctx, `
		SELECT l.code, p.native_language
		FROM profiles p
		LEFT JOIN levels l ON l.id = p.current_level_id
		WHERE p.user_id = $1`, userID).Scan(&levelCode, &language)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return learner, err
	}
	if levelCode != nil {
		if parsed, err := cefr.Parse(*levelCode); err == nil {
			learner.Level = parsed
		}
	}
	if language != nil && *language != "" {
		learner.Language = *language
	}

	rows, err := m.pool.Query(ctx, `
		(SELECT e.last_example || ' → ' || e.last_correction
		   FROM grammar_user_errors e
		  WHERE e.user_id = $1 AND e.grammar_topic_id = $2 AND e.last_example <> ''
		  ORDER BY e.severity_score DESC LIMIT 4)
		UNION ALL
		(SELECT ms.original_text || ' → ' || ms.corrected_text
		   FROM mistakes ms
		  WHERE ms.user_id = $1 AND ms.grammar_topic_id = $2 AND ms.original_text <> ''
		  ORDER BY ms.created_at DESC LIMIT 4)`, userID, topicID)
	if err != nil {
		return learner, err
	}
	defer rows.Close()
	for rows.Next() {
		var mistake string
		if err := rows.Scan(&mistake); err != nil {
			return learner, err
		}
		learner.RecentMistakes = append(learner.RecentMistakes, mistake)
	}
	if err := rows.Err(); err != nil {
		return learner, err
	}

	knownRows, err := m.pool.Query(ctx, `
		SELECT t.name FROM user_grammar_progress p
		JOIN grammar_topics t ON t.id = p.grammar_topic_id
		WHERE p.user_id = $1 AND p.state = 'mastered'
		ORDER BY p.mastery DESC LIMIT 8`, userID)
	if err != nil {
		return learner, err
	}
	defer knownRows.Close()
	for knownRows.Next() {
		var name string
		if err := knownRows.Scan(&name); err != nil {
			return learner, err
		}
		learner.KnownTopics = append(learner.KnownTopics, name)
	}
	return learner, knownRows.Err()
}

func (m *Module) questionTopicID(ctx context.Context, questionID string) (uuid.UUID, error) {
	id, err := uuid.Parse(questionID)
	if err != nil {
		return uuid.Nil, apperr.NotFound("Question")
	}
	var topicID uuid.UUID
	err = m.pool.QueryRow(ctx, `SELECT grammar_topic_id FROM grammar_questions WHERE id = $1`, id).Scan(&topicID)
	return topicID, err
}

// aiFailure keeps an AI outage inside the AI feature. The grammar page, its content and its
// practice are all still there; only the generated extra is missing, and the message says so.
func (m *Module) aiFailure(err error, what string) error {
	var appErr *apperr.Error
	if errors.As(err, &appErr) && appErr.Code == apperr.CodeNotImplemented {
		return appErr
	}
	m.log.Warn("grammar AI call failed", "feature", what, "error", err.Error())
	return apperr.Wrap(err, apperr.CodeUnavailable,
		what+" is temporarily unavailable. Your grammar content and practice are still available.")
}

func nullUUID(id uuid.UUID) *uuid.UUID {
	if id == uuid.Nil {
		return nil
	}
	return &id
}
