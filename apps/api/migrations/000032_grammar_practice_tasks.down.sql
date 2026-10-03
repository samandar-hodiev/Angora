DROP INDEX IF EXISTS speaking_sessions_grammar_topic_idx;
ALTER TABLE speaking_sessions DROP COLUMN IF EXISTS grammar_topic_id, DROP COLUMN IF EXISTS prompt;
DROP TABLE IF EXISTS grammar_practice_tasks;
