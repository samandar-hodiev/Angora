-- The grammar learning system: curriculum, canonical content, relationships, practice,
-- mastery and AI caches.
--
-- Canonical grammar content is curated product content, never generated at read time.
-- AI output (explanations, visuals, generated questions) is cached or reviewed separately
-- so what the learner reads stays stable.

CREATE TABLE grammar_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT        NOT NULL UNIQUE,
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    sort_order  INTEGER     NOT NULL DEFAULT 0,
    status      TEXT        NOT NULL DEFAULT 'published'
                CHECK (status IN ('draft', 'review', 'published', 'archived')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER grammar_categories_set_updated_at BEFORE UPDATE ON grammar_categories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- grammar_topics already exists (slug, name, description, level_id, sort_order, status).
-- Everything the learning system needs beyond a flat list is added here.
ALTER TABLE grammar_topics
    ADD COLUMN category_id       UUID REFERENCES grammar_categories (id) ON DELETE SET NULL,
    -- Optional band inside a category, e.g. "Present" / "Past" / "Future" under Tenses.
    -- One extra level of grouping only: the tree never goes deeper than category → group → topic.
    ADD COLUMN group_label       TEXT          NOT NULL DEFAULT '',
    ADD COLUMN group_order       INTEGER       NOT NULL DEFAULT 0,
    -- Every CEFR level the topic is worth studying at; level_id stays the primary one.
    ADD COLUMN cefr_levels       TEXT[]        NOT NULL DEFAULT '{}',
    ADD COLUMN difficulty        NUMERIC(3,2)  NOT NULL DEFAULT 0.50 CHECK (difficulty BETWEEN 0 AND 1),
    -- Free-form search surface: grammar keywords, synonyms, forms ("v2", "did", "-ing").
    ADD COLUMN keywords          TEXT[]        NOT NULL DEFAULT '{}',
    ADD COLUMN ielts_relevant    BOOLEAN       NOT NULL DEFAULT false,
    ADD COLUMN estimated_minutes INTEGER       NOT NULL DEFAULT 10 CHECK (estimated_minutes > 0),
    ADD COLUMN published_at      TIMESTAMPTZ;

-- Search runs in PostgreSQL, not the client: the curriculum grows past what a client can hold.
-- The name outweighs the description so "past" ranks Past Simple over a topic that merely
-- mentions the past. Keywords are not in here because array_to_string is only STABLE and a
-- generated column needs IMMUTABLE; the grammar module matches them through the GIN index on
-- `keywords` below and adds their own rank bonus.
ALTER TABLE grammar_topics
    ADD COLUMN search_document TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'C')
    ) STORED;

CREATE INDEX grammar_topics_search_idx ON grammar_topics USING GIN (search_document);
CREATE INDEX grammar_topics_keywords_idx ON grammar_topics USING GIN (keywords);
CREATE INDEX grammar_topics_category_idx ON grammar_topics (category_id, group_order, sort_order);
CREATE INDEX grammar_topics_cefr_idx ON grammar_topics USING GIN (cefr_levels);

-- Canonical explanation for a topic, versioned. Exactly one row per topic is current.
-- `body` holds the structured sections the topic page renders (intro, explanation,
-- formulas, usage, examples, signal words, common mistakes); its shape is validated by
-- the grammar module against schema_version.
CREATE TABLE grammar_content (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grammar_topic_id UUID        NOT NULL REFERENCES grammar_topics (id) ON DELETE CASCADE,
    body             JSONB       NOT NULL DEFAULT '{}',
    schema_version   INTEGER     NOT NULL DEFAULT 1,
    version          INTEGER     NOT NULL DEFAULT 1,
    status           TEXT        NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'review', 'published', 'archived')),
    -- 'curated' content is written and reviewed by the product; 'ai' drafts never publish
    -- themselves (see the grammar module's publishing rules).
    source           TEXT        NOT NULL DEFAULT 'curated' CHECK (source IN ('curated', 'ai')),
    reviewed_by      UUID REFERENCES users (id) ON DELETE SET NULL,
    published_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX grammar_content_one_published ON grammar_content (grammar_topic_id)
    WHERE status = 'published';
CREATE INDEX grammar_content_topic_idx ON grammar_content (grammar_topic_id, version DESC);

CREATE TRIGGER grammar_content_set_updated_at BEFORE UPDATE ON grammar_content
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- How topics relate. Nothing about grammar structure is hardcoded in a UI component:
-- prerequisites, "what's next", comparisons and confusions are all rows here.
CREATE TABLE grammar_relations (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_topic_id  UUID        NOT NULL REFERENCES grammar_topics (id) ON DELETE CASCADE,
    to_topic_id    UUID        NOT NULL REFERENCES grammar_topics (id) ON DELETE CASCADE,
    kind           TEXT        NOT NULL
                   CHECK (kind IN ('prerequisite', 'related', 'compare', 'next', 'alternative', 'commonly_confused')),
    sort_order     INTEGER     NOT NULL DEFAULT 0,
    -- Short note shown on comparison links, e.g. "finished time vs time connected to now".
    note           TEXT        NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT grammar_relations_not_self CHECK (from_topic_id <> to_topic_id),
    UNIQUE (from_topic_id, to_topic_id, kind)
);

CREATE INDEX grammar_relations_from_idx ON grammar_relations (from_topic_id, kind, sort_order);
CREATE INDEX grammar_relations_to_idx ON grammar_relations (to_topic_id, kind);

-- A comparison table between two topics (Past Simple vs Present Perfect). Stored once and
-- read from either direction; `rows` holds the aspect/left/right triples.
CREATE TABLE grammar_comparisons (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    left_topic_id  UUID       NOT NULL REFERENCES grammar_topics (id) ON DELETE CASCADE,
    right_topic_id UUID       NOT NULL REFERENCES grammar_topics (id) ON DELETE CASCADE,
    summary       TEXT        NOT NULL DEFAULT '',
    rows          JSONB       NOT NULL DEFAULT '[]',
    status        TEXT        NOT NULL DEFAULT 'published'
                  CHECK (status IN ('draft', 'review', 'published', 'archived')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT grammar_comparisons_not_self CHECK (left_topic_id <> right_topic_id),
    UNIQUE (left_topic_id, right_topic_id)
);

CREATE TRIGGER grammar_comparisons_set_updated_at BEFORE UPDATE ON grammar_comparisons
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Practice questions. Curated questions are the canonical bank; AI-generated ones stay in
-- 'review' until validated, so a learner is never graded against unreviewed content.
CREATE TABLE grammar_questions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grammar_topic_id UUID        NOT NULL REFERENCES grammar_topics (id) ON DELETE CASCADE,
    type             TEXT        NOT NULL
                     CHECK (type IN ('multiple_choice', 'fill_blank', 'ordering', 'error_correction',
                                     'transformation', 'matching', 'short_answer', 'free_writing', 'contextual')),
    level_id         UUID REFERENCES levels (id),
    difficulty       NUMERIC(3,2) NOT NULL DEFAULT 0.50 CHECK (difficulty BETWEEN 0 AND 1),
    prompt           TEXT        NOT NULL,
    -- Type-specific payload: options, segments, instruction, context, matching pairs.
    payload          JSONB       NOT NULL DEFAULT '{}',
    -- Accepted answers. Deterministic types are scored against this in Go, never by AI.
    answer           JSONB       NOT NULL DEFAULT '{}',
    explanation      TEXT        NOT NULL DEFAULT '',
    -- The specific rule being tested, e.g. 'negative-base-form'. Drives weakness detection.
    target_rule      TEXT        NOT NULL DEFAULT '',
    tags             TEXT[]      NOT NULL DEFAULT '{}',
    source           TEXT        NOT NULL DEFAULT 'curated' CHECK (source IN ('curated', 'ai')),
    status           TEXT        NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'review', 'published', 'archived')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX grammar_questions_topic_idx ON grammar_questions (grammar_topic_id, status, difficulty);
CREATE INDEX grammar_questions_rule_idx ON grammar_questions (grammar_topic_id, target_rule);
CREATE INDEX grammar_questions_tags_idx ON grammar_questions USING GIN (tags);

CREATE TRIGGER grammar_questions_set_updated_at BEFORE UPDATE ON grammar_questions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One practice run. `mode` separates learning (feedback after each answer) from test
-- (feedback withheld until the end) — the same split IELTS-style grammar testing needs.
CREATE TABLE grammar_attempts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    grammar_topic_id UUID        NOT NULL REFERENCES grammar_topics (id) ON DELETE CASCADE,
    mode             TEXT        NOT NULL DEFAULT 'learning' CHECK (mode IN ('learning', 'test')),
    status           TEXT        NOT NULL DEFAULT 'in_progress'
                     CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    question_ids     UUID[]      NOT NULL DEFAULT '{}',
    correct_count    INTEGER     NOT NULL DEFAULT 0,
    total_count      INTEGER     NOT NULL DEFAULT 0,
    score            NUMERIC(5,2),
    time_spent_ms    INTEGER     NOT NULL DEFAULT 0,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX grammar_attempts_user_idx ON grammar_attempts (user_id, created_at DESC);
CREATE INDEX grammar_attempts_user_topic_idx ON grammar_attempts (user_id, grammar_topic_id, created_at DESC);

CREATE TRIGGER grammar_attempts_set_updated_at BEFORE UPDATE ON grammar_attempts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One answer. Kept per question rather than as a blob on the attempt so accuracy can be
-- reported per rule, per question type and per difficulty.
CREATE TABLE grammar_answers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id          UUID         NOT NULL REFERENCES grammar_attempts (id) ON DELETE CASCADE,
    user_id             UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    grammar_question_id UUID         NOT NULL REFERENCES grammar_questions (id) ON DELETE CASCADE,
    response            JSONB        NOT NULL DEFAULT '{}',
    is_correct          BOOLEAN      NOT NULL DEFAULT false,
    -- 0..1. Deterministic types are 0 or 1; free writing is scored on target-grammar use.
    score               NUMERIC(4,3) NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 1),
    question_type       TEXT         NOT NULL,
    target_rule         TEXT         NOT NULL DEFAULT '',
    difficulty          NUMERIC(3,2) NOT NULL DEFAULT 0.50,
    feedback            JSONB        NOT NULL DEFAULT '{}',
    analysis_id         UUID REFERENCES ai_analyses (id) ON DELETE SET NULL,
    response_ms         INTEGER      NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (attempt_id, grammar_question_id)
);

CREATE INDEX grammar_answers_user_idx ON grammar_answers (user_id, created_at DESC);
CREATE INDEX grammar_answers_rule_idx ON grammar_answers (user_id, target_rule, created_at DESC);

-- Mastery is more than the last quiz score, so user_grammar_progress carries the three
-- signals it is composed from. `mastery` stays the single number clients already read.
ALTER TABLE user_grammar_progress
    -- Did the learner read and follow the explanation (topic opened, AI explanation, visual)?
    ADD COLUMN understanding NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (understanding BETWEEN 0 AND 100),
    -- How well do they do in exercises, weighted by recency and difficulty?
    ADD COLUMN practice      NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (practice BETWEEN 0 AND 100),
    -- Do they actually use it correctly in their own writing and speaking?
    ADD COLUMN application   NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (application BETWEEN 0 AND 100),
    ADD COLUMN state         TEXT NOT NULL DEFAULT 'not_started'
               CHECK (state IN ('not_started', 'learning', 'practicing', 'developing', 'mastered')),
    -- The understanding signals, per learner. They are recorded here rather than inferred
    -- from the shared AI caches: that a canonical explanation exists says nothing about
    -- whether *this* learner ever read it.
    ADD COLUMN opened_at        TIMESTAMPTZ,
    ADD COLUMN explained_at     TIMESTAMPTZ,
    ADD COLUMN visual_viewed_at TIMESTAMPTZ,
    ADD COLUMN mastered_at      TIMESTAMPTZ;

-- Recurring grammar errors per rule. mistakes/weaknesses stay the global store; this is the
-- per-topic roll-up the practice engine and the coach read without scanning every mistake.
CREATE TABLE grammar_user_errors (
    user_id          UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    grammar_topic_id UUID         NOT NULL REFERENCES grammar_topics (id) ON DELETE CASCADE,
    target_rule      TEXT         NOT NULL DEFAULT '',
    occurrences      INTEGER      NOT NULL DEFAULT 0,
    last_example     TEXT         NOT NULL DEFAULT '',
    last_correction  TEXT         NOT NULL DEFAULT '',
    severity_score   NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (severity_score BETWEEN 0 AND 100),
    -- practice | writing | speaking: the same rule missed while speaking matters more than
    -- in a quiz, and the coach needs to know where it happened.
    last_source      TEXT         NOT NULL DEFAULT 'practice',
    first_seen_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_seen_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, grammar_topic_id, target_rule)
);

CREATE INDEX grammar_user_errors_user_idx ON grammar_user_errors (user_id, severity_score DESC);

CREATE TRIGGER grammar_user_errors_set_updated_at BEFORE UPDATE ON grammar_user_errors
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Links a mistake to the grammar topic it belongs to, so a mistake made while speaking or
-- writing becomes grammar practice. The dotted category taxonomy is unchanged.
ALTER TABLE mistakes
    ADD COLUMN grammar_topic_id UUID REFERENCES grammar_topics (id) ON DELETE SET NULL;

CREATE INDEX mistakes_grammar_topic_idx ON mistakes (user_id, grammar_topic_id)
    WHERE grammar_topic_id IS NOT NULL;

-- Generated visuals. The image lives in object storage; this table only says where it is
-- and what it depicts, so the same canonical visual is generated once and reused.
CREATE TABLE grammar_visuals (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grammar_topic_id UUID        NOT NULL REFERENCES grammar_topics (id) ON DELETE CASCADE,
    -- Second topic for comparison visuals, NULL otherwise.
    compare_topic_id UUID REFERENCES grammar_topics (id) ON DELETE CASCADE,
    kind             TEXT        NOT NULL DEFAULT 'timeline'
                     CHECK (kind IN ('timeline', 'flow', 'comparison_table', 'transformation', 'rule_diagram', 'concept_map')),
    -- NULL for the canonical visual everyone shares; set for a personalized one.
    user_id          UUID REFERENCES users (id) ON DELETE CASCADE,
    storage_provider TEXT        NOT NULL DEFAULT '',
    storage_key      TEXT        NOT NULL DEFAULT '',
    mime_type        TEXT        NOT NULL DEFAULT 'image/svg+xml',
    alt_text         TEXT        NOT NULL DEFAULT '',
    caption          TEXT        NOT NULL DEFAULT '',
    status           TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'ready', 'failed')),
    model            TEXT        NOT NULL DEFAULT '',
    ai_request_id    UUID REFERENCES ai_requests (id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One canonical visual per topic/compare/kind; personalized ones are not deduplicated.
CREATE UNIQUE INDEX grammar_visuals_canonical_key
    ON grammar_visuals (grammar_topic_id, kind, coalesce(compare_topic_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE user_id IS NULL;
CREATE INDEX grammar_visuals_topic_idx ON grammar_visuals (grammar_topic_id, status);

CREATE TRIGGER grammar_visuals_set_updated_at BEFORE UPDATE ON grammar_visuals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Cached AI explanations. The same topic explained at the same level in the same language
-- is one generation, not one per learner: it is the single most requested AI call.
CREATE TABLE grammar_ai_explanations (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grammar_topic_id UUID        NOT NULL REFERENCES grammar_topics (id) ON DELETE CASCADE,
    level_code       TEXT        NOT NULL,
    language         TEXT        NOT NULL DEFAULT 'en',
    body             JSONB       NOT NULL DEFAULT '{}',
    model            TEXT        NOT NULL DEFAULT '',
    prompt_version   TEXT        NOT NULL DEFAULT '',
    ai_request_id    UUID REFERENCES ai_requests (id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (grammar_topic_id, level_code, language, prompt_version)
);

CREATE INDEX grammar_ai_explanations_lookup_idx
    ON grammar_ai_explanations (grammar_topic_id, level_code, language, created_at DESC);
