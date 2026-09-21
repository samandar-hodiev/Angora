package assessment

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/assessment/scoring"
	"github.com/samandar-hodiev/engora/apps/api/internal/jobs"
	"github.com/samandar-hodiev/engora/apps/api/internal/levels"
	"github.com/samandar-hodiev/engora/apps/api/internal/onboarding"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/storage"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

// JobEvaluateSection evaluates a submitted writing or speaking section in the background.
const JobEvaluateSection = "assessment.evaluate_section"

// Evaluator is the AI side of the pipeline (implemented by ai.PlacementEvaluator).
type Evaluator interface {
	EvaluateWriting(ctx context.Context, in ai.WritingAssessmentInput) (*ai.WritingAssessment, ai.EvaluationMeta, error)
	EvaluateSpeaking(ctx context.Context, in ai.SpeakingAssessmentInput) (*ai.SpeakingAssessment, ai.EvaluationMeta, error)
	Transcribe(ctx context.Context, userID uuid.UUID, audio io.Reader, fileName, mimeType string) (*ai.TranscriptionResponse, error)
}

type PlanGenerator interface {
	GenerateForUser(ctx context.Context, userID uuid.UUID, sourceAssessmentID *uuid.UUID) (uuid.UUID, error)
}

// ProgressNotifier is told when an onboarding placement test moves forward.
type ProgressNotifier interface {
	PlacementProgressed(ctx context.Context, userID, assessmentID uuid.UUID, step onboarding.Step) error
}

// Notifier tells the learner their result is ready. Optional: a missing notifier must
// never stop an assessment from being scored.
type Notifier interface {
	Notify(ctx context.Context, userID uuid.UUID, templateCode string, vars map[string]any) error
}

type Deps struct {
	Pool           *pgxpool.Pool
	Storage        storage.ObjectStorage
	Queue          jobs.Queue
	Evaluator      Evaluator
	Plans          PlanGenerator
	Progress       ProgressNotifier
	Notifier       Notifier
	Tracker        analytics.Tracker
	Log            *slog.Logger
	MaxUploadBytes int64
}

type Service struct {
	pool      *pgxpool.Pool
	store     storage.ObjectStorage
	queue     jobs.Queue
	evaluator Evaluator
	plans     PlanGenerator
	progress  ProgressNotifier
	notifier  Notifier
	tracker   analytics.Tracker
	log       *slog.Logger
	maxUpload int64
	now       func() time.Time
}

func NewService(d Deps) *Service {
	return &Service{
		pool: d.Pool, store: d.Storage, queue: d.Queue, evaluator: d.Evaluator, plans: d.Plans,
		progress: d.Progress, notifier: d.Notifier, tracker: d.Tracker, log: d.Log,
		maxUpload: d.MaxUploadBytes, now: time.Now,
	}
}

var errUnavailable = apperr.New(apperr.CodeUnavailable, "The placement test is not available right now. Please try again later.")

// ---- loading ------------------------------------------------------------------------------

type assessmentRow struct {
	ID          uuid.UUID
	UserID      uuid.UUID
	Kind        string
	Status      string
	Source      string
	Config      Config
	StartLevel  cefr.Level
	StartedAt   time.Time
	SubmittedAt *time.Time
	CompletedAt *time.Time
	AbandonedAt *time.Time
}

func loadAssessment(ctx context.Context, q levels.Querier, userID, id uuid.UUID, lock bool) (assessmentRow, error) {
	sql := `
		SELECT a.id, a.user_id, a.kind, a.status, a.source, a.config, l.code, a.started_at, a.submitted_at, a.completed_at, a.abandoned_at
		FROM assessments a JOIN levels l ON l.id = a.start_level_id
		WHERE a.id = $1 AND a.user_id = $2`
	if lock {
		sql += ` FOR UPDATE OF a`
	}
	var a assessmentRow
	var start string
	err := q.QueryRow(ctx, sql, id, userID).Scan(&a.ID, &a.UserID, &a.Kind, &a.Status, &a.Source, &a.Config, &start,
		&a.StartedAt, &a.SubmittedAt, &a.CompletedAt, &a.AbandonedAt)
	if database.IsNotFound(err) {
		return a, apperr.NotFound("Assessment")
	}
	if err != nil {
		return a, err
	}
	a.StartLevel, err = cefr.Parse(start)
	return a, err
}

type sectionRow struct {
	ID            uuid.UUID
	Skill         string
	Position      int
	Status        string
	TimeLimit     int
	StartedAt     *time.Time
	DeadlineAt    *time.Time
	SubmittedAt   *time.Time
	CompletedAt   *time.Time
	ErrorCode     string
	ItemCount     int
	AnsweredCount int
}

const sectionColumns = `
	s.id, s.skill, s.position, s.status, s.time_limit_seconds, s.started_at, s.deadline_at, s.submitted_at, s.completed_at, s.error_code,
	(SELECT count(*) FROM assessment_section_items si WHERE si.section_id = s.id),
	(SELECT count(*) FROM assessment_answers aa WHERE aa.section_id = s.id AND aa.response <> '{}'::jsonb)
	  + (SELECT count(DISTINCT sp.assessment_item_id) FROM speaking_sessions sp WHERE sp.assessment_section_id = s.id)`

func scanSection(row pgx.Row) (sectionRow, error) {
	var s sectionRow
	err := row.Scan(&s.ID, &s.Skill, &s.Position, &s.Status, &s.TimeLimit, &s.StartedAt, &s.DeadlineAt, &s.SubmittedAt,
		&s.CompletedAt, &s.ErrorCode, &s.ItemCount, &s.AnsweredCount)
	return s, err
}

func loadSections(ctx context.Context, q levels.Querier, assessmentID uuid.UUID) ([]sectionRow, error) {
	rows, err := q.Query(ctx, `SELECT `+sectionColumns+` FROM assessment_sections s WHERE s.assessment_id = $1 ORDER BY s.position`, assessmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []sectionRow
	for rows.Next() {
		s, err := scanSection(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func loadSection(ctx context.Context, q levels.Querier, assessmentID uuid.UUID, skill string, lock bool) (sectionRow, error) {
	sql := `SELECT ` + sectionColumns + ` FROM assessment_sections s WHERE s.assessment_id = $1 AND s.skill = $2`
	if lock {
		sql += ` FOR UPDATE OF s`
	}
	s, err := scanSection(q.QueryRow(ctx, sql, assessmentID, skill))
	if database.IsNotFound(err) {
		return s, apperr.NotFound("Section")
	}
	return s, err
}

func (s *Service) sectionView(cfg Config, r sectionRow) Section {
	sc, _ := cfg.Section(r.Skill)
	itemCount := r.ItemCount
	if itemCount == 0 {
		// An adaptive section has no items until it starts. The overview still has to say
		// how long it is, so it reports what the configuration promises.
		for _, n := range sc.Items {
			itemCount += n
		}
	}
	v := Section{
		Skill: r.Skill, Position: int(r.Position), Status: r.Status, TimeLimitSeconds: r.TimeLimit,
		ItemCount: itemCount, AnsweredCount: min(r.AnsweredCount, itemCount), StartedAt: r.StartedAt, DeadlineAt: r.DeadlineAt,
		SubmittedAt: r.SubmittedAt, CompletedAt: r.CompletedAt, ErrorCode: r.ErrorCode, MaxPlays: sc.MaxPlays,
	}
	if r.Skill == scoring.SkillSpeaking {
		v.MaxAttempts = max(sc.MaxAttempts, 1)
	}
	return v
}

func (s *Service) view(ctx context.Context, userID, id uuid.UUID) (Assessment, error) {
	a, err := loadAssessment(ctx, s.pool, userID, id, false)
	if err != nil {
		return Assessment{}, err
	}
	sections, err := loadSections(ctx, s.pool, id)
	if err != nil {
		return Assessment{}, err
	}
	out := Assessment{
		ID: a.ID, Kind: a.Kind, Status: a.Status, Source: a.Source, StartLevel: a.StartLevel, StartedAt: a.StartedAt,
		SubmittedAt: a.SubmittedAt, CompletedAt: a.CompletedAt, AbandonedAt: a.AbandonedAt, ServerTime: s.now(),
		Sections: make([]Section, 0, len(sections)),
	}
	for _, sec := range sections {
		out.Sections = append(out.Sections, s.sectionView(a.Config, sec))
	}
	if a.Status == StatusInProgress {
		for _, want := range []string{SectionInProgress, SectionAvailable} {
			for _, sec := range sections {
				if sec.Status == want && out.CurrentSkill == nil {
					skill := sec.Skill
					out.CurrentSkill = &skill
				}
			}
		}
	}
	return out, nil
}

// ---- creating -----------------------------------------------------------------------------

// ActiveConfig returns the configuration new placement tests are created with.
func (s *Service) ActiveConfig(ctx context.Context) (Config, error) {
	var cfg Config
	err := s.pool.QueryRow(ctx, `SELECT config FROM assessment_configs WHERE kind = $1 AND status = 'active'`, KindPlacement).Scan(&cfg)
	if database.IsNotFound(err) {
		return cfg, errUnavailable
	}
	return cfg, err
}

// StartPlacement creates a placement test for the learner, or returns their open one.
func (s *Service) StartPlacement(ctx context.Context, userID uuid.UUID, start cefr.Level, source, platform string) (uuid.UUID, error) {
	if !start.Valid() || start.Plus || start.Base > 5 {
		return uuid.Nil, apperr.Validation(map[string]any{"fields": map[string]any{"start_level": "choose a level from A1 to C1"}})
	}
	if source != "onboarding" && source != "profile" {
		source = "profile"
	}
	if id, ok, err := s.openAssessment(ctx, userID); err != nil || ok {
		return id, err
	}

	var configID uuid.UUID
	var cfg Config
	err := s.pool.QueryRow(ctx, `SELECT id, config FROM assessment_configs WHERE kind = $1 AND status = 'active'`, KindPlacement).Scan(&configID, &cfg)
	if database.IsNotFound(err) {
		return uuid.Nil, errUnavailable
	}
	if err != nil {
		return uuid.Nil, err
	}
	if err := cfg.Validate(); err != nil {
		logger.FromContext(ctx, s.log).Error("invalid active placement config", slog.String("error", err.Error()))
		return uuid.Nil, errUnavailable
	}

	rows, err := s.pool.Query(ctx, `
		SELECT i.id, i.version, l.rank, i.stimulus_id, i.position, i.skill
		FROM assessment_items i JOIN levels l ON l.id = i.level_id
		WHERE i.kind = $1 AND i.status = 'published'`, KindPlacement)
	if err != nil {
		return uuid.Nil, err
	}
	bySkill := map[string][]candidate{}
	for rows.Next() {
		var c candidate
		var skill string
		if err := rows.Scan(&c.ID, &c.Version, &c.Level, &c.StimulusID, &c.Position, &skill); err != nil {
			rows.Close()
			return uuid.Nil, err
		}
		bySkill[skill] = append(bySkill[skill], c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return uuid.Nil, err
	}

	id := uuid.New()
	rng := rand.New(rand.NewPCG(binary.BigEndian.Uint64(id[:8]), binary.BigEndian.Uint64(id[8:])))
	// An adaptive test only fixes its first section now. The rest are chosen when they
	// start, around what the earlier sections measured (see adaptive.go). The bank is still
	// checked for every section here, so a test can never begin and then strand the learner
	// at section three because the content was never there.
	later := adaptiveSkills(cfg)
	picks := map[string][]pick{}
	for _, sec := range cfg.Sections {
		p, err := selectItems(bySkill[sec.Skill], start, sec.Items, rng)
		if err != nil {
			logger.FromContext(ctx, s.log).Error("placement content missing", slog.String("skill", sec.Skill), slog.String("start", start.String()))
			return uuid.Nil, errUnavailable
		}
		if cfg.Adaptive && later[sec.Skill] {
			continue
		}
		picks[sec.Skill] = p
	}

	err = database.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO assessments (id, user_id, kind, config_id, config, start_level_id, source, client_platform)
			VALUES ($1, $2, $3, $4, $5, (SELECT id FROM levels WHERE code = $6), $7, $8)`,
			id, userID, KindPlacement, configID, cfg, start.BaseCode(), source, platform); err != nil {
			return err
		}
		for i, sec := range cfg.Sections {
			status := SectionLocked
			if i == 0 {
				status = SectionAvailable
			}
			var sectionID uuid.UUID
			if err := tx.QueryRow(ctx, `
				INSERT INTO assessment_sections (assessment_id, skill, position, status, time_limit_seconds)
				VALUES ($1, $2, $3, $4, $5) RETURNING id`, id, sec.Skill, i+1, status, sec.TimeLimitSeconds).Scan(&sectionID); err != nil {
				return err
			}
			for pos, p := range picks[sec.Skill] {
				if _, err := tx.Exec(ctx, `
					INSERT INTO assessment_section_items (section_id, item_id, item_version, position, band)
					VALUES ($1, $2, $3, $4, $5)`, sectionID, p.ID, p.Version, pos+1, p.Band); err != nil {
					return err
				}
			}
		}
		return levels.Record(ctx, tx, userID, levels.Entry{Kind: levels.KindPlacementStart, CEFR: start, SourceType: levels.SourceAssessment, SourceID: &id})
	})
	if database.IsUniqueViolation(err) {
		// Another request (double tap, second device) created it first.
		if existing, ok, err2 := s.openAssessment(ctx, userID); err2 == nil && ok {
			return existing, nil
		}
	}
	if err != nil {
		return uuid.Nil, fmt.Errorf("create assessment: %w", err)
	}
	s.tracker.Track(ctx, analytics.Server(analytics.EventPlacementStarted, userID, map[string]any{
		"assessment_id": id, "start_level": start.String(), "source": source,
	}))
	return id, nil
}

func (s *Service) openAssessment(ctx context.Context, userID uuid.UUID) (uuid.UUID, bool, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		SELECT id FROM assessments WHERE user_id = $1 AND kind = $2 AND status IN ('in_progress', 'processing')`,
		userID, KindPlacement).Scan(&id)
	if database.IsNotFound(err) {
		return uuid.Nil, false, nil
	}
	return id, err == nil, err
}

// ---- reading state ------------------------------------------------------------------------

func (s *Service) Get(ctx context.Context, userID, id uuid.UUID) (Assessment, error) {
	if err := s.expireOverdue(ctx, userID, id); err != nil {
		return Assessment{}, err
	}
	return s.view(ctx, userID, id)
}

// Current returns the learner's open placement test, or nil.
func (s *Service) Current(ctx context.Context, userID uuid.UUID) (*Assessment, error) {
	id, ok, err := s.openAssessment(ctx, userID)
	if err != nil || !ok {
		return nil, err
	}
	a, err := s.Get(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// expireOverdue submits sections whose deadline (plus grace) has passed, using the answers
// saved so far. This makes the server's timer authoritative even if the browser was closed.
func (s *Service) expireOverdue(ctx context.Context, userID, id uuid.UUID) error {
	a, err := loadAssessment(ctx, s.pool, userID, id, false)
	if err != nil || a.Status != StatusInProgress {
		return err
	}
	sections, err := loadSections(ctx, s.pool, id)
	if err != nil {
		return err
	}
	grace := time.Duration(a.Config.GraceSeconds) * time.Second
	for _, sec := range sections {
		if sec.Status == SectionInProgress && sec.DeadlineAt != nil && s.now().After(sec.DeadlineAt.Add(grace)) {
			if err := s.submit(ctx, userID, id, sec.Skill, true); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) Content(ctx context.Context, userID, id uuid.UUID, skill string) (SectionContent, error) {
	if err := s.expireOverdue(ctx, userID, id); err != nil {
		return SectionContent{}, err
	}
	a, err := loadAssessment(ctx, s.pool, userID, id, false)
	if err != nil {
		return SectionContent{}, err
	}
	sec, err := loadSection(ctx, s.pool, id, skill, false)
	if err != nil {
		return SectionContent{}, err
	}
	if sec.Status == SectionLocked || sec.Status == SectionAvailable {
		return SectionContent{}, apperr.Conflict("Start this section first").WithDetails(map[string]any{"status": sec.Status})
	}

	out := SectionContent{AssessmentID: id, Section: s.sectionView(a.Config, sec), Stimuli: []Stimulus{}, Items: []Item{}, Answers: []Answer{}, ServerTime: s.now()}

	rows, err := s.pool.Query(ctx, `
		SELECT i.id, si.position, i.item_type, i.stimulus_id, i.prompt, i.options, i.settings
		FROM assessment_section_items si JOIN assessment_items i ON i.id = si.item_id
		WHERE si.section_id = $1 ORDER BY si.position`, sec.ID)
	if err != nil {
		return out, err
	}
	var stimulusIDs []uuid.UUID
	for rows.Next() {
		var it Item
		if err := rows.Scan(&it.ID, &it.Position, &it.Type, &it.StimulusID, &it.Prompt, &it.Options, &it.Settings); err != nil {
			rows.Close()
			return out, err
		}
		if it.StimulusID != nil && !slices.Contains(stimulusIDs, *it.StimulusID) {
			stimulusIDs = append(stimulusIDs, *it.StimulusID)
		}
		out.Items = append(out.Items, it)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return out, err
	}

	if len(stimulusIDs) > 0 {
		rows, err := s.pool.Query(ctx, `SELECT id, type, title, body FROM content_items WHERE id = ANY($1)`, stimulusIDs)
		if err != nil {
			return out, err
		}
		byID := map[uuid.UUID]Stimulus{}
		for rows.Next() {
			var st Stimulus
			var body map[string]any
			if err := rows.Scan(&st.ID, &st.Type, &st.Title, &body); err != nil {
				rows.Close()
				return out, err
			}
			if p, ok := body["passage"].(string); ok {
				st.Passage = &p
			}
			if _, ok := body["audio_file_id"].(string); ok {
				st.HasAudio = true
			}
			if d, ok := body["duration_ms"].(float64); ok {
				ms := int(d)
				st.DurationMs = &ms
			}
			// The transcript stays hidden while the learner is still answering.
			if t, ok := body["transcript"].(string); ok && sec.Status != SectionInProgress {
				st.Transcript = &t
			}
			byID[st.ID] = st
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return out, err
		}
		for _, sid := range stimulusIDs {
			out.Stimuli = append(out.Stimuli, byID[sid])
		}
	}

	answers := map[uuid.UUID]*Answer{}
	rows, err = s.pool.Query(ctx, `SELECT item_id, response, answered_at FROM assessment_answers WHERE section_id = $1`, sec.ID)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var ans Answer
		if err := rows.Scan(&ans.ItemID, &ans.Response, &ans.AnsweredAt); err != nil {
			rows.Close()
			return out, err
		}
		answers[ans.ItemID] = &ans
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return out, err
	}

	if skill == scoring.SkillSpeaking {
		rows, err := s.pool.Query(ctx, `
			SELECT id, assessment_item_id, attempt_number, status, duration_ms, created_at
			FROM speaking_sessions WHERE assessment_section_id = $1 ORDER BY attempt_number`, sec.ID)
		if err != nil {
			return out, err
		}
		for rows.Next() {
			var at Attempt
			var itemID uuid.UUID
			if err := rows.Scan(&at.ID, &itemID, &at.AttemptNumber, &at.Status, &at.DurationMs, &at.CreatedAt); err != nil {
				rows.Close()
				return out, err
			}
			ans := answers[itemID]
			if ans == nil {
				ans = &Answer{ItemID: itemID, Response: json.RawMessage(`{}`), AnsweredAt: at.CreatedAt}
				answers[itemID] = ans
			}
			ans.Attempts = append(ans.Attempts, at)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return out, err
		}
	}
	for _, it := range out.Items {
		if ans := answers[it.ID]; ans != nil {
			out.Answers = append(out.Answers, *ans)
		}
	}
	return out, nil
}

// ---- taking the test ----------------------------------------------------------------------

func (s *Service) StartSection(ctx context.Context, userID, id uuid.UUID, skill string) (SectionContent, error) {
	started := false
	var source string
	err := database.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		a, err := loadAssessment(ctx, tx, userID, id, true)
		if err != nil {
			return err
		}
		source = a.Source
		if a.Status != StatusInProgress {
			return apperr.Conflict("This test has already been submitted").WithDetails(map[string]any{"status": a.Status})
		}
		sec, err := loadSection(ctx, tx, id, skill, true)
		if err != nil {
			return err
		}
		switch sec.Status {
		case SectionInProgress:
			return nil
		case SectionAvailable:
			// An adaptive section has no items until it opens. Filling happens inside the
			// same transaction that starts the clock, so a learner can never see a started
			// section with nothing in it.
			if sec.ItemCount == 0 {
				if err := s.fillSection(ctx, tx, a, sec); err != nil {
					return err
				}
			}
			now := s.now()
			started = true
			_, err := tx.Exec(ctx, `
				UPDATE assessment_sections SET status = 'in_progress', started_at = $2, deadline_at = $3 WHERE id = $1`,
				sec.ID, now, now.Add(time.Duration(sec.TimeLimit)*time.Second))
			return err
		case SectionLocked:
			return apperr.Conflict("Finish the previous section first").WithDetails(map[string]any{"status": sec.Status})
		default:
			return apperr.Conflict("This section has already been submitted").WithDetails(map[string]any{"status": sec.Status})
		}
	})
	if err != nil {
		return SectionContent{}, err
	}
	if started {
		s.notify(ctx, userID, id, onboarding.PlacementStep(skill))
		s.tracker.Track(ctx, analytics.Server(analytics.EventPlacementSectionStarted, userID, map[string]any{
			"assessment_id": id, "skill": skill, "source": source,
		}))
	}
	return s.Content(ctx, userID, id, skill)
}

type AnswerInput struct {
	Response    json.RawMessage `json:"response" binding:"required"`
	TimeSpentMs int             `json:"time_spent_ms" binding:"min=0,max=86400000"`
}

const maxWritingChars = 20000

var errTimeUp = apperr.Conflict("Time is up for this section").WithDetails(map[string]any{"reason": "time_expired"})

// lockOpenSection locks a section that is accepting answers.
func (s *Service) lockOpenSection(ctx context.Context, tx pgx.Tx, userID, id uuid.UUID, skill string) (assessmentRow, sectionRow, error) {
	a, err := loadAssessment(ctx, tx, userID, id, false)
	if err != nil {
		return a, sectionRow{}, err
	}
	if a.Status != StatusInProgress {
		return a, sectionRow{}, apperr.Conflict("This test has already been submitted")
	}
	sec, err := loadSection(ctx, tx, id, skill, true)
	if err != nil {
		return a, sec, err
	}
	if sec.Status != SectionInProgress {
		return a, sec, apperr.Conflict("This section is not in progress").WithDetails(map[string]any{"status": sec.Status})
	}
	grace := time.Duration(a.Config.GraceSeconds) * time.Second
	if sec.DeadlineAt != nil && s.now().After(sec.DeadlineAt.Add(grace)) {
		return a, sec, errTimeUp
	}
	return a, sec, nil
}

func (s *Service) SaveAnswer(ctx context.Context, userID, id uuid.UUID, skill string, itemID uuid.UUID, in AnswerInput) (Answer, error) {
	if skill == scoring.SkillSpeaking {
		return Answer{}, apperr.BadRequest("Speaking answers are submitted as recordings")
	}
	var out Answer
	err := database.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		_, sec, err := s.lockOpenSection(ctx, tx, userID, id, skill)
		if err != nil {
			return err
		}
		var itemType string
		var options []Option
		err = tx.QueryRow(ctx, `
			SELECT i.item_type, i.options FROM assessment_section_items si JOIN assessment_items i ON i.id = si.item_id
			WHERE si.section_id = $1 AND si.item_id = $2`, sec.ID, itemID).Scan(&itemType, &options)
		if database.IsNotFound(err) {
			return apperr.NotFound("Question")
		}
		if err != nil {
			return err
		}

		response, err := normalizeResponse(itemType, options, in.Response)
		if err != nil {
			return err
		}
		out = Answer{ItemID: itemID, Response: response}
		return tx.QueryRow(ctx, `
			INSERT INTO assessment_answers (section_id, item_id, response, time_spent_ms, answered_at)
			VALUES ($1, $2, $3, $4, now())
			ON CONFLICT (section_id, item_id) DO UPDATE SET response = EXCLUDED.response,
			    time_spent_ms = GREATEST(assessment_answers.time_spent_ms, EXCLUDED.time_spent_ms), answered_at = now()
			RETURNING answered_at`, sec.ID, itemID, response, in.TimeSpentMs).Scan(&out.AnsweredAt)
	})
	return out, err
}

// normalizeResponse validates a client response against the item. Clients send only what
// the learner chose or wrote, never whether it was correct.
func normalizeResponse(itemType string, options []Option, raw json.RawMessage) (json.RawMessage, error) {
	invalid := func(msg string) error {
		return apperr.Validation(map[string]any{"fields": map[string]any{"response": msg}})
	}
	switch itemType {
	case "writing_task":
		var r struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal(raw, &r); err != nil {
			return nil, invalid("must be {\"text\": \"...\"}")
		}
		if utf8.RuneCountInString(r.Text) > maxWritingChars {
			return nil, invalid("is too long")
		}
		return json.Marshal(r)
	case "speaking_task":
		return nil, invalid("speaking answers are submitted as recordings")
	default:
		var r struct {
			OptionID *string `json:"option_id"`
		}
		if err := json.Unmarshal(raw, &r); err != nil {
			return nil, invalid("must be {\"option_id\": \"...\"}")
		}
		if r.OptionID == nil {
			return json.RawMessage(`{}`), nil // cleared
		}
		if !slices.ContainsFunc(options, func(o Option) bool { return o.ID == *r.OptionID }) {
			return nil, invalid("is not one of the options")
		}
		return json.Marshal(r)
	}
}

// UploadRecording stores a speaking attempt. Audio goes to object storage; PostgreSQL keeps
// the metadata. A retried upload of the same bytes returns the existing attempt.
func (s *Service) UploadRecording(ctx context.Context, userID, id, itemID uuid.UUID, declaredType string, size int64, body io.Reader, durationMs int, platform string) (Attempt, error) {
	policy := storage.AudioPolicy(s.maxUpload)
	data, err := io.ReadAll(io.LimitReader(body, s.maxUpload+1))
	if err != nil {
		return Attempt{}, apperr.BadRequest("The recording could not be read. Please try again.")
	}
	if int64(len(data)) > s.maxUpload {
		size = int64(len(data))
	}
	head := data[:min(len(data), 512)]
	allowed, err := policy.Validate(declaredType, max(size, int64(len(data))), head)
	if err != nil {
		return Attempt{}, err
	}
	sum := sha256.Sum256(data)
	checksum := hex.EncodeToString(sum[:])

	var maxAttempts, responseSeconds int
	var existing *Attempt
	err = database.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		a, sec, err := s.lockOpenSection(ctx, tx, userID, id, scoring.SkillSpeaking)
		if err != nil {
			return err
		}
		sc, _ := a.Config.Section(scoring.SkillSpeaking)
		maxAttempts = max(sc.MaxAttempts, 1)
		var settings map[string]any
		err = tx.QueryRow(ctx, `
			SELECT i.settings FROM assessment_section_items si JOIN assessment_items i ON i.id = si.item_id
			WHERE si.section_id = $1 AND si.item_id = $2 AND i.item_type = 'speaking_task'`, sec.ID, itemID).Scan(&settings)
		if database.IsNotFound(err) {
			return apperr.NotFound("Speaking task")
		}
		if err != nil {
			return err
		}
		if v, ok := settings["response_seconds"].(float64); ok {
			responseSeconds = int(v)
		}
		var at Attempt
		var lastChecksum string
		err = tx.QueryRow(ctx, `
			SELECT sp.id, sp.attempt_number, sp.status, sp.duration_ms, sp.created_at, af.checksum_sha256
			FROM speaking_sessions sp JOIN audio_files af ON af.id = sp.audio_file_id
			WHERE sp.assessment_section_id = $1 AND sp.assessment_item_id = $2
			ORDER BY sp.attempt_number DESC LIMIT 1`, sec.ID, itemID).Scan(&at.ID, &at.AttemptNumber, &at.Status, &at.DurationMs, &at.CreatedAt, &lastChecksum)
		switch {
		case err == nil && lastChecksum == checksum:
			existing = &at
		case err == nil && at.AttemptNumber >= maxAttempts:
			return apperr.Conflict("You've used all your recording attempts for this task").WithDetails(map[string]any{"reason": "attempts_exhausted"})
		case err != nil && !database.IsNotFound(err):
			return err
		}
		return nil
	})
	if err != nil || existing != nil {
		if existing != nil {
			return *existing, nil
		}
		return Attempt{}, err
	}

	key := storage.NewKey("audio", userID, allowed.Extension, s.now())
	if err := s.store.Put(ctx, key, bytes.NewReader(data), int64(len(data)), allowed.Canonical); err != nil {
		logger.FromContext(ctx, s.log).Error("store recording failed", slog.String("error", err.Error()))
		return Attempt{}, apperr.New(apperr.CodeUnavailable, "We couldn't save your recording. Please try again.")
	}
	if responseSeconds > 0 {
		durationMs = max(0, min(durationMs, (responseSeconds+60)*1000))
	}

	var at Attempt
	err = database.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		_, sec, err := s.lockOpenSection(ctx, tx, userID, id, scoring.SkillSpeaking)
		if err != nil {
			return err
		}
		var count int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM speaking_sessions WHERE assessment_section_id = $1 AND assessment_item_id = $2`,
			sec.ID, itemID).Scan(&count); err != nil {
			return err
		}
		if count >= maxAttempts {
			return apperr.Conflict("You've used all your recording attempts for this task").WithDetails(map[string]any{"reason": "attempts_exhausted"})
		}
		var audioID uuid.UUID
		if err := tx.QueryRow(ctx, `
			INSERT INTO audio_files (user_id, storage_provider, storage_key, mime_type, size_bytes, duration_ms, checksum_sha256, purpose, status)
			VALUES ($1, $2, $3, $4, $5, $6, $7, 'placement_speaking', 'uploaded') RETURNING id`,
			userID, s.store.Provider(), key, allowed.Canonical, len(data), durationMs, checksum).Scan(&audioID); err != nil {
			return err
		}
		at = Attempt{AttemptNumber: count + 1, Status: "in_progress", DurationMs: &durationMs}
		if err := tx.QueryRow(ctx, `
			INSERT INTO speaking_sessions (user_id, mode, status, audio_file_id, duration_ms, client_platform,
			                               assessment_section_id, assessment_item_id, attempt_number)
			VALUES ($1, 'placement', 'in_progress', $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
			userID, audioID, durationMs, platform, sec.ID, itemID, at.AttemptNumber).Scan(&at.ID, &at.CreatedAt); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO assessment_answers (section_id, item_id, response, answered_at) VALUES ($1, $2, $3, now())
			ON CONFLICT (section_id, item_id) DO UPDATE SET response = EXCLUDED.response, answered_at = now()`,
			sec.ID, itemID, map[string]any{"speaking_session_id": at.ID})
		return err
	})
	if err != nil {
		_ = s.store.Delete(context.WithoutCancel(ctx), key)
		return Attempt{}, err
	}
	return at, nil
}

func (s *Service) SubmitSection(ctx context.Context, userID, id uuid.UUID, skill string) (Assessment, error) {
	if err := s.submit(ctx, userID, id, skill, false); err != nil {
		return Assessment{}, err
	}
	return s.view(ctx, userID, id)
}

// submit closes a section. It is idempotent: submitting an already submitted section
// (double tap, retry after a network error, auto-submit racing a manual one) changes nothing.
func (s *Service) submit(ctx context.Context, userID, id uuid.UUID, skill string, auto bool) error {
	var (
		enqueue, finalizeCheck, changed bool
		nextSkill, source               string
	)
	err := database.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		a, err := loadAssessment(ctx, tx, userID, id, true)
		if err != nil {
			return err
		}
		source = a.Source
		sec, err := loadSection(ctx, tx, id, skill, true)
		if err != nil {
			return err
		}
		switch sec.Status {
		case SectionEvaluating, SectionCompleted, SectionFailed:
			return nil
		case SectionInProgress:
		default:
			return apperr.Conflict("Start this section first").WithDetails(map[string]any{"status": sec.Status})
		}
		if a.Status != StatusInProgress {
			return apperr.Conflict("This test is no longer in progress").WithDetails(map[string]any{"status": a.Status})
		}
		changed = true
		now := s.now()

		switch {
		case isObjective(skill):
			result, err := scoreObjectiveSection(ctx, tx, sec.ID, skill)
			if err != nil {
				return err
			}
			if err := insertSkillResult(ctx, tx, id, result); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE assessment_sections SET status = 'completed', submitted_at = $2, completed_at = $2 WHERE id = $1`, sec.ID, now); err != nil {
				return err
			}
			finalizeCheck = true
		case skill == scoring.SkillWriting:
			timeSpent := 0
			if sec.StartedAt != nil {
				timeSpent = int(now.Sub(*sec.StartedAt).Milliseconds())
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO writing_submissions (user_id, mode, status, text, word_count, submitted_at, time_spent_ms,
				                                 assessment_section_id, assessment_item_id, client_platform)
				SELECT $1, 'placement', 'submitted', COALESCE(aa.response->>'text', ''), 0, $2, $3, si.section_id, si.item_id, $4
				FROM assessment_section_items si
				LEFT JOIN assessment_answers aa ON aa.section_id = si.section_id AND aa.item_id = si.item_id
				WHERE si.section_id = $5
				ON CONFLICT (assessment_section_id, assessment_item_id) WHERE assessment_section_id IS NOT NULL DO NOTHING`,
				userID, now, timeSpent, "server", sec.ID); err != nil {
				return err
			}
			if err := updateWordCounts(ctx, tx, sec.ID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE assessment_sections SET status = 'evaluating', submitted_at = $2 WHERE id = $1`, sec.ID, now); err != nil {
				return err
			}
			enqueue = true
		case skill == scoring.SkillSpeaking:
			if _, err := tx.Exec(ctx, `
				UPDATE speaking_sessions sp SET
				    status = CASE WHEN sp.id = latest.id THEN 'submitted' ELSE 'abandoned' END,
				    submitted_at = CASE WHEN sp.id = latest.id THEN $2 ELSE sp.submitted_at END
				FROM (SELECT DISTINCT ON (assessment_item_id) id, assessment_item_id FROM speaking_sessions
				      WHERE assessment_section_id = $1 ORDER BY assessment_item_id, attempt_number DESC) latest
				WHERE sp.assessment_section_id = $1 AND sp.assessment_item_id = latest.assessment_item_id`, sec.ID, now); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE assessment_sections SET status = 'evaluating', submitted_at = $2 WHERE id = $1`, sec.ID, now); err != nil {
				return err
			}
			enqueue = true
		}

		err = tx.QueryRow(ctx, `
			UPDATE assessment_sections SET status = 'available'
			WHERE assessment_id = $1 AND position = $2 AND status = 'locked' RETURNING skill`, id, sec.Position+1).Scan(&nextSkill)
		if err != nil && !database.IsNotFound(err) {
			return err
		}
		var remaining int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM assessment_sections WHERE assessment_id = $1 AND status IN ('locked', 'available', 'in_progress')`, id).Scan(&remaining); err != nil {
			return err
		}
		if remaining == 0 {
			if _, err := tx.Exec(ctx, `UPDATE assessments SET status = 'processing', submitted_at = $2 WHERE id = $1`, id, now); err != nil {
				return err
			}
			finalizeCheck = true
		}
		return nil
	})
	if err != nil || !changed {
		return err
	}

	s.tracker.Track(ctx, analytics.Server(analytics.EventPlacementSectionCompleted, userID, map[string]any{
		"assessment_id": id, "skill": skill, "auto_submitted": auto, "source": source,
	}))
	if nextSkill != "" {
		s.notify(ctx, userID, id, onboarding.PlacementStep(nextSkill))
	} else {
		s.notify(ctx, userID, id, onboarding.StepPlacementProcessing)
	}
	if enqueue {
		if err := s.enqueueEvaluation(ctx, userID, id, skill); err != nil {
			logger.FromContext(ctx, s.log).Error("enqueue evaluation failed", slog.String("error", err.Error()))
			s.markSectionFailed(ctx, id, skill, "queue_unavailable")
		}
	}
	if finalizeCheck {
		if err := s.maybeFinalize(ctx, id); err != nil {
			logger.FromContext(ctx, s.log).Error("finalize assessment failed", slog.String("error", err.Error()))
		}
	}
	return nil
}

func countWords(text string) int { return len(strings.Fields(text)) }

func updateWordCounts(ctx context.Context, tx pgx.Tx, sectionID uuid.UUID) error {
	rows, err := tx.Query(ctx, `SELECT id, text FROM writing_submissions WHERE assessment_section_id = $1`, sectionID)
	if err != nil {
		return err
	}
	counts := map[uuid.UUID]int{}
	for rows.Next() {
		var wid uuid.UUID
		var text string
		if err := rows.Scan(&wid, &text); err != nil {
			rows.Close()
			return err
		}
		counts[wid] = countWords(text)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for wid, n := range counts {
		if _, err := tx.Exec(ctx, `UPDATE writing_submissions SET word_count = $2 WHERE id = $1`, wid, n); err != nil {
			return err
		}
	}
	return nil
}

// scoreObjectiveSection marks each answer against the answer key (server-side only) and
// scores the section.
func scoreObjectiveSection(ctx context.Context, tx pgx.Tx, sectionID uuid.UUID, skill string) (scoring.SkillResult, error) {
	rows, err := tx.Query(ctx, `
		SELECT si.item_id, i.item_type, l.rank, i.difficulty, i.answer_key->>'option_id', aa.response->>'option_id'
		FROM assessment_section_items si
		JOIN assessment_items i ON i.id = si.item_id
		JOIN levels l ON l.id = i.level_id
		LEFT JOIN assessment_answers aa ON aa.section_id = si.section_id AND aa.item_id = si.item_id
		WHERE si.section_id = $1 ORDER BY si.position`, sectionID)
	if err != nil {
		return scoring.SkillResult{}, err
	}
	type marked struct {
		itemID  uuid.UUID
		correct bool
	}
	var responses []scoring.ObjectiveResponse
	var marks []marked
	for rows.Next() {
		var itemID uuid.UUID
		var itemType string
		var rank, difficulty int
		var key, given *string
		if err := rows.Scan(&itemID, &itemType, &rank, &difficulty, &key, &given); err != nil {
			rows.Close()
			return scoring.SkillResult{}, err
		}
		answered := given != nil && *given != ""
		correct := answered && key != nil && *given == *key
		responses = append(responses, scoring.ObjectiveResponse{
			ItemType: itemType, Level: cefr.Level{Base: rank}, Difficulty: difficulty, Answered: answered, Correct: correct,
		})
		marks = append(marks, marked{itemID, correct})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return scoring.SkillResult{}, err
	}
	for _, m := range marks {
		points := 0.0
		if m.correct {
			points = 1
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO assessment_answers (section_id, item_id, response, is_correct, points)
			VALUES ($1, $2, '{}', $3, $4)
			ON CONFLICT (section_id, item_id) DO UPDATE SET is_correct = EXCLUDED.is_correct, points = EXCLUDED.points`,
			sectionID, m.itemID, m.correct, points); err != nil {
			return scoring.SkillResult{}, err
		}
	}
	return scoring.ScoreObjective(skill, responses), nil
}

func insertSkillResult(ctx context.Context, q levels.Querier, assessmentID uuid.UUID, r scoring.SkillResult) error {
	_, err := q.Exec(ctx, `
		INSERT INTO assessment_skill_results (assessment_id, skill, score, cefr, confidence, subscores, evidence, scoring_version)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (assessment_id, skill) DO NOTHING`,
		assessmentID, r.Skill, r.Score, r.Level.String(), r.Confidence, r.Subscores, r.Evidence, scoring.Version)
	return err
}

func (s *Service) notify(ctx context.Context, userID, id uuid.UUID, step onboarding.Step) {
	if s.progress == nil || step == "" {
		return
	}
	if err := s.progress.PlacementProgressed(ctx, userID, id, step); err != nil {
		logger.FromContext(ctx, s.log).Warn("onboarding progress update failed", slog.String("error", err.Error()))
	}
}

// AbandonPlacement closes an unfinished test. The record is kept as history.
func (s *Service) AbandonPlacement(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE assessments SET status = 'abandoned', abandoned_at = now()
		WHERE id = $1 AND user_id = $2 AND status = 'in_progress'`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		a, err := loadAssessment(ctx, s.pool, userID, id, false)
		if err != nil {
			return err
		}
		if a.Status == StatusAbandoned {
			return nil
		}
		return apperr.Conflict("This test has already been submitted").WithDetails(map[string]any{"status": a.Status})
	}
	_, _ = s.pool.Exec(ctx, `
		UPDATE speaking_sessions SET status = 'abandoned'
		WHERE status = 'in_progress' AND assessment_section_id IN (SELECT id FROM assessment_sections WHERE assessment_id = $1)`, id)
	s.tracker.Track(ctx, analytics.Server(analytics.EventPlacementAbandoned, userID, map[string]any{"assessment_id": id}))
	return nil
}

// RetryEvaluation re-queues a section whose evaluation failed. The learner's submission is
// kept, so they never repeat the test.
func (s *Service) RetryEvaluation(ctx context.Context, userID, id uuid.UUID, skill string) (Assessment, error) {
	if _, err := loadAssessment(ctx, s.pool, userID, id, false); err != nil {
		return Assessment{}, err
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE assessment_sections SET status = 'evaluating', error_code = '' WHERE assessment_id = $1 AND skill = $2 AND status = 'failed'`, id, skill)
	if err != nil {
		return Assessment{}, err
	}
	if tag.RowsAffected() > 0 {
		if err := s.enqueueEvaluation(ctx, userID, id, skill); err != nil {
			s.markSectionFailed(ctx, id, skill, "queue_unavailable")
			return Assessment{}, apperr.New(apperr.CodeUnavailable, "We couldn't restart the analysis. Please try again.")
		}
	}
	return s.view(ctx, userID, id)
}

func (s *Service) enqueueEvaluation(ctx context.Context, userID, id uuid.UUID, skill string) error {
	job, err := jobs.New(JobEvaluateSection, &userID, evaluatePayload{AssessmentID: id, Skill: skill})
	if err != nil {
		return err
	}
	return s.queue.Enqueue(context.WithoutCancel(ctx), job)
}

func (s *Service) markSectionFailed(ctx context.Context, id uuid.UUID, skill, code string) {
	if _, err := s.pool.Exec(context.WithoutCancel(ctx), `
		UPDATE assessment_sections SET status = 'failed', error_code = $3 WHERE assessment_id = $1 AND skill = $2 AND status = 'evaluating'`,
		id, skill, code); err != nil {
		logger.FromContext(ctx, s.log).Error("mark section failed", slog.String("error", err.Error()))
	}
}

// ---- results ------------------------------------------------------------------------------

// maybeFinalize combines skill results once every section is completed.
func (s *Service) maybeFinalize(ctx context.Context, id uuid.UUID) error {
	ctx = context.WithoutCancel(ctx)
	var userID uuid.UUID
	var overall scoring.Overall
	finalized := false
	// Read before the transaction writes the new one: "your level moved from B1 to B2"
	// needs the level the learner had until a moment ago.
	previousLevel := ""
	err := database.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var status string
		if err := tx.QueryRow(ctx, `SELECT user_id, status FROM assessments WHERE id = $1 FOR UPDATE`, id).Scan(&userID, &status); err != nil {
			return err
		}
		if status != StatusProcessing {
			return nil
		}
		var pending int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM assessment_sections WHERE assessment_id = $1 AND status <> 'completed'`, id).Scan(&pending); err != nil {
			return err
		}
		if pending > 0 {
			return nil
		}
		var prev *string
		_ = tx.QueryRow(ctx, `
			SELECT l.code FROM profiles p JOIN levels l ON l.id = p.current_level_id
			WHERE p.user_id = $1`, userID).Scan(&prev)
		if prev != nil {
			previousLevel = *prev
		}

		rows, err := tx.Query(ctx, `SELECT skill, score::float8, cefr, confidence::float8, subscores FROM assessment_skill_results WHERE assessment_id = $1`, id)
		if err != nil {
			return err
		}
		var results []scoring.SkillResult
		for rows.Next() {
			var r scoring.SkillResult
			var code string
			if err := rows.Scan(&r.Skill, &r.Score, &code, &r.Confidence, &r.Subscores); err != nil {
				rows.Close()
				return err
			}
			if r.Level, err = cefr.Parse(code); err != nil {
				rows.Close()
				return err
			}
			results = append(results, r)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}

		overall = scoring.Combine(results)
		if _, err := tx.Exec(ctx, `
			INSERT INTO assessment_results (assessment_id, user_id, overall_cefr, overall_score, confidence, strengths, focus_areas, summary, scoring_version)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (assessment_id) DO NOTHING`,
			id, userID, overall.Level.String(), overall.Score, overall.Confidence, overall.Strengths, overall.FocusAreas,
			overall.Summary, scoring.Version); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE assessments SET status = 'completed', completed_at = now() WHERE id = $1`, id); err != nil {
			return err
		}
		confidence := overall.Confidence
		for _, kind := range []string{levels.KindAssessed, levels.KindEstimated} {
			if err := levels.Record(ctx, tx, userID, levels.Entry{Kind: kind, CEFR: overall.Level, SourceType: levels.SourceAssessment, SourceID: &id, Confidence: &confidence}); err != nil {
				return err
			}
		}
		for _, r := range results {
			if _, err := tx.Exec(ctx, `
				INSERT INTO skill_progress (user_id, skill_id, estimated_level_id, score)
				VALUES ($1, (SELECT id FROM skills WHERE code = $2), (SELECT id FROM levels WHERE code = $3), $4)
				ON CONFLICT (user_id, skill_id) DO UPDATE SET estimated_level_id = EXCLUDED.estimated_level_id, score = EXCLUDED.score`,
				userID, r.Skill, r.Level.BaseCode(), r.Score); err != nil {
				return err
			}
		}
		for _, area := range overall.FocusAreas {
			if area.Type != "criterion" {
				continue
			}
			skill, _, _ := strings.Cut(area.Code, ".")
			if err := upsertWeakness(ctx, tx, userID, id, skill, area.Code, 100-area.Score); err != nil {
				return err
			}
		}
		mrows, err := tx.Query(ctx, `
			SELECT m.category, s.code, count(*)::int FROM mistakes m LEFT JOIN skills s ON s.id = m.skill_id
			WHERE m.user_id = $1 AND m.analysis_id IN (
			    SELECT w.analysis_id FROM writing_submissions w JOIN assessment_sections sec ON sec.id = w.assessment_section_id WHERE sec.assessment_id = $2
			    UNION SELECT sp.analysis_id FROM speaking_sessions sp JOIN assessment_sections sec ON sec.id = sp.assessment_section_id WHERE sec.assessment_id = $2)
			GROUP BY m.category, s.code`, userID, id)
		if err != nil {
			return err
		}
		type mistakeCount struct {
			category string
			skill    *string
			n        int
		}
		var counts []mistakeCount
		for mrows.Next() {
			var mc mistakeCount
			if err := mrows.Scan(&mc.category, &mc.skill, &mc.n); err != nil {
				mrows.Close()
				return err
			}
			counts = append(counts, mc)
		}
		mrows.Close()
		if err := mrows.Err(); err != nil {
			return err
		}
		for _, mc := range counts {
			skill := ""
			if mc.skill != nil {
				skill = *mc.skill
			}
			if err := upsertWeakness(ctx, tx, userID, id, skill, mc.category, min(100, 35+float64(mc.n)*15)); err != nil {
				return err
			}
		}
		finalized = true
		return nil
	})
	if err != nil || !finalized {
		return err
	}

	if _, err := s.plans.GenerateForUser(ctx, userID, &id); err != nil {
		logger.FromContext(ctx, s.log).Error("generate plan after assessment failed", slog.String("error", err.Error()))
	}
	s.notify(ctx, userID, id, onboarding.StepPlacementResults)
	if s.notifier != nil {
		if err := s.notifier.Notify(ctx, userID, "assessment_completed", map[string]any{
			"score": fmt.Sprintf("%.0f", overall.Score), "level": overall.Level.String(),
		}); err != nil {
			logger.FromContext(ctx, s.log).Warn("assessment notification failed", slog.String("error", err.Error()))
		}
		// Only when it actually moved. "Your level is now B1" sent to somebody who was
		// already B1 reads as noise, and noise is what makes people mute notifications.
		if previousLevel != "" && previousLevel != overall.Level.String() {
			if err := s.notifier.Notify(ctx, userID, "level_changed", map[string]any{
				"level": overall.Level.String(), "previous": previousLevel,
			}); err != nil {
				logger.FromContext(ctx, s.log).Warn("level change notification failed", slog.String("error", err.Error()))
			}
		}
	}
	s.tracker.Track(ctx, analytics.Server(analytics.EventPlacementCompleted, userID, map[string]any{
		"assessment_id": id, "cefr": overall.Level.String(), "score": overall.Score, "confidence": overall.Confidence,
	}))
	return nil
}

func upsertWeakness(ctx context.Context, tx pgx.Tx, userID, assessmentID uuid.UUID, skill, category string, severity float64) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO weaknesses (user_id, skill_id, category, severity_score, evidence_count, status, source_assessment_id)
		VALUES ($1, (SELECT id FROM skills WHERE code = $2), $3, $4, 1, 'active', $5)
		ON CONFLICT (user_id, category) DO UPDATE SET severity_score = EXCLUDED.severity_score,
		    evidence_count = weaknesses.evidence_count + 1, status = 'active', last_detected_at = now(),
		    source_assessment_id = EXCLUDED.source_assessment_id`,
		userID, skill, category, max(0, min(100, severity)), assessmentID)
	return err
}

func (s *Service) Result(ctx context.Context, userID, id uuid.UUID) (Result, error) {
	a, err := loadAssessment(ctx, s.pool, userID, id, false)
	if err != nil {
		return Result{}, err
	}
	out := Result{AssessmentID: id, Kind: a.Kind, Source: a.Source, StartLevel: a.StartLevel, Skills: []SkillResult{}}
	var overallCode string
	err = s.pool.QueryRow(ctx, `
		SELECT overall_cefr, overall_score::float8, confidence::float8, strengths, focus_areas, summary, scoring_version, created_at
		FROM assessment_results WHERE assessment_id = $1`, id).Scan(&overallCode, &out.Overall.Score, &out.Overall.Confidence,
		&out.Strengths, &out.FocusAreas, &out.Summary, &out.ScoringVersion, &out.CompletedAt)
	if database.IsNotFound(err) {
		return Result{}, apperr.NotFound("Assessment result").WithDetails(map[string]any{"status": a.Status})
	}
	if err != nil {
		return Result{}, err
	}
	if out.Overall.CEFR, err = cefr.Parse(overallCode); err != nil {
		return Result{}, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT skill, score::float8, cefr, confidence::float8, subscores FROM assessment_skill_results WHERE assessment_id = $1`, id)
	if err != nil {
		return Result{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var r SkillResult
		var code string
		if err := rows.Scan(&r.Skill, &r.Score, &code, &r.Confidence, &r.Subscores); err != nil {
			return Result{}, err
		}
		if r.CEFR, err = cefr.Parse(code); err != nil {
			return Result{}, err
		}
		out.Skills = append(out.Skills, r)
	}
	slices.SortFunc(out.Skills, func(x, y SkillResult) int { return slices.Index(Skills, x.Skill) - slices.Index(Skills, y.Skill) })
	return out, rows.Err()
}

func (s *Service) History(ctx context.Context, userID uuid.UUID) ([]HistoryItem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT a.id, a.kind, a.status, a.source, l.code, r.overall_cefr, r.overall_score::float8, a.started_at, a.completed_at
		FROM assessments a JOIN levels l ON l.id = a.start_level_id
		LEFT JOIN assessment_results r ON r.assessment_id = a.id
		WHERE a.user_id = $1 ORDER BY a.started_at DESC LIMIT 50`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HistoryItem{}
	for rows.Next() {
		var h HistoryItem
		var start string
		var overall *string
		if err := rows.Scan(&h.ID, &h.Kind, &h.Status, &h.Source, &start, &overall, &h.OverallScore, &h.StartedAt, &h.CompletedAt); err != nil {
			return nil, err
		}
		h.StartLevel, _ = cefr.Parse(start)
		if overall != nil {
			l, err := cefr.Parse(*overall)
			if err == nil {
				h.OverallCEFR = &l
			}
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// Audio opens a listening clip for a learner who has started the section containing it.
func (s *Service) Audio(ctx context.Context, userID, id, stimulusID uuid.UUID) (io.ReadCloser, storage.ObjectInfo, error) {
	var key, mime string
	err := s.pool.QueryRow(ctx, `
		SELECT af.storage_key, af.mime_type
		FROM assessments a
		JOIN assessment_sections sec ON sec.assessment_id = a.id AND sec.status NOT IN ('locked', 'available')
		JOIN assessment_section_items si ON si.section_id = sec.id
		JOIN assessment_items i ON i.id = si.item_id AND i.stimulus_id = $3
		JOIN content_items ci ON ci.id = i.stimulus_id
		JOIN audio_files af ON af.id = (ci.body->>'audio_file_id')::uuid
		WHERE a.id = $1 AND a.user_id = $2
		LIMIT 1`, id, userID, stimulusID).Scan(&key, &mime)
	if database.IsNotFound(err) {
		return nil, storage.ObjectInfo{}, apperr.NotFound("Audio")
	}
	if err != nil {
		return nil, storage.ObjectInfo{}, err
	}
	body, info, err := s.store.Get(ctx, key)
	if errors.Is(err, storage.ErrNotFound) {
		return nil, info, apperr.NotFound("Audio")
	}
	if err != nil {
		return nil, info, err
	}
	// The canonical type recorded at upload wins over whatever the storage backend guesses.
	info.ContentType = mime
	return body, info, nil
}
