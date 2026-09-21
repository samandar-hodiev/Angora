-- Two gaps closed together, because they are the same gap in two places: content that
-- learners read had no history, and grammar explanations had no language.

-- ---------------------------------------------------------------------------------------
-- 1. Versioned content items.
--
-- grammar_content has been versioned since 000014: a new explanation is a new draft and
-- what learners are reading never changes underneath them. Reading passages, listening
-- sets and everything else in content_items had none of that — an edit overwrote the live
-- text and the previous wording was gone. This gives them the same history.
--
-- The live row stays the source of truth for reads, so nothing that queries content_items
-- has to change. Versions are an append-only record of what it used to say.

CREATE TABLE content_item_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_item_id UUID        NOT NULL REFERENCES content_items (id) ON DELETE CASCADE,
    version         INTEGER     NOT NULL,
    title           TEXT        NOT NULL,
    body            JSONB       NOT NULL DEFAULT '{}',
    difficulty      SMALLINT    NOT NULL DEFAULT 5,
    tags            TEXT[]      NOT NULL DEFAULT '{}',
    status          TEXT        NOT NULL,
    schema_version  INTEGER     NOT NULL DEFAULT 1,
    -- Why this version exists, in the editor's own words. Optional, and worth having:
    -- "shortened paragraph 3, learners were timing out" is the thing a diff cannot say.
    note            TEXT        NOT NULL DEFAULT '',
    created_by      UUID        REFERENCES users (id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (content_item_id, version)
);

CREATE INDEX content_item_versions_item_idx ON content_item_versions (content_item_id, version DESC);

ALTER TABLE content_items ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- Everything that already exists is version 1, recorded as it stands today. Without this
-- the first edit of an old item would have nothing to compare against.
INSERT INTO content_item_versions (content_item_id, version, title, body, difficulty, tags, status, schema_version, created_by, created_at, note)
SELECT id, 1, title, body, difficulty, tags, status, schema_version, created_by, created_at, 'Initial version'
FROM content_items;

-- ---------------------------------------------------------------------------------------
-- 2. Grammar explanations in the learner's own language.
--
-- The AI explanation cache has been keyed by language since 000014, but the curated
-- explanation — the one the product writes and reviews, and the one most learners
-- actually read — was English only. A learner whose native language is Uzbek could get a
-- generated Uzbek explanation and a hand-written English one, which is backwards: the
-- curated text is the one worth translating.

ALTER TABLE grammar_content ADD COLUMN language TEXT NOT NULL DEFAULT 'en'
    CHECK (language IN ('en', 'uz', 'ru'));

-- One published explanation per topic *per language*, rather than per topic.
DROP INDEX grammar_content_one_published;
CREATE UNIQUE INDEX grammar_content_one_published ON grammar_content (grammar_topic_id, language)
    WHERE status = 'published';

DROP INDEX grammar_content_topic_idx;
CREATE INDEX grammar_content_topic_idx ON grammar_content (grammar_topic_id, language, version DESC);
