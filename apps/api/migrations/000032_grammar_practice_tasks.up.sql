-- Writing and speaking tasks for a grammar topic, one per level, written with the topic.
--
-- The grammar page sends a learner who has finished a topic to write and to speak with it.
-- Until now the task they got was written on the spot by the model, for that learner, and
-- never seen by anyone: an owner could not read it, fix it, or decide it was not good enough.
-- These rows are those tasks as content. They are generated alongside the explanation and
-- the test, land as drafts, and reach learners when the topic is published — the same path
-- as everything else on the page. One task per topic, kind and level: a learner gets the one
-- written for their level.
--
-- English only. The learner writes and speaks in English; the task is part of the practice,
-- not an explanation to be read in their own language.

CREATE TABLE grammar_practice_tasks (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grammar_topic_id  UUID NOT NULL REFERENCES grammar_topics (id) ON DELETE CASCADE,
    kind              TEXT NOT NULL CHECK (kind IN ('writing', 'speaking')),
    level_code        cefr_code NOT NULL,
    title             TEXT NOT NULL,
    prompt            TEXT NOT NULL,
    -- writing: what to include; speaking: the points to talk about.
    instructions      JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- writing: the fewest words that count as an answer.
    min_words         INT NOT NULL DEFAULT 0 CHECK (min_words >= 0),
    -- speaking: how long the learner should talk for.
    target_seconds    INT NOT NULL DEFAULT 0 CHECK (target_seconds >= 0),
    minutes           INT NOT NULL DEFAULT 10 CHECK (minutes > 0),
    -- One sentence naming the grammar being practised; the page shows it and the
    -- evaluator is told it.
    focus             TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    source            TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'curated')),
    ai_request_id     UUID REFERENCES ai_requests (id) ON DELETE SET NULL,
    created_by        UUID REFERENCES users (id) ON DELETE SET NULL,
    published_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER grammar_practice_tasks_set_updated_at BEFORE UPDATE ON grammar_practice_tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- At most one draft and one live task per topic, kind and level.
CREATE UNIQUE INDEX grammar_practice_tasks_draft_idx
    ON grammar_practice_tasks (grammar_topic_id, kind, level_code) WHERE status = 'draft';
CREATE UNIQUE INDEX grammar_practice_tasks_live_idx
    ON grammar_practice_tasks (grammar_topic_id, kind, level_code) WHERE status = 'published';

-- A speaking recording made for a grammar topic, like a writing submission made for one,
-- keeps the prompt it answered and the topic it practised.
ALTER TABLE speaking_sessions
    ADD COLUMN prompt TEXT NOT NULL DEFAULT '',
    ADD COLUMN grammar_topic_id UUID REFERENCES grammar_topics (id) ON DELETE SET NULL;

CREATE INDEX speaking_sessions_grammar_topic_idx
    ON speaking_sessions (user_id, grammar_topic_id)
    WHERE grammar_topic_id IS NOT NULL;
