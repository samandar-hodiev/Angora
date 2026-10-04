DROP INDEX IF EXISTS vocabulary_status_level_idx;
ALTER TABLE vocabulary
    DROP COLUMN IF EXISTS published_at,
    DROP COLUMN IF EXISTS created_by,
    DROP COLUMN IF EXISTS ai_request_id,
    DROP COLUMN IF EXISTS source,
    DROP COLUMN IF EXISTS translations;
