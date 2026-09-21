-- AI coach conversations.
--
-- The coach is the one AI surface that is a conversation rather than a one-shot evaluation,
-- so it needs somewhere to keep the thread. Messages are stored plainly: a learner asking
-- "why is this wrong?" is study material they should be able to scroll back through, and the
-- coach cannot answer in context without the history.
CREATE TABLE coach_conversations (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title      TEXT        NOT NULL DEFAULT '',
    -- What the learner was doing when they opened it, e.g. {"topic": "past-simple"}.
    context    JSONB       NOT NULL DEFAULT '{}',
    status     TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX coach_conversations_user_idx ON coach_conversations (user_id, updated_at DESC);

CREATE TRIGGER coach_conversations_set_updated_at BEFORE UPDATE ON coach_conversations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE coach_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID        NOT NULL REFERENCES coach_conversations (id) ON DELETE CASCADE,
    role            TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
    content         TEXT        NOT NULL,
    ai_request_id   UUID REFERENCES ai_requests (id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX coach_messages_conversation_idx ON coach_messages (conversation_id, created_at);
