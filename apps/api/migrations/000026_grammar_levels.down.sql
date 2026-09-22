DROP INDEX IF EXISTS grammar_questions_topic_level_idx;
ALTER TABLE grammar_questions DROP COLUMN IF EXISTS ai_request_id;

DROP INDEX IF EXISTS grammar_content_topic_idx;
DROP INDEX IF EXISTS grammar_content_one_published;

DELETE FROM grammar_content WHERE status = 'not_applicable';
ALTER TABLE grammar_content DROP CONSTRAINT grammar_content_status_check;
ALTER TABLE grammar_content ADD CONSTRAINT grammar_content_status_check
    CHECK (status IN ('draft', 'review', 'published', 'archived'));

ALTER TABLE grammar_content
    DROP COLUMN IF EXISTS level_code,
    DROP COLUMN IF EXISTS title,
    DROP COLUMN IF EXISTS summary,
    DROP COLUMN IF EXISTS ai_request_id,
    DROP COLUMN IF EXISTS created_by;

CREATE UNIQUE INDEX grammar_content_one_published ON grammar_content (grammar_topic_id, language)
    WHERE status = 'published';
CREATE INDEX grammar_content_topic_idx ON grammar_content (grammar_topic_id, language, version DESC);
