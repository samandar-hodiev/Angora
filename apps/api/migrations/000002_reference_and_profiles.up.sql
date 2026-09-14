-- Learning reference data (levels, skills) and the learner profile.

CREATE TABLE levels (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT        NOT NULL UNIQUE,  -- CEFR code: A1..C2
    name        TEXT        NOT NULL,
    rank        SMALLINT    NOT NULL UNIQUE,  -- ordering: A1 = 1 ... C2 = 6
    description TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO levels (code, name, rank, description) VALUES
    ('A1', 'Beginner',           1, 'Understands and uses familiar everyday expressions.'),
    ('A2', 'Elementary',         2, 'Communicates in simple and routine tasks.'),
    ('B1', 'Intermediate',       3, 'Deals with most situations while travelling; describes experiences.'),
    ('B2', 'Upper Intermediate', 4, 'Interacts with fluency and spontaneity with native speakers.'),
    ('C1', 'Advanced',           5, 'Uses language flexibly for social, academic and professional purposes.'),
    ('C2', 'Proficient',         6, 'Understands virtually everything heard or read with ease.');

CREATE TABLE skills (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT        NOT NULL UNIQUE,
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    sort_order  SMALLINT    NOT NULL DEFAULT 0,
    is_active   BOOLEAN     NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER skills_set_updated_at BEFORE UPDATE ON skills
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO skills (code, name, description, sort_order) VALUES
    ('speaking',      'Speaking',      'Speak on real topics and get feedback on fluency, grammar and vocabulary.', 1),
    ('writing',       'Writing',       'Write essays, emails and answers and get structured corrections.',          2),
    ('reading',       'Reading',       'Read passages at your level and check comprehension.',                      3),
    ('listening',     'Listening',     'Listen to real English and answer questions.',                              4),
    ('grammar',       'Grammar',       'Master the grammar behind your most frequent mistakes.',                    5),
    ('vocabulary',    'Vocabulary',    'Grow and retain vocabulary with spaced repetition.',                        6),
    ('pronunciation', 'Pronunciation', 'Improve sounds, stress and intonation.',                                    7);

-- One profile per user. Mobile and web read and write the same row; updated_at is the
-- basis for future sync conflict handling.
CREATE TABLE profiles (
    user_id                 UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    display_name            TEXT        NOT NULL DEFAULT '',
    avatar_url              TEXT,
    native_language         TEXT,
    timezone                TEXT        NOT NULL DEFAULT 'UTC',
    current_level_id        UUID REFERENCES levels (id),
    target_level_id         UUID REFERENCES levels (id),
    learning_goals          TEXT[]      NOT NULL DEFAULT '{}',
    daily_goal_minutes      SMALLINT    NOT NULL DEFAULT 15
                            CHECK (daily_goal_minutes BETWEEN 5 AND 240),
    preferences             JSONB       NOT NULL DEFAULT '{}',
    onboarding_completed_at TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
