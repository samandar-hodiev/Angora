package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/auth"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
)

// seedDemo creates a local demo learner whose dashboard, progress, mistakes, vocabulary,
// history and the admin AI-cost screens have realistic-looking data to design against.
// It is development data only and is never loaded by migrations.
func seedDemo(ctx context.Context, pool *pgxpool.Pool, email, password string) error {
	repo := users.NewPostgresRepository(pool)
	if _, err := repo.GetCredentialsByEmail(ctx, email); err == nil {
		fmt.Printf("demo account %s already exists (nothing changed)\n", email)
		return nil
	} else if !errors.Is(err, users.ErrNotFound) {
		return err
	}

	hash, err := auth.DefaultArgon2id().Hash(password)
	if err != nil {
		return err
	}
	user, err := repo.CreateAccount(ctx, users.NewAccount{
		Email: email, PasswordHash: hash, DisplayName: "Aziza", Timezone: "Asia/Tashkent",
	})
	if err != nil {
		return fmt.Errorf("create demo account: %w", err)
	}

	err = database.WithTx(ctx, pool, func(tx pgx.Tx) error {
		return seedDemoData(ctx, tx, user.ID)
	})
	if err != nil {
		return err
	}
	fmt.Printf("demo account ready\n  email:    %s\n  password: %s\n", email, password)
	return nil
}

func seedDemoData(ctx context.Context, tx pgx.Tx, userID uuid.UUID) error {
	exec := func(sql string, args ...any) error {
		_, err := tx.Exec(ctx, sql, args...)
		return err
	}

	steps := []struct {
		name string
		run  func() error
	}{
		{"profile", func() error {
			return exec(`
				UPDATE profiles SET current_level_id = (SELECT id FROM levels WHERE code = 'B1'),
				       target_level_id = (SELECT id FROM levels WHERE code = 'B2'),
				       learning_goals = ARRAY['improve_english', 'speak_confidently'],
				       daily_goal_minutes = 45,
				       preferences = '{"focus_skills": ["speaking", "grammar", "vocabulary", "pronunciation"]}',
				       onboarding_completed_at = now() - interval '20 days'
				WHERE user_id = $1`, userID)
		}},
		{"streak", func() error {
			return exec(`INSERT INTO streaks (user_id, current_days, longest_days, last_activity_date)
				VALUES ($1, 12, 21, current_date)`, userID)
		}},
		{"skill progress", func() error {
			return exec(`
				INSERT INTO skill_progress (user_id, skill_id, estimated_level_id, score, xp, sessions_count, last_practiced_at)
				SELECT $1, s.id, (SELECT id FROM levels WHERE code = v.level), v.score, v.xp, v.sessions, now() - (v.days || ' days')::interval
				FROM (VALUES ('speaking', 72, 'B1', 1840, 23, 0), ('writing', 64, 'B1', 1210, 14, 1),
				             ('reading', 81, 'B2', 2030, 19, 2), ('listening', 67, 'B1', 1390, 16, 1),
				             ('grammar', 58, 'B1', 960, 12, 0), ('vocabulary', 70, 'B1', 1500, 30, 0),
				             ('pronunciation', 61, 'B1', 700, 8, 3)) AS v (code, score, level, xp, sessions, days)
				JOIN skills s ON s.code = v.code`, userID)
		}},
		{"mistakes", func() error {
			return exec(`
				INSERT INTO mistakes (user_id, skill_id, category, source_type, original_text, corrected_text, explanation, severity, created_at)
				SELECT $1, (SELECT id FROM skills WHERE code = v.skill), v.category, v.source, v.original, v.corrected, v.explanation, v.severity,
				       now() - (v.hours || ' hours')::interval
				FROM (VALUES
				  ('speaking', 'grammar.tense.present_perfect', 'speaking_session', 'I have went there twice.', 'I have gone there twice.', 'Use the past participle (gone) after have.', 'high', 3),
				  ('writing',  'grammar.tense.present_perfect', 'writing_submission', 'She has went home.', 'She has gone home.', 'Use the past participle (gone) after has.', 'high', 30),
				  ('speaking', 'grammar.tense.present_perfect', 'speaking_session', 'We have went to Samarkand.', 'We have gone to Samarkand.', 'Use the past participle (gone) after have.', 'high', 50),
				  ('speaking', 'grammar.tense.past_simple', 'speaking_session', 'Yesterday I go to the market.', 'Yesterday I went to the market.', 'Finished past actions take the past simple.', 'medium', 8),
				  ('writing',  'grammar.tense.past_simple', 'writing_submission', 'Last year we travel to Istanbul.', 'Last year we travelled to Istanbul.', 'Finished past actions take the past simple.', 'medium', 60),
				  ('writing',  'grammar.articles', 'writing_submission', 'He is engineer.', 'He is an engineer.', 'Jobs take a/an in the singular.', 'medium', 20),
				  ('speaking', 'grammar.articles', 'speaking_session', 'I live in the Tashkent.', 'I live in Tashkent.', 'City names do not take the.', 'low', 26),
				  ('speaking', 'vocabulary.collocation', 'speaking_session', 'I did a mistake.', 'I made a mistake.', 'The collocation is make a mistake.', 'medium', 5),
				  ('writing',  'vocabulary.word_choice', 'writing_submission', 'The film was very interesting and boring.', 'The film was interesting at first but became boring.', 'Contrasting ideas need a linking word such as but.', 'low', 72),
				  ('speaking', 'vocabulary.collocation', 'speaking_session', 'I did a mistake again.', 'I made a mistake.', 'The collocation is make a mistake.', 'medium', 90),
				  ('pronunciation', 'pronunciation.th_sound', 'speaking_session', 'I sink so.', 'I think so.', 'Place the tongue between the teeth for /θ/.', 'medium', 12),
				  ('pronunciation', 'pronunciation.word_stress', 'speaking_session', 'deVElop', 'develop /dɪˈveləp/', 'Stress the second syllable: de-VEL-op.', 'low', 40)
				) AS v (skill, category, source, original, corrected, explanation, severity, hours)`, userID)
		}},
		{"weaknesses", func() error {
			return exec(`
				INSERT INTO weaknesses (user_id, skill_id, category, severity_score, evidence_count, status, first_detected_at, last_detected_at)
				SELECT $1, (SELECT id FROM skills WHERE code = v.skill), v.category, v.score, v.evidence, v.status, now() - interval '14 days', now() - interval '3 hours'
				FROM (VALUES ('grammar', 'grammar.tense.present_perfect', 78, 7, 'active'),
				             ('grammar', 'grammar.articles', 61, 5, 'active'),
				             ('vocabulary', 'vocabulary.collocation', 44, 3, 'improving')) AS v (skill, category, score, evidence, status)`, userID)
		}},
		{"history", func() error {
			if err := exec(`
				INSERT INTO speaking_sessions (user_id, content_item_id, status, overall_score, duration_ms, client_platform, started_at, submitted_at, completed_at, created_at)
				SELECT $1, ci.id, 'completed', v.score, 115000, 'web', now() - (v.hours || ' hours')::interval, now() - (v.hours || ' hours')::interval,
				       now() - (v.hours || ' hours')::interval, now() - (v.hours || ' hours')::interval
				FROM (VALUES ('Describe your hometown', 6.5, 3), ('Talk about a memorable trip', 6.0, 50)) AS v (title, score, hours)
				JOIN content_items ci ON ci.title = v.title AND ci.type = 'speaking_topic'`, userID); err != nil {
				return err
			}
			if err := exec(`
				INSERT INTO writing_submissions (user_id, content_item_id, status, text, word_count, overall_score, client_platform, submitted_at, completed_at, created_at)
				SELECT $1, ci.id, 'completed', '', 94, 6.0, 'web', now() - interval '30 hours', now() - interval '30 hours', now() - interval '30 hours'
				FROM content_items ci WHERE ci.title = 'Email to a friend about your weekend'`, userID); err != nil {
				return err
			}
			return exec(`
				INSERT INTO reading_attempts (user_id, content_item_id, status, correct_count, total_count, score, time_spent_ms, completed_at, created_at)
				SELECT $1, ci.id, 'completed', 3, 4, 75, 340000, now() - interval '2 days', now() - interval '2 days'
				FROM content_items ci WHERE ci.title = 'The four-day work week'`, userID)
		}},
		{"recommendations", func() error {
			return exec(`
				INSERT INTO recommendations (user_id, type, content_item_id, reason, priority, source)
				SELECT $1, 'content_item', ci.id, v.reason, v.priority, 'rule'
				FROM (VALUES ('Talk about a memorable trip', 'Practise the past tenses you often mix up.', 90),
				             ('Email to a friend about your weekend', 'Short writing keeps your grammar accuracy improving.', 70),
				             ('Booking a table', 'Listening is your least practised skill this week.', 60)) AS v (title, reason, priority)
				JOIN content_items ci ON ci.title = v.title`, userID)
		}},
		{"learning plan", func() error {
			return exec(`
				INSERT INTO learning_plans (user_id, goal, target_level_id, starts_on, ends_on, plan, generated_by)
				VALUES ($1, 'Reach B2 and speak confidently', (SELECT id FROM levels WHERE code = 'B2'), current_date - 20, current_date + 70,
				        '{"daily_minutes": 45, "focus": ["grammar", "vocabulary", "speaking", "pronunciation"], "weekly_sessions": {"speaking": 4, "writing": 2, "reading": 2, "listening": 2}}',
				        'system')`, userID)
		}},
		{"vocabulary", func() error {
			return exec(`
				INSERT INTO user_vocabulary (user_id, vocabulary_id, status, repetitions, interval_days, due_at, last_reviewed_at, source)
				SELECT $1, v.id, s.status, s.reps, s.reps * 2, now() + (s.due_hours || ' hours')::interval,
				       CASE WHEN s.reps > 0 THEN now() - interval '1 day' END, 'lesson'
				FROM (VALUES ('nevertheless', 'reviewing', 3, -2), ('meanwhile', 'mastered', 6, 72), ('reluctant', 'learning', 1, -1),
				             ('consequence', 'reviewing', 4, 20), ('approach', 'new', 0, 0), ('significant', 'learning', 2, 5),
				             ('accomplish', 'new', 0, 0), ('commute', 'mastered', 7, 120), ('sustainable', 'learning', 1, -3),
				             ('thorough', 'new', 0, 0)) AS s (term, status, reps, due_hours)
				JOIN vocabulary v ON v.term = s.term`, userID)
		}},
		{"grammar progress", func() error {
			return exec(`
				INSERT INTO user_grammar_progress (user_id, grammar_topic_id, mastery, attempts, correct, last_practiced_at)
				SELECT $1, g.id, v.mastery, v.attempts, v.correct, now() - interval '1 day'
				FROM (VALUES ('past-simple', 42, 24, 10), ('present-perfect', 61, 31, 19), ('articles', 31, 16, 5),
				             ('present-simple', 88, 40, 35), ('conditionals', 20, 5, 1)) AS v (slug, mastery, attempts, correct)
				JOIN grammar_topics g ON g.slug = v.slug`, userID)
		}},
		{"ai usage (admin cost screens)", func() error {
			return exec(`
				INSERT INTO ai_usage (usage_date, user_id, provider, model, task, request_count, failed_count, input_tokens, output_tokens, audio_seconds, estimated_cost_usd)
				SELECT current_date - d, $1, v.provider, v.model, v.task, v.requests + (d % 3), (d % 5 = 0)::int,
				       v.input_tokens, v.output_tokens, v.audio_seconds, round((v.cost * (1 + (d % 4) * 0.15))::numeric, 4)
				FROM generate_series(0, 13) AS d,
				     (VALUES ('openai', 'gpt-4o-mini-transcribe', 'transcription', 6, 0, 0, 690.0, 0.21),
				             ('openai', 'gpt-4.1-mini', 'speaking_evaluation', 6, 9200, 2600, 0.0, 0.36),
				             ('openai', 'gpt-4.1-mini', 'writing_evaluation', 3, 5400, 1900, 0.0, 0.19),
				             ('openai', 'gpt-4o-mini-tts', 'text_to_speech', 2, 800, 0, 0.0, 0.06)) AS v (provider, model, task, requests, input_tokens, output_tokens, audio_seconds, cost)`,
				userID)
		}},
	}

	for _, s := range steps {
		if err := s.run(); err != nil {
			return fmt.Errorf("demo %s: %w", s.name, err)
		}
	}
	return nil
}
