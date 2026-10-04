-- Vocabulary as content an owner writes, generates and publishes.
--
-- The word table was seeded and read, and nothing in between: no way to add a word from the
-- console, no translations, no record of whether a person or the model wrote it. A learner
-- in Uzbekistan needs the word in Uzbek or Russian beside its English definition, and an
-- owner needs to know which words nobody has read yet.

ALTER TABLE vocabulary
    -- {"uz": "...", "ru": "..."}: the word in the learner's own language.
    ADD COLUMN translations JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN source TEXT NOT NULL DEFAULT 'curated' CHECK (source IN ('ai', 'curated')),
    ADD COLUMN ai_request_id UUID REFERENCES ai_requests (id) ON DELETE SET NULL,
    ADD COLUMN created_by UUID REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN published_at TIMESTAMPTZ;

UPDATE vocabulary SET published_at = created_at WHERE status = 'published';

CREATE INDEX vocabulary_status_level_idx ON vocabulary (status, level_id);
