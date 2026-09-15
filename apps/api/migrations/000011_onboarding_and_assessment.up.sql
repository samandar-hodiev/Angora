-- Onboarding state, placement assessment, CEFR level history, structured learning plans and
-- product analytics.
--
-- Everything here is client-agnostic product data: web, iOS and Android read and write the
-- same rows through /api/v1. Nothing describes how a screen looks.

-- A CEFR estimate, optionally with a "+" for "above this level, not yet the next" (e.g. B1+).
CREATE DOMAIN cefr_code AS TEXT CHECK (VALUE ~ '^(A1|A2|B1|B2|C1|C2)\+?$');

-- ---- Onboarding -------------------------------------------------------------------------

-- Where each learner is in onboarding, so any client can resume at the exact step.
CREATE TABLE onboarding_progress (
    user_id       UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    step          TEXT        NOT NULL DEFAULT 'NOT_STARTED' CHECK (step IN (
                      'NOT_STARTED', 'WELCOME', 'GOAL_SELECTION', 'DAILY_TIME', 'LEVEL_SELECTION',
                      'PLACEMENT_INTRO', 'PLACEMENT_START_LEVEL',
                      'PLACEMENT_READING', 'PLACEMENT_LISTENING', 'PLACEMENT_WRITING', 'PLACEMENT_SPEAKING',
                      'PLACEMENT_PROCESSING', 'PLACEMENT_RESULTS', 'PERSONALIZED_PLAN', 'COMPLETED')),
    -- How the starting level was established: the learner's own choice or a placement test.
    level_path    TEXT CHECK (level_path IN ('self_reported', 'placement')),
    assessment_id UUID,
    started_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER onboarding_progress_set_updated_at BEFORE UPDATE ON onboarding_progress
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Learners who finished the previous onboarding keep their completed state.
INSERT INTO onboarding_progress (user_id, step, started_at, completed_at)
SELECT user_id, 'COMPLETED', onboarding_completed_at, onboarding_completed_at
FROM profiles WHERE onboarding_completed_at IS NOT NULL;

-- ---- Level history ----------------------------------------------------------------------

-- Every level statement about a learner, never overwritten:
--   self_reported    what the learner says their level is
--   placement_start  the level they think they are closest to before a placement test
--   assessed         the result of an assessment
--   estimated        Engora's current best estimate (from assessments, later from practice)
-- profiles.current_level_id mirrors the latest estimate's base level for cheap reads.
CREATE TABLE user_levels (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind        TEXT         NOT NULL CHECK (kind IN ('self_reported', 'placement_start', 'assessed', 'estimated')),
    cefr        cefr_code    NOT NULL,
    source_type TEXT         NOT NULL CHECK (source_type IN ('onboarding', 'assessment', 'practice', 'admin')),
    source_id   UUID,
    confidence  NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX user_levels_user_kind_idx ON user_levels (user_id, kind, created_at DESC);

-- ---- Assessment configuration and content -----------------------------------------------

-- Section order, time limits, item counts and retake policy. Clients never hardcode these;
-- each assessment stores a snapshot of the config it was taken with.
CREATE TABLE assessment_configs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind       TEXT        NOT NULL,
    version    INTEGER     NOT NULL,
    status     TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
    config     JSONB       NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (kind, version)
);

CREATE UNIQUE INDEX assessment_configs_one_active ON assessment_configs (kind) WHERE status = 'active';

INSERT INTO assessment_configs (kind, version, status, config) VALUES ('placement', 1, 'active', '{
  "grace_seconds": 30,
  "sections": [
    {"skill": "reading",   "time_limit_seconds": 720,  "items": {"foundation": 3, "core": 4, "challenge": 3}},
    {"skill": "listening", "time_limit_seconds": 720,  "items": {"foundation": 3, "core": 4, "challenge": 3}, "max_plays": 2},
    {"skill": "writing",   "time_limit_seconds": 1200, "items": {"core": 1}},
    {"skill": "speaking",  "time_limit_seconds": 480,  "items": {"core": 1, "challenge": 1}, "max_attempts": 2}
  ]
}');

-- Content audio (listening clips) is not owned by a learner.
ALTER TABLE audio_files ALTER COLUMN user_id DROP NOT NULL;

-- The assessment question bank. Stimuli (reading passages, listening clips) are
-- content_items with exam = 'placement'; each question/task is a row here with its own
-- CEFR level, difficulty and answer key, so question performance can be measured and an
-- adaptive engine can later select items one at a time.
CREATE TABLE assessment_items (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Stable identifier for authoring tools and seeds.
    slug         TEXT        NOT NULL UNIQUE,
    kind         TEXT        NOT NULL DEFAULT 'placement',
    skill        TEXT        NOT NULL CHECK (skill IN ('reading', 'listening', 'writing', 'speaking')),
    level_id     UUID        NOT NULL REFERENCES levels (id),
    difficulty   SMALLINT    NOT NULL DEFAULT 5 CHECK (difficulty BETWEEN 1 AND 10),
    topic        TEXT        NOT NULL DEFAULT '',
    item_type    TEXT        NOT NULL CHECK (item_type IN (
                     'multiple_choice', 'true_false_not_given', 'vocabulary_in_context',
                     'writing_task', 'speaking_task')),
    stimulus_id  UUID REFERENCES content_items (id) ON DELETE RESTRICT,
    position     INTEGER     NOT NULL DEFAULT 0,
    prompt       TEXT        NOT NULL,
    -- [{"id": "a", "text": "..."}] for objective items; [] for tasks.
    options      JSONB       NOT NULL DEFAULT '[]',
    -- {"option_id": "b"}. Never returned to learners.
    answer_key   JSONB,
    explanation  TEXT        NOT NULL DEFAULT '',
    -- Task settings, e.g. {"min_words": 80, "max_words": 150} or {"prep_seconds": 30, "response_seconds": 60}.
    settings     JSONB       NOT NULL DEFAULT '{}',
    status       TEXT        NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'review', 'published', 'archived')),
    version      INTEGER     NOT NULL DEFAULT 1,
    created_by   UUID REFERENCES users (id) ON DELETE SET NULL,
    published_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((item_type IN ('writing_task', 'speaking_task')) OR answer_key IS NOT NULL)
);

CREATE INDEX assessment_items_selection_idx ON assessment_items (kind, skill, level_id, stimulus_id, position)
    WHERE status = 'published';

CREATE TRIGGER assessment_items_set_updated_at BEFORE UPDATE ON assessment_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- Assessments -------------------------------------------------------------------------

CREATE TABLE assessments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind            TEXT        NOT NULL DEFAULT 'placement',
    config_id       UUID        NOT NULL REFERENCES assessment_configs (id),
    config          JSONB       NOT NULL,
    start_level_id  UUID        NOT NULL REFERENCES levels (id),
    -- Where it was started from: onboarding, or later from the learner's profile.
    source          TEXT        NOT NULL DEFAULT 'onboarding' CHECK (source IN ('onboarding', 'profile')),
    status          TEXT        NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress', 'processing', 'completed', 'failed', 'abandoned')),
    client_platform TEXT        NOT NULL DEFAULT 'unknown',
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_at    TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    abandoned_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX assessments_user_idx ON assessments (user_id, created_at DESC);
-- At most one open assessment of a kind per learner; completed ones are kept as history.
CREATE UNIQUE INDEX assessments_one_open ON assessments (user_id, kind) WHERE status IN ('in_progress', 'processing');

CREATE TRIGGER assessments_set_updated_at BEFORE UPDATE ON assessments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE onboarding_progress
    ADD CONSTRAINT onboarding_progress_assessment_fk FOREIGN KEY (assessment_id) REFERENCES assessments (id) ON DELETE SET NULL;

-- Sections unlock strictly in order. deadline_at is authoritative: clients display it, the
-- server enforces it.
CREATE TABLE assessment_sections (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id      UUID        NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    skill              TEXT        NOT NULL CHECK (skill IN ('reading', 'listening', 'writing', 'speaking')),
    position           SMALLINT    NOT NULL,
    status             TEXT        NOT NULL DEFAULT 'locked' CHECK (status IN (
                           'locked', 'available', 'in_progress', 'evaluating', 'completed', 'failed')),
    time_limit_seconds INTEGER     NOT NULL CHECK (time_limit_seconds > 0),
    started_at         TIMESTAMPTZ,
    deadline_at        TIMESTAMPTZ,
    submitted_at       TIMESTAMPTZ,
    completed_at       TIMESTAMPTZ,
    error_code         TEXT        NOT NULL DEFAULT '',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (assessment_id, skill),
    UNIQUE (assessment_id, position)
);

CREATE TRIGGER assessment_sections_set_updated_at BEFORE UPDATE ON assessment_sections
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The items chosen for a section, fixed when the assessment is created so a refresh or a
-- different device shows exactly the same test.
CREATE TABLE assessment_section_items (
    section_id   UUID     NOT NULL REFERENCES assessment_sections (id) ON DELETE CASCADE,
    item_id      UUID     NOT NULL REFERENCES assessment_items (id),
    item_version INTEGER  NOT NULL,
    position     SMALLINT NOT NULL,
    -- Relative to the learner's starting level: foundation (below), core (at), challenge (above).
    band         TEXT     NOT NULL CHECK (band IN ('foundation', 'core', 'challenge')),
    PRIMARY KEY (section_id, item_id),
    UNIQUE (section_id, position)
);

CREATE TABLE assessment_answers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id      UUID         NOT NULL,
    item_id         UUID         NOT NULL,
    -- {"option_id": "b"} or {"text": "..."}; saved continuously so nothing is lost on refresh.
    response        JSONB        NOT NULL DEFAULT '{}',
    -- Set by the server when the section is scored. Never accepted from clients.
    is_correct      BOOLEAN,
    points          NUMERIC(5,2),
    time_spent_ms   INTEGER      NOT NULL DEFAULT 0 CHECK (time_spent_ms >= 0),
    answered_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (section_id, item_id),
    FOREIGN KEY (section_id, item_id) REFERENCES assessment_section_items (section_id, item_id) ON DELETE CASCADE
);

CREATE TRIGGER assessment_answers_set_updated_at BEFORE UPDATE ON assessment_answers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Writing and speaking responses reuse the practice tables (mode = 'placement'), so the AI
-- pipeline, transcripts and analyses are shared with everyday practice.
ALTER TABLE writing_submissions
    ADD COLUMN assessment_section_id UUID REFERENCES assessment_sections (id) ON DELETE SET NULL,
    ADD COLUMN assessment_item_id    UUID REFERENCES assessment_items (id) ON DELETE SET NULL,
    ADD COLUMN time_spent_ms         INTEGER NOT NULL DEFAULT 0 CHECK (time_spent_ms >= 0);

CREATE UNIQUE INDEX writing_submissions_assessment_item_key
    ON writing_submissions (assessment_section_id, assessment_item_id) WHERE assessment_section_id IS NOT NULL;

ALTER TABLE speaking_sessions
    ADD COLUMN assessment_section_id UUID REFERENCES assessment_sections (id) ON DELETE SET NULL,
    ADD COLUMN assessment_item_id    UUID REFERENCES assessment_items (id) ON DELETE SET NULL,
    ADD COLUMN attempt_number        SMALLINT NOT NULL DEFAULT 1 CHECK (attempt_number >= 1);

CREATE UNIQUE INDEX speaking_sessions_assessment_attempt_key
    ON speaking_sessions (assessment_section_id, assessment_item_id, attempt_number) WHERE assessment_section_id IS NOT NULL;

-- ---- Results ------------------------------------------------------------------------------

CREATE TABLE assessment_skill_results (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id   UUID         NOT NULL REFERENCES assessments (id) ON DELETE CASCADE,
    skill           TEXT         NOT NULL CHECK (skill IN ('reading', 'listening', 'writing', 'speaking')),
    score           NUMERIC(5,2) NOT NULL CHECK (score BETWEEN 0 AND 100),
    cefr            cefr_code    NOT NULL,
    confidence      NUMERIC(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    -- Criterion scores 0..100, e.g. {"grammar": 52, "vocabulary": 61}.
    subscores       JSONB        NOT NULL DEFAULT '{}',
    -- What the estimate is based on, e.g. accuracy per level or word counts.
    evidence        JSONB        NOT NULL DEFAULT '{}',
    scoring_version TEXT         NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (assessment_id, skill)
);

CREATE TABLE assessment_results (
    assessment_id   UUID PRIMARY KEY REFERENCES assessments (id) ON DELETE CASCADE,
    user_id         UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    overall_cefr    cefr_code    NOT NULL,
    overall_score   NUMERIC(5,2) NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
    confidence      NUMERIC(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    -- [{"type": "skill", "code": "reading"}, {"type": "criterion", "code": "writing.vocabulary"}]
    strengths       JSONB        NOT NULL DEFAULT '[]',
    focus_areas     JSONB        NOT NULL DEFAULT '[]',
    -- A structured coach summary: {"code": "...", "params": {...}, "text": "..."}.
    summary         JSONB        NOT NULL DEFAULT '{}',
    scoring_version TEXT         NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX assessment_results_user_idx ON assessment_results (user_id, created_at DESC);

-- ---- Structured learning plans ------------------------------------------------------------

ALTER TABLE learning_plans
    ADD COLUMN source_assessment_id UUID REFERENCES assessments (id) ON DELETE SET NULL,
    ADD COLUMN daily_minutes        SMALLINT CHECK (daily_minutes BETWEEN 5 AND 240),
    ADD COLUMN level                cefr_code;

CREATE TABLE learning_plan_items (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    learning_plan_id UUID        NOT NULL REFERENCES learning_plans (id) ON DELETE CASCADE,
    position         SMALLINT    NOT NULL,
    skill            TEXT        NOT NULL REFERENCES skills (code),
    -- Dotted focus code shared with mistakes/weaknesses, e.g. grammar.tense.past_simple.
    focus            TEXT        NOT NULL DEFAULT '',
    activity_code    TEXT        NOT NULL,
    title            TEXT        NOT NULL,
    description      TEXT        NOT NULL DEFAULT '',
    minutes          SMALLINT    NOT NULL CHECK (minutes BETWEEN 1 AND 120),
    level            cefr_code,
    content_item_id  UUID REFERENCES content_items (id) ON DELETE SET NULL,
    -- Why it was chosen: weakness | goal | level | balance.
    reason_code      TEXT        NOT NULL DEFAULT '',
    status           TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (learning_plan_id, position)
);

CREATE TRIGGER learning_plan_items_set_updated_at BEFORE UPDATE ON learning_plan_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Weaknesses found by assessments point back at their source.
ALTER TABLE weaknesses ADD COLUMN source_assessment_id UUID REFERENCES assessments (id) ON DELETE SET NULL;

-- ---- Analytics ------------------------------------------------------------------------------

-- Provider-neutral product events. A forwarder to an analytics vendor can read from here.
CREATE TABLE analytics_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users (id) ON DELETE SET NULL,
    anonymous_id    TEXT        NOT NULL DEFAULT '',
    name            TEXT        NOT NULL,
    properties      JSONB       NOT NULL DEFAULT '{}',
    source          TEXT        NOT NULL DEFAULT 'server' CHECK (source IN ('server', 'client')),
    client_platform TEXT        NOT NULL DEFAULT 'unknown',
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX analytics_events_name_idx ON analytics_events (name, occurred_at DESC);
CREATE INDEX analytics_events_user_idx ON analytics_events (user_id, occurred_at DESC);
