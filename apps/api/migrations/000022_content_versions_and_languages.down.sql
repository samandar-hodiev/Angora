DROP INDEX IF EXISTS grammar_content_topic_idx;
DROP INDEX IF EXISTS grammar_content_one_published;
ALTER TABLE grammar_content DROP COLUMN IF EXISTS language;
CREATE UNIQUE INDEX grammar_content_one_published ON grammar_content (grammar_topic_id)
    WHERE status = 'published';
CREATE INDEX grammar_content_topic_idx ON grammar_content (grammar_topic_id, version DESC);

ALTER TABLE content_items DROP COLUMN IF EXISTS version;
DROP TABLE IF EXISTS content_item_versions;
