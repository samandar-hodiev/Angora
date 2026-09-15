DROP TABLE IF EXISTS analytics_events;
ALTER TABLE weaknesses DROP COLUMN IF EXISTS source_assessment_id;
DROP TABLE IF EXISTS learning_plan_items;
ALTER TABLE learning_plans
    DROP COLUMN IF EXISTS level,
    DROP COLUMN IF EXISTS daily_minutes,
    DROP COLUMN IF EXISTS source_assessment_id;
DROP TABLE IF EXISTS assessment_results;
DROP TABLE IF EXISTS assessment_skill_results;
DROP INDEX IF EXISTS speaking_sessions_assessment_attempt_key;
ALTER TABLE speaking_sessions
    DROP COLUMN IF EXISTS attempt_number,
    DROP COLUMN IF EXISTS assessment_item_id,
    DROP COLUMN IF EXISTS assessment_section_id;
DROP INDEX IF EXISTS writing_submissions_assessment_item_key;
ALTER TABLE writing_submissions
    DROP COLUMN IF EXISTS time_spent_ms,
    DROP COLUMN IF EXISTS assessment_item_id,
    DROP COLUMN IF EXISTS assessment_section_id;
DROP TABLE IF EXISTS assessment_answers;
DROP TABLE IF EXISTS assessment_section_items;
DROP TABLE IF EXISTS assessment_sections;
ALTER TABLE onboarding_progress DROP CONSTRAINT IF EXISTS onboarding_progress_assessment_fk;
DROP TABLE IF EXISTS assessments;
DROP TABLE IF EXISTS assessment_items;
DELETE FROM audio_files WHERE user_id IS NULL;
ALTER TABLE audio_files ALTER COLUMN user_id SET NOT NULL;
DROP TABLE IF EXISTS assessment_configs;
DROP TABLE IF EXISTS user_levels;
DROP TABLE IF EXISTS onboarding_progress;
DROP DOMAIN IF EXISTS cefr_code;
