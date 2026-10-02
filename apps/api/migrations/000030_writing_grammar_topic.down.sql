DROP INDEX IF EXISTS writing_submissions_grammar_topic_idx;
ALTER TABLE writing_submissions
    DROP COLUMN IF EXISTS grammar_topic_id,
    DROP COLUMN IF EXISTS prompt;
