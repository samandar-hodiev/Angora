// Package onboarding owns the new-learner onboarding state machine.
//
// The server knows exactly where every learner stopped (onboarding_progress.step), so web,
// iOS and Android all resume at the same step. Answers are written straight to product
// data (profiles, user_levels, learning_plans); nothing lives only in a client.
//
//	NOT_STARTED/WELCOME → GOAL_SELECTION → DAILY_TIME → LEVEL_SELECTION
//	    ├─ "I know my level"  → PERSONALIZED_PLAN → COMPLETED
//	    └─ "Find my level"    → PLACEMENT_INTRO → PLACEMENT_START_LEVEL
//	         → PLACEMENT_READING → _LISTENING → _WRITING → _SPEAKING → PLACEMENT_PROCESSING
//	         → PLACEMENT_RESULTS → PERSONALIZED_PLAN → COMPLETED
//
// Placement steps are advanced by the assessment module (PlacementProgressed), because the
// assessment is the source of truth for which section the learner is in.
package onboarding

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/levels"
	"github.com/samandar-hodiev/engora/apps/api/internal/personalization"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

type Step string

const (
	StepNotStarted          Step = "NOT_STARTED"
	StepWelcome             Step = "WELCOME"
	StepGoalSelection       Step = "GOAL_SELECTION"
	StepDailyTime           Step = "DAILY_TIME"
	StepLevelSelection      Step = "LEVEL_SELECTION"
	StepPlacementIntro      Step = "PLACEMENT_INTRO"
	StepPlacementStartLevel Step = "PLACEMENT_START_LEVEL"
	StepPlacementReading    Step = "PLACEMENT_READING"
	StepPlacementListening  Step = "PLACEMENT_LISTENING"
	StepPlacementWriting    Step = "PLACEMENT_WRITING"
	StepPlacementSpeaking   Step = "PLACEMENT_SPEAKING"
	StepPlacementProcessing Step = "PLACEMENT_PROCESSING"
	StepPlacementResults    Step = "PLACEMENT_RESULTS"
	StepPersonalizedPlan    Step = "PERSONALIZED_PLAN"
	StepCompleted           Step = "COMPLETED"
)

var stepOrder = []Step{
	StepNotStarted, StepWelcome, StepGoalSelection, StepDailyTime, StepLevelSelection,
	StepPlacementIntro, StepPlacementStartLevel,
	StepPlacementReading, StepPlacementListening, StepPlacementWriting, StepPlacementSpeaking,
	StepPlacementProcessing, StepPlacementResults, StepPersonalizedPlan, StepCompleted,
}

func (s Step) rank() int { return slices.Index(stepOrder, s) }

func (s Step) Valid() bool { return s.rank() >= 0 }

// setupSteps can be revisited with Back until a level path is committed.
var setupSteps = []Step{StepGoalSelection, StepDailyTime, StepLevelSelection, StepPlacementIntro, StepPlacementStartLevel}

// placementTestSteps are the steps during which an assessment is open.
var placementTestSteps = []Step{StepPlacementReading, StepPlacementListening, StepPlacementWriting, StepPlacementSpeaking}

// PlacementStep maps an assessment skill to its onboarding step.
func PlacementStep(skill string) Step {
	switch skill {
	case "reading":
		return StepPlacementReading
	case "listening":
		return StepPlacementListening
	case "writing":
		return StepPlacementWriting
	case "speaking":
		return StepPlacementSpeaking
	}
	return ""
}

const (
	PathSelfReported = "self_reported"
	PathPlacement    = "placement"
)

var (
	DailyMinuteOptions = []int{10, 20, 30, 45, 60}
	SelectableLevels   = []string{"A1", "A2", "B1", "B2", "C1"}
)

const maxGoals = 6

type Options struct {
	Goals        []string `json:"goals"`
	MaxGoals     int      `json:"max_goals"`
	DailyMinutes []int    `json:"daily_minutes"`
	Levels       []string `json:"levels"`
}

type State struct {
	Step Step `json:"step"`
	// ProfileCompleted is false until the account profile step is done; onboarding cannot
	// start before it.
	ProfileCompleted    bool        `json:"profile_completed"`
	LevelPath           *string     `json:"level_path"`
	AssessmentID        *uuid.UUID  `json:"assessment_id"`
	Goals               []string    `json:"goals"`
	DailyGoalMinutes    int         `json:"daily_goal_minutes"`
	SelfReportedLevel   *cefr.Level `json:"self_reported_level"`
	PlacementStartLevel *cefr.Level `json:"placement_start_level"`
	StartedAt           *time.Time  `json:"started_at"`
	CompletedAt         *time.Time  `json:"completed_at"`
	UpdatedAt           time.Time   `json:"updated_at"`
	Options             Options     `json:"options"`
}

// Placement is implemented by the assessment module (declared here, where it is consumed).
type Placement interface {
	StartPlacement(ctx context.Context, userID uuid.UUID, start cefr.Level, source, platform string) (uuid.UUID, error)
	AbandonPlacement(ctx context.Context, userID, assessmentID uuid.UUID) error
}

type PlanGenerator interface {
	GenerateForUser(ctx context.Context, userID uuid.UUID, sourceAssessmentID *uuid.UUID) (uuid.UUID, error)
}

type Service struct {
	pool      *pgxpool.Pool
	plans     PlanGenerator
	placement Placement
	tracker   analytics.Tracker
}

func NewService(pool *pgxpool.Pool, plans PlanGenerator, tracker analytics.Tracker) *Service {
	return &Service{pool: pool, plans: plans, tracker: tracker}
}

// SetPlacement wires the assessment module after both services exist (they depend on each
// other through small interfaces).
func (s *Service) SetPlacement(p Placement) { s.placement = p }

type progressRow struct {
	step         Step
	levelPath    *string
	assessmentID *uuid.UUID
}

// ensure creates the progress row on first use. Learners who completed the previous
// onboarding (profiles.onboarding_completed_at) start as COMPLETED.
func ensure(ctx context.Context, q levels.Querier, userID uuid.UUID) error {
	tag, err := q.Exec(ctx, `
		INSERT INTO onboarding_progress (user_id, step, completed_at)
		SELECT p.user_id,
		       CASE WHEN p.onboarding_completed_at IS NOT NULL THEN 'COMPLETED' ELSE 'NOT_STARTED' END,
		       p.onboarding_completed_at
		FROM profiles p WHERE p.user_id = $1
		ON CONFLICT (user_id) DO NOTHING`, userID)
	if err != nil {
		return fmt.Errorf("ensure onboarding progress: %w", err)
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM onboarding_progress WHERE user_id = $1)`, userID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return apperr.NotFound("Profile")
		}
	}
	return nil
}

// mutate runs fn with the learner's progress row locked, then returns the fresh state.
func (s *Service) mutate(ctx context.Context, userID uuid.UUID, fn func(tx pgx.Tx, row progressRow) error) (State, error) {
	err := database.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := ensure(ctx, tx, userID); err != nil {
			return err
		}
		var row progressRow
		if err := tx.QueryRow(ctx,
			`SELECT step, level_path, assessment_id FROM onboarding_progress WHERE user_id = $1 FOR UPDATE`, userID,
		).Scan(&row.step, &row.levelPath, &row.assessmentID); err != nil {
			return err
		}
		return fn(tx, row)
	})
	if err != nil {
		return State{}, err
	}
	return s.Get(ctx, userID)
}

// requireProfile keeps account setup (who you are) before onboarding (what you want).
func requireProfile(ctx context.Context, tx pgx.Tx, userID uuid.UUID) error {
	var done bool
	if err := tx.QueryRow(ctx, `SELECT profile_completed_at IS NOT NULL FROM profiles WHERE user_id = $1`, userID).Scan(&done); err != nil {
		return err
	}
	if !done {
		return apperr.Conflict("Complete your profile first").WithDetails(map[string]any{"reason": "profile_incomplete"})
	}
	return nil
}

func setStep(ctx context.Context, tx pgx.Tx, userID uuid.UUID, step Step) error {
	_, err := tx.Exec(ctx, `UPDATE onboarding_progress SET step = $2 WHERE user_id = $1`, userID, step)
	return err
}

func notAllowed(step Step) error {
	return apperr.Conflict(fmt.Sprintf("This action is not available at onboarding step %s", step)).
		WithDetails(map[string]any{"step": step})
}

func (s *Service) Get(ctx context.Context, userID uuid.UUID) (State, error) {
	if err := ensure(ctx, s.pool, userID); err != nil {
		return State{}, err
	}
	st := State{Options: Options{Goals: personalization.Goals, MaxGoals: maxGoals, DailyMinutes: DailyMinuteOptions, Levels: SelectableLevels}}
	err := s.pool.QueryRow(ctx, `
		SELECT o.step, o.level_path, o.assessment_id, o.started_at, o.completed_at, o.updated_at,
		       p.learning_goals, p.daily_goal_minutes, p.profile_completed_at IS NOT NULL
		FROM onboarding_progress o JOIN profiles p ON p.user_id = o.user_id
		WHERE o.user_id = $1`, userID,
	).Scan(&st.Step, &st.LevelPath, &st.AssessmentID, &st.StartedAt, &st.CompletedAt, &st.UpdatedAt,
		&st.Goals, &st.DailyGoalMinutes, &st.ProfileCompleted)
	if err != nil {
		return State{}, fmt.Errorf("load onboarding: %w", err)
	}
	summary, err := levels.Load(ctx, s.pool, userID)
	if err != nil {
		return State{}, err
	}
	if summary.SelfReported != nil {
		st.SelfReportedLevel = &summary.SelfReported.CEFR
	}
	if summary.PlacementStart != nil {
		st.PlacementStartLevel = &summary.PlacementStart.CEFR
	}
	return st, nil
}

// Start leaves the welcome screen.
func (s *Service) Start(ctx context.Context, userID uuid.UUID) (State, error) {
	started := false
	st, err := s.mutate(ctx, userID, func(tx pgx.Tx, row progressRow) error {
		if row.step != StepNotStarted && row.step != StepWelcome {
			return nil // idempotent: a second tap or another device
		}
		if err := requireProfile(ctx, tx, userID); err != nil {
			return err
		}
		started = true
		_, err := tx.Exec(ctx, `UPDATE onboarding_progress SET step = $2, started_at = COALESCE(started_at, now()) WHERE user_id = $1`,
			userID, StepGoalSelection)
		return err
	})
	if err == nil && started {
		s.tracker.Track(ctx, analytics.Server(analytics.EventOnboardingStarted, userID, nil))
	}
	return st, err
}

func (s *Service) SetGoals(ctx context.Context, userID uuid.UUID, goals []string) (State, error) {
	if len(goals) == 0 || len(goals) > maxGoals {
		return State{}, apperr.Validation(map[string]any{"fields": map[string]any{"goals": "choose at least one goal"}})
	}
	seen := map[string]bool{}
	for _, g := range goals {
		if !slices.Contains(personalization.Goals, g) || seen[g] {
			return State{}, apperr.Validation(map[string]any{"fields": map[string]any{"goals": fmt.Sprintf("%q is not a valid goal", g)}})
		}
		seen[g] = true
	}
	st, err := s.mutate(ctx, userID, func(tx pgx.Tx, row progressRow) error {
		if row.step != StepNotStarted && row.step != StepWelcome && !slices.Contains(setupSteps, row.step) {
			return notAllowed(row.step)
		}
		if err := requireProfile(ctx, tx, userID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE profiles SET learning_goals = $2 WHERE user_id = $1`, userID, goals); err != nil {
			return err
		}
		if row.step.rank() <= StepGoalSelection.rank() {
			_, err := tx.Exec(ctx, `UPDATE onboarding_progress SET step = $2, started_at = COALESCE(started_at, now()) WHERE user_id = $1`,
				userID, StepDailyTime)
			return err
		}
		return nil
	})
	if err == nil {
		s.tracker.Track(ctx, analytics.Server(analytics.EventGoalSelected, userID, map[string]any{"goals": goals}))
	}
	return st, err
}

func (s *Service) SetDailyTime(ctx context.Context, userID uuid.UUID, minutes int) (State, error) {
	if !slices.Contains(DailyMinuteOptions, minutes) {
		return State{}, apperr.Validation(map[string]any{"fields": map[string]any{"minutes": "choose one of the offered durations"}})
	}
	st, err := s.mutate(ctx, userID, func(tx pgx.Tx, row progressRow) error {
		if !slices.Contains(setupSteps, row.step) || row.step == StepGoalSelection {
			return notAllowed(row.step)
		}
		if _, err := tx.Exec(ctx, `UPDATE profiles SET daily_goal_minutes = $2 WHERE user_id = $1`, userID, minutes); err != nil {
			return err
		}
		if row.step == StepDailyTime {
			return setStep(ctx, tx, userID, StepLevelSelection)
		}
		return nil
	})
	if err == nil {
		s.tracker.Track(ctx, analytics.Server(analytics.EventDailyTimeSelected, userID, map[string]any{"minutes": minutes}))
	}
	return st, err
}

func parseSelectable(code string) (cefr.Level, error) {
	level, err := cefr.Parse(code)
	if err != nil || level.Plus || !slices.Contains(SelectableLevels, level.BaseCode()) {
		return cefr.Level{}, apperr.Validation(map[string]any{"fields": map[string]any{"level": "choose one of the offered levels"}})
	}
	return level, nil
}

// ChooseLevel stores a self-reported level ("I know my level") and builds the plan.
// The self-reported level becomes the starting estimate, but it is never recorded as an
// assessed level.
func (s *Service) ChooseLevel(ctx context.Context, userID uuid.UUID, code string) (State, error) {
	level, err := parseSelectable(code)
	if err != nil {
		return State{}, err
	}
	_, err = s.mutate(ctx, userID, func(tx pgx.Tx, row progressRow) error {
		allowed := row.step == StepLevelSelection || row.step == StepPlacementIntro || row.step == StepPlacementStartLevel ||
			(row.step == StepPersonalizedPlan && row.levelPath != nil && *row.levelPath == PathSelfReported)
		if !allowed {
			return notAllowed(row.step)
		}
		if err := levels.Record(ctx, tx, userID, levels.Entry{Kind: levels.KindSelfReported, CEFR: level, SourceType: levels.SourceOnboarding}); err != nil {
			return err
		}
		var hasAssessed bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM user_levels WHERE user_id = $1 AND kind = 'assessed')`, userID).Scan(&hasAssessed); err != nil {
			return err
		}
		if !hasAssessed {
			if err := levels.Record(ctx, tx, userID, levels.Entry{Kind: levels.KindEstimated, CEFR: level, SourceType: levels.SourceOnboarding}); err != nil {
				return err
			}
		}
		_, err := tx.Exec(ctx, `UPDATE onboarding_progress SET step = $2, level_path = $3, assessment_id = NULL WHERE user_id = $1`,
			userID, StepPersonalizedPlan, PathSelfReported)
		return err
	})
	if err != nil {
		return State{}, err
	}
	s.tracker.Track(ctx, analytics.Server(analytics.EventLevelSelected, userID, map[string]any{"level": level.String(), "path": PathSelfReported}))
	if _, err := s.plans.GenerateForUser(ctx, userID, nil); err != nil {
		return State{}, fmt.Errorf("generate plan: %w", err)
	}
	return s.Get(ctx, userID)
}

// ChoosePlacement is "Not sure about your level? Find my level".
func (s *Service) ChoosePlacement(ctx context.Context, userID uuid.UUID) (State, error) {
	return s.mutate(ctx, userID, func(tx pgx.Tx, row progressRow) error {
		switch row.step {
		case StepPlacementIntro, StepPlacementStartLevel:
			return nil
		case StepLevelSelection:
			_, err := tx.Exec(ctx, `UPDATE onboarding_progress SET step = $2, level_path = $3 WHERE user_id = $1`,
				userID, StepPlacementIntro, PathPlacement)
			return err
		default:
			return notAllowed(row.step)
		}
	})
}

// Navigate moves between setup steps: back to an earlier step, or from the placement
// introduction to the starting-level question.
func (s *Service) Navigate(ctx context.Context, userID uuid.UUID, target Step) (State, error) {
	if !slices.Contains(setupSteps, target) {
		return State{}, apperr.Validation(map[string]any{"fields": map[string]any{"step": "is not a step you can navigate to"}})
	}
	return s.mutate(ctx, userID, func(tx pgx.Tx, row progressRow) error {
		selfPlan := row.step == StepPersonalizedPlan && row.levelPath != nil && *row.levelPath == PathSelfReported
		forward := row.step == StepPlacementIntro && target == StepPlacementStartLevel
		backward := (slices.Contains(setupSteps, row.step) || selfPlan) && target.rank() <= row.step.rank()
		if !forward && !backward {
			return notAllowed(row.step)
		}
		levelPath := row.levelPath
		if target.rank() <= StepLevelSelection.rank() {
			levelPath = nil
		}
		_, err := tx.Exec(ctx, `UPDATE onboarding_progress SET step = $2, level_path = $3 WHERE user_id = $1`, userID, target, levelPath)
		return err
	})
}

// StartPlacement records the approximate starting level and opens the placement test.
func (s *Service) StartPlacement(ctx context.Context, userID uuid.UUID, code, platform string) (State, error) {
	level, err := parseSelectable(code)
	if err != nil {
		return State{}, err
	}
	current, err := s.Get(ctx, userID)
	if err != nil {
		return State{}, err
	}
	if slices.Contains(placementTestSteps, current.Step) && current.AssessmentID != nil {
		return current, nil // already started (double submit or another device)
	}
	if current.Step != StepPlacementIntro && current.Step != StepPlacementStartLevel {
		return State{}, notAllowed(current.Step)
	}
	if s.placement == nil {
		return State{}, errors.New("onboarding: placement is not wired")
	}
	assessmentID, err := s.placement.StartPlacement(ctx, userID, level, "onboarding", platform)
	if err != nil {
		return State{}, err
	}
	return s.mutate(ctx, userID, func(tx pgx.Tx, row progressRow) error {
		_, err := tx.Exec(ctx, `UPDATE onboarding_progress SET step = $2, level_path = $3, assessment_id = $4 WHERE user_id = $1`,
			userID, StepPlacementReading, PathPlacement, assessmentID)
		return err
	})
}

// AbandonPlacement leaves the placement test and returns to level selection.
func (s *Service) AbandonPlacement(ctx context.Context, userID uuid.UUID) (State, error) {
	current, err := s.Get(ctx, userID)
	if err != nil {
		return State{}, err
	}
	if !slices.Contains(placementTestSteps, current.Step) || current.AssessmentID == nil {
		return State{}, notAllowed(current.Step)
	}
	if err := s.placement.AbandonPlacement(ctx, userID, *current.AssessmentID); err != nil {
		return State{}, err
	}
	return s.mutate(ctx, userID, func(tx pgx.Tx, row progressRow) error {
		_, err := tx.Exec(ctx, `UPDATE onboarding_progress SET step = $2, level_path = NULL, assessment_id = NULL WHERE user_id = $1`,
			userID, StepLevelSelection)
		return err
	})
}

// PlacementProgressed is called by the assessment module when the onboarding placement test
// moves forward. Other assessments (e.g. retaken from the profile) do not affect onboarding.
func (s *Service) PlacementProgressed(ctx context.Context, userID, assessmentID uuid.UUID, step Step) error {
	_, err := s.mutate(ctx, userID, func(tx pgx.Tx, row progressRow) error {
		if row.assessmentID == nil || *row.assessmentID != assessmentID || step.rank() <= row.step.rank() || row.step == StepCompleted {
			return nil
		}
		return setStep(ctx, tx, userID, step)
	})
	return err
}

// ResultsViewed moves from the placement results to the personalised plan.
func (s *Service) ResultsViewed(ctx context.Context, userID uuid.UUID) (State, error) {
	return s.mutate(ctx, userID, func(tx pgx.Tx, row progressRow) error {
		switch row.step {
		case StepPersonalizedPlan:
			return nil
		case StepPlacementResults:
			return setStep(ctx, tx, userID, StepPersonalizedPlan)
		default:
			return notAllowed(row.step)
		}
	})
}

// RegeneratePlan rebuilds the plan at the plan step (e.g. if generation failed earlier).
func (s *Service) RegeneratePlan(ctx context.Context, userID uuid.UUID) (State, error) {
	current, err := s.Get(ctx, userID)
	if err != nil {
		return State{}, err
	}
	if current.Step != StepPersonalizedPlan {
		return State{}, notAllowed(current.Step)
	}
	var source *uuid.UUID
	if current.LevelPath != nil && *current.LevelPath == PathPlacement {
		source = current.AssessmentID
	}
	if _, err := s.plans.GenerateForUser(ctx, userID, source); err != nil {
		return State{}, err
	}
	return current, nil
}

func (s *Service) Complete(ctx context.Context, userID uuid.UUID) (State, error) {
	completed := false
	var path *string
	st, err := s.mutate(ctx, userID, func(tx pgx.Tx, row progressRow) error {
		if row.step == StepCompleted {
			return nil
		}
		if row.step != StepPersonalizedPlan {
			return notAllowed(row.step)
		}
		var hasPlan bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM learning_plans WHERE user_id = $1 AND status = 'active')`, userID).Scan(&hasPlan); err != nil {
			return err
		}
		if !hasPlan {
			return apperr.Conflict("Your plan is not ready yet")
		}
		if _, err := tx.Exec(ctx, `UPDATE onboarding_progress SET step = $2, completed_at = now() WHERE user_id = $1`, userID, StepCompleted); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE profiles SET onboarding_completed_at = COALESCE(onboarding_completed_at, now()) WHERE user_id = $1`, userID); err != nil {
			return err
		}
		completed, path = true, row.levelPath
		return nil
	})
	if err == nil && completed {
		props := map[string]any{}
		if path != nil {
			props["level_path"] = *path
		}
		s.tracker.Track(ctx, analytics.Server(analytics.EventOnboardingCompleted, userID, props))
	}
	return st, err
}
