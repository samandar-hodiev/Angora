-- The realtime speaking coach.
--
-- Ordinary speaking practice is one recording judged once, after the fact. This is a
-- conversation: the learner speaks a turn, hears what was wrong with it, and answers a
-- follow-up question — while they are still in the session. The feedback is worth more
-- there than in a report they read later, because they can act on it in the next sentence.
--
-- The session is still a speaking_sessions row, so it shows up in history, in progress and
-- in the forecast like any other practice. What is new is that it has turns.

CREATE TABLE speaking_turns (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id       UUID         NOT NULL REFERENCES speaking_sessions (id) ON DELETE CASCADE,
    turn_number      INTEGER      NOT NULL CHECK (turn_number > 0),
    -- Each stage keeps its own row, exactly as in the one-shot pipeline: a failure is
    -- attributable to storing, hearing or judging rather than to "the AI".
    audio_file_id    UUID         REFERENCES audio_files (id) ON DELETE SET NULL,
    transcript_id    UUID         REFERENCES transcripts (id) ON DELETE SET NULL,
    analysis_id      UUID         REFERENCES ai_analyses (id) ON DELETE SET NULL,
    -- What the learner was asked, and what they said. Denormalised on purpose: replaying a
    -- conversation should not need four joins, and the question they answered is part of
    -- what the answer means.
    prompt           TEXT         NOT NULL DEFAULT '',
    transcript       TEXT         NOT NULL DEFAULT '',
    coach_reply      TEXT         NOT NULL DEFAULT '',
    score            NUMERIC(5,2),
    duration_ms      INTEGER      NOT NULL DEFAULT 0,
    words_per_minute NUMERIC(6,2),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (session_id, turn_number)
);

CREATE INDEX speaking_turns_session_idx ON speaking_turns (session_id, turn_number);

-- Live coaching is a paid feature; one-shot speaking practice stays on the free plan.
INSERT INTO entitlements (key, kind, description) VALUES
    ('speaking.live_coach', 'feature', 'Live speaking conversation with instant feedback');

INSERT INTO plan_entitlements (plan_id, entitlement_key, limit_value, limit_period)
SELECT p.id, 'speaking.live_coach', NULL, NULL
FROM subscription_plans p WHERE p.code IN ('pro', 'ielts_pro');
