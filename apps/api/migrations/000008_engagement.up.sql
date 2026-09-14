-- Engagement: notifications, streaks and achievements.

CREATE TABLE notifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    type       TEXT        NOT NULL,   -- analysis_completed | streak_reminder | ...
    channel    TEXT        NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'push', 'email')),
    title      TEXT        NOT NULL,
    body       TEXT        NOT NULL DEFAULT '',
    data       JSONB       NOT NULL DEFAULT '{}',
    sent_at    TIMESTAMPTZ,
    read_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_unread_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE streaks (
    user_id            UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    current_days       INTEGER     NOT NULL DEFAULT 0,
    longest_days       INTEGER     NOT NULL DEFAULT 0,
    -- Local calendar date in the learner's timezone (profiles.timezone).
    last_activity_date DATE,
    freezes_available  INTEGER     NOT NULL DEFAULT 0,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER streaks_set_updated_at BEFORE UPDATE ON streaks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE achievements (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT        NOT NULL UNIQUE,
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    icon        TEXT        NOT NULL DEFAULT '',
    criteria    JSONB       NOT NULL DEFAULT '{}',
    is_active   BOOLEAN     NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_achievements (
    user_id        UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    achievement_id UUID        NOT NULL REFERENCES achievements (id) ON DELETE CASCADE,
    earned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, achievement_id)
);
