-- Learner progress, mistakes, weaknesses and personalization.

CREATE TABLE user_vocabulary (
    user_id          UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    vocabulary_id    UUID         NOT NULL REFERENCES vocabulary (id) ON DELETE CASCADE,
    status           TEXT         NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'learning', 'reviewing', 'mastered')),
    -- Spaced-repetition state (SM-2 style); the algorithm itself lives in the vocabulary module.
    ease_factor      NUMERIC(4,2) NOT NULL DEFAULT 2.50,
    interval_days    INTEGER      NOT NULL DEFAULT 0,
    repetitions      INTEGER      NOT NULL DEFAULT 0,
    due_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_reviewed_at TIMESTAMPTZ,
    source           TEXT         NOT NULL DEFAULT 'manual',  -- manual | mistake | lesson | ai
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, vocabulary_id)
);

CREATE INDEX user_vocabulary_due_idx ON user_vocabulary (user_id, due_at);

CREATE TRIGGER user_vocabulary_set_updated_at BEFORE UPDATE ON user_vocabulary
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE vocabulary_reviews (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    vocabulary_id UUID        NOT NULL REFERENCES vocabulary (id) ON DELETE CASCADE,
    rating        SMALLINT    NOT NULL CHECK (rating BETWEEN 0 AND 5),
    response_ms   INTEGER,
    reviewed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX vocabulary_reviews_user_idx ON vocabulary_reviews (user_id, reviewed_at DESC);

CREATE TABLE user_grammar_progress (
    user_id          UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    grammar_topic_id UUID         NOT NULL REFERENCES grammar_topics (id) ON DELETE CASCADE,
    mastery          NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (mastery BETWEEN 0 AND 100),
    attempts         INTEGER      NOT NULL DEFAULT 0,
    correct          INTEGER      NOT NULL DEFAULT 0,
    last_practiced_at TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, grammar_topic_id)
);

CREATE TRIGGER user_grammar_progress_set_updated_at BEFORE UPDATE ON user_grammar_progress
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Individual mistakes extracted from AI analyses or exercises.
CREATE TABLE mistakes (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    skill_id       UUID REFERENCES skills (id),
    -- Dotted taxonomy, e.g. grammar.tense.present_perfect, vocabulary.collocation
    category       TEXT        NOT NULL,
    source_type    TEXT        NOT NULL,   -- speaking_session | writing_submission | exercise
    source_id      UUID,
    analysis_id    UUID REFERENCES ai_analyses (id) ON DELETE SET NULL,
    original_text  TEXT        NOT NULL DEFAULT '',
    corrected_text TEXT        NOT NULL DEFAULT '',
    explanation    TEXT        NOT NULL DEFAULT '',
    severity       TEXT        NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX mistakes_user_idx ON mistakes (user_id, created_at DESC);
CREATE INDEX mistakes_user_category_idx ON mistakes (user_id, category);

-- Aggregated, recurring patterns derived from mistakes. Feeds recommendations.
CREATE TABLE weaknesses (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    skill_id          UUID REFERENCES skills (id),
    category          TEXT         NOT NULL,
    severity_score    NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (severity_score BETWEEN 0 AND 100),
    evidence_count    INTEGER      NOT NULL DEFAULT 0,
    status            TEXT         NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'improving', 'resolved')),
    first_detected_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_detected_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (user_id, category)
);

CREATE INDEX weaknesses_user_status_idx ON weaknesses (user_id, status);

CREATE TRIGGER weaknesses_set_updated_at BEFORE UPDATE ON weaknesses
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE skill_progress (
    user_id            UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    skill_id           UUID         NOT NULL REFERENCES skills (id),
    estimated_level_id UUID REFERENCES levels (id),
    score              NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
    xp                 INTEGER      NOT NULL DEFAULT 0,
    sessions_count     INTEGER      NOT NULL DEFAULT 0,
    last_practiced_at  TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, skill_id)
);

CREATE TRIGGER skill_progress_set_updated_at BEFORE UPDATE ON skill_progress
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE learning_plans (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status           TEXT        NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'completed', 'archived')),
    goal             TEXT        NOT NULL DEFAULT '',
    target_level_id  UUID REFERENCES levels (id),
    starts_on        DATE        NOT NULL DEFAULT CURRENT_DATE,
    ends_on          DATE,
    plan             JSONB       NOT NULL DEFAULT '{}',
    generated_by     TEXT        NOT NULL DEFAULT 'system' CHECK (generated_by IN ('system', 'ai', 'teacher')),
    analysis_version TEXT        NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX learning_plans_one_active_per_user ON learning_plans (user_id) WHERE status = 'active';

CREATE TRIGGER learning_plans_set_updated_at BEFORE UPDATE ON learning_plans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE recommendations (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    learning_plan_id UUID REFERENCES learning_plans (id) ON DELETE SET NULL,
    weakness_id      UUID REFERENCES weaknesses (id) ON DELETE SET NULL,
    type             TEXT        NOT NULL,   -- content_item | lesson | vocabulary_review | ...
    content_item_id  UUID REFERENCES content_items (id) ON DELETE CASCADE,
    lesson_id        UUID REFERENCES lessons (id) ON DELETE CASCADE,
    reason           TEXT        NOT NULL DEFAULT '',
    priority         SMALLINT    NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
    status           TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'dismissed', 'completed', 'expired')),
    source           TEXT        NOT NULL DEFAULT 'rule' CHECK (source IN ('rule', 'ai', 'teacher')),
    expires_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX recommendations_user_idx ON recommendations (user_id, status, priority DESC);

CREATE TRIGGER recommendations_set_updated_at BEFORE UPDATE ON recommendations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
