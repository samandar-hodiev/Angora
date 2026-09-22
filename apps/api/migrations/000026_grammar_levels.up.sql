-- Grammar content, per CEFR level.
--
-- The curriculum map and the content taught from it are two different things, and until now
-- the schema only half said so. grammar_topics has always been the map: what English
-- grammar consists of, grouped into categories, independent of whether anybody has written
-- anything yet. grammar_content was the explanation — but one explanation per topic per
-- language, with no level.
--
-- That is the gap this closes. A topic is worth explaining differently at different levels:
-- Present Perfect to an A1 learner is not the explanation a C1 learner needs, and some
-- topics — inversion, cleft sentences — have no honest A1 explanation at all. So content is
-- now keyed by (topic, language, level), and a level can be marked not_applicable, which is
-- a real answer rather than an empty draft nobody will ever fill.
--
-- What does not change: the body shape, the versioning, the "one published row" rule, and
-- the fact that nothing reaches a learner until somebody publishes it.

ALTER TABLE grammar_content
    ADD COLUMN level_code cefr_code NOT NULL DEFAULT 'B1',
    -- Denormalised from the body so the map, the editor list and the publish check can read
    -- what a level says without parsing every JSONB document.
    ADD COLUMN title   TEXT NOT NULL DEFAULT '',
    ADD COLUMN summary TEXT NOT NULL DEFAULT '',
    -- Which generation produced this, when one did. Nothing is rendered from it; it is how
    -- "the AI wrote something odd" becomes a request you can actually look at.
    ADD COLUMN ai_request_id UUID REFERENCES ai_requests (id) ON DELETE SET NULL,
    ADD COLUMN created_by    UUID REFERENCES users (id) ON DELETE SET NULL;

-- Existing explanations were written for the topic's own level, so that is what they are.
UPDATE grammar_content gc
SET level_code = l.code
FROM grammar_topics t
JOIN levels l ON l.id = t.level_id
WHERE gc.grammar_topic_id = t.id;

-- not_applicable is a decision, not a gap: this topic is not worth teaching at this level.
-- The map shows it as settled rather than as work still to do.
ALTER TABLE grammar_content DROP CONSTRAINT grammar_content_status_check;
ALTER TABLE grammar_content ADD CONSTRAINT grammar_content_status_check
    CHECK (status IN ('draft', 'review', 'published', 'archived', 'not_applicable'));

-- One published row per topic per language per level. Editing a published level still
-- creates a new draft version; learners keep reading the published one until it is replaced.
DROP INDEX grammar_content_one_published;
CREATE UNIQUE INDEX grammar_content_one_published
    ON grammar_content (grammar_topic_id, language, level_code)
    WHERE status = 'published';

DROP INDEX grammar_content_topic_idx;
CREATE INDEX grammar_content_topic_idx
    ON grammar_content (grammar_topic_id, language, level_code, version DESC);

-- Practice is already per level through grammar_questions.level_id. What it lacked was a way
-- to tell a question written for one level's explanation from one written for another's, so
-- regenerating B2 practice does not disturb A2's.
ALTER TABLE grammar_questions
    ADD COLUMN ai_request_id UUID REFERENCES ai_requests (id) ON DELETE SET NULL;

CREATE INDEX grammar_questions_topic_level_idx
    ON grammar_questions (grammar_topic_id, level_id, status);
