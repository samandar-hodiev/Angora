package personalization

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/levels"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
)

// Service stores generated plans. There is exactly one active plan per learner; older plans
// are archived, never deleted, so plan history stays available.
type Service struct {
	pool    *pgxpool.Pool
	tracker analytics.Tracker
}

func NewService(pool *pgxpool.Pool, tracker analytics.Tracker) *Service {
	return &Service{pool: pool, tracker: tracker}
}

// GenerateForUser builds a plan from the learner's current data and makes it active.
// sourceAssessmentID links the plan to the assessment whose results shaped it.
func (s *Service) GenerateForUser(ctx context.Context, userID uuid.UUID, sourceAssessmentID *uuid.UUID) (uuid.UUID, error) {
	in := Input{}
	var currentLevel *string
	if err := s.pool.QueryRow(ctx, `
		SELECT p.learning_goals, p.daily_goal_minutes, l.code
		FROM profiles p LEFT JOIN levels l ON l.id = p.current_level_id
		WHERE p.user_id = $1`, userID).Scan(&in.Goals, &in.DailyMinutes, &currentLevel); err != nil {
		return uuid.Nil, fmt.Errorf("load profile: %w", err)
	}

	summary, err := levels.Load(ctx, s.pool, userID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("load levels: %w", err)
	}
	switch {
	case summary.CurrentEstimated != nil:
		in.Level = summary.CurrentEstimated.CEFR
	case summary.SelfReported != nil:
		in.Level = summary.SelfReported.CEFR
	case currentLevel != nil:
		in.Level, _ = cefr.Parse(*currentLevel)
	}

	if sourceAssessmentID != nil {
		var focus []byte
		err := s.pool.QueryRow(ctx,
			`SELECT focus_areas FROM assessment_results WHERE assessment_id = $1 AND user_id = $2`,
			*sourceAssessmentID, userID).Scan(&focus)
		if err != nil && !database.IsNotFound(err) {
			return uuid.Nil, fmt.Errorf("load assessment focus: %w", err)
		}
		if len(focus) > 0 {
			var areas []struct{ Type, Code string }
			if err := json.Unmarshal(focus, &areas); err != nil {
				return uuid.Nil, fmt.Errorf("decode focus areas: %w", err)
			}
			for _, a := range areas {
				in.FocusAreas = append(in.FocusAreas, Area{Type: a.Type, Code: a.Code})
			}
		}
		rows, err := s.pool.Query(ctx, `
			SELECT m.category FROM mistakes m
			WHERE m.user_id = $1 AND (
			      (m.source_type = 'writing_submission' AND m.source_id IN (
			          SELECT w.id FROM writing_submissions w JOIN assessment_sections sec ON sec.id = w.assessment_section_id
			          WHERE sec.assessment_id = $2))
			   OR (m.source_type = 'speaking_session' AND m.source_id IN (
			          SELECT sp.id FROM speaking_sessions sp JOIN assessment_sections sec ON sec.id = sp.assessment_section_id
			          WHERE sec.assessment_id = $2)))
			GROUP BY m.category ORDER BY count(*) DESC, m.category LIMIT 5`, userID, *sourceAssessmentID)
		if err != nil {
			return uuid.Nil, fmt.Errorf("load mistakes: %w", err)
		}
		in.MistakeCategories, err = pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return uuid.Nil, fmt.Errorf("load mistakes: %w", err)
		}
	}

	plan := Generate(in)
	var planID uuid.UUID
	err = database.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE learning_plans SET status = 'archived' WHERE user_id = $1 AND status = 'active'`, userID); err != nil {
			return err
		}
		meta := map[string]any{"version": Version, "goals": in.Goals, "focus_areas": in.FocusAreas}
		if err := tx.QueryRow(ctx, `
			INSERT INTO learning_plans (user_id, status, goal, target_level_id, plan, generated_by, analysis_version,
			                            source_assessment_id, daily_minutes, level)
			VALUES ($1, 'active', $2, (SELECT id FROM levels WHERE code = $3), $4, 'system', $5, $6, $7, $8)
			RETURNING id`,
			userID, plan.Goal, plan.TargetLevel.BaseCode(), meta, Version, sourceAssessmentID, plan.DailyMinutes, plan.Level.String(),
		).Scan(&planID); err != nil {
			return fmt.Errorf("insert plan: %w", err)
		}
		for _, item := range plan.Items {
			if _, err := tx.Exec(ctx, `
				INSERT INTO learning_plan_items (learning_plan_id, position, skill, focus, activity_code, title, description,
				                                 minutes, level, content_item_id, reason_code)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, (
				    SELECT ci.id FROM content_items ci
				    JOIN skills s ON s.id = ci.skill_id
				    LEFT JOIN levels l ON l.id = ci.level_id
				    WHERE ci.status = 'published' AND ci.exam IS NULL AND s.code = $3
				    ORDER BY abs(COALESCE(l.rank, 3) - $10), ci.difficulty, ci.id
				    LIMIT 1), $11)`,
				planID, item.Position, item.Skill, item.Focus, item.ActivityCode, item.Title, item.Description,
				item.Minutes, item.Level.String(), item.Level.Base, item.ReasonCode); err != nil {
				return fmt.Errorf("insert plan item: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return uuid.Nil, err
	}

	source := "self_reported"
	if sourceAssessmentID != nil {
		source = "assessment"
	}
	s.tracker.Track(ctx, analytics.Server(analytics.EventPersonalizedPlanCreated, userID, map[string]any{
		"plan_id": planID, "items": len(plan.Items), "source": source, "level": plan.Level.String(), "version": Version,
	}))
	return planID, nil
}
