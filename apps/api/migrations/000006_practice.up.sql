-- Media metadata and practice activity. Audio bytes live in object storage; PostgreSQL
-- only stores where they are and what they are.

CREATE TABLE audio_files (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    storage_provider TEXT        NOT NULL,
    storage_key      TEXT        NOT NULL UNIQUE,
    mime_type        TEXT        NOT NULL,
    size_bytes       BIGINT      NOT NULL CHECK (size_bytes >= 0),
    duration_ms      INTEGER,
    checksum_sha256  TEXT        NOT NULL DEFAULT '',
    purpose          TEXT        NOT NULL DEFAULT 'speaking',
    status           TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'uploaded', 'ready', 'failed', 'deleted')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ
);

CREATE INDEX audio_files_user_idx ON audio_files (user_id, created_at DESC);

CREATE TRIGGER audio_files_set_updated_at BEFORE UPDATE ON audio_files
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE transcripts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    audio_file_id UUID        NOT NULL REFERENCES audio_files (id) ON DELETE CASCADE,
    language      TEXT        NOT NULL DEFAULT 'en',
    text          TEXT        NOT NULL,
    segments      JSONB       NOT NULL DEFAULT '[]',
    provider      TEXT        NOT NULL DEFAULT '',
    model         TEXT        NOT NULL DEFAULT '',
    ai_request_id UUID REFERENCES ai_requests (id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX transcripts_audio_idx ON transcripts (audio_file_id);

-- `mode` separates general practice from exam practice (e.g. ielts_part_2) without
-- separate tables: IELTS is a mode of the same learning activity.
CREATE TABLE speaking_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    content_item_id UUID REFERENCES content_items (id) ON DELETE SET NULL,
    mode            TEXT        NOT NULL DEFAULT 'practice',
    status          TEXT        NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress', 'submitted', 'analyzing', 'completed', 'failed', 'abandoned')),
    audio_file_id   UUID REFERENCES audio_files (id) ON DELETE SET NULL,
    transcript_id   UUID REFERENCES transcripts (id) ON DELETE SET NULL,
    analysis_id     UUID REFERENCES ai_analyses (id) ON DELETE SET NULL,
    overall_score   NUMERIC(5,2),
    duration_ms     INTEGER,
    client_platform TEXT        NOT NULL DEFAULT 'unknown',
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_at    TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX speaking_sessions_user_idx ON speaking_sessions (user_id, created_at DESC);

CREATE TRIGGER speaking_sessions_set_updated_at BEFORE UPDATE ON speaking_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE writing_submissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    content_item_id UUID REFERENCES content_items (id) ON DELETE SET NULL,
    mode            TEXT        NOT NULL DEFAULT 'practice',
    status          TEXT        NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'submitted', 'analyzing', 'completed', 'failed')),
    text            TEXT        NOT NULL DEFAULT '',
    word_count      INTEGER     NOT NULL DEFAULT 0,
    analysis_id     UUID REFERENCES ai_analyses (id) ON DELETE SET NULL,
    overall_score   NUMERIC(5,2),
    client_platform TEXT        NOT NULL DEFAULT 'unknown',
    submitted_at    TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX writing_submissions_user_idx ON writing_submissions (user_id, created_at DESC);

CREATE TRIGGER writing_submissions_set_updated_at BEFORE UPDATE ON writing_submissions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE reading_attempts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    content_item_id UUID        NOT NULL REFERENCES content_items (id),
    mode            TEXT        NOT NULL DEFAULT 'practice',
    status          TEXT        NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    answers         JSONB       NOT NULL DEFAULT '{}',
    correct_count   INTEGER     NOT NULL DEFAULT 0,
    total_count     INTEGER     NOT NULL DEFAULT 0,
    score           NUMERIC(5,2),
    time_spent_ms   INTEGER     NOT NULL DEFAULT 0,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reading_attempts_user_idx ON reading_attempts (user_id, created_at DESC);

CREATE TRIGGER reading_attempts_set_updated_at BEFORE UPDATE ON reading_attempts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE listening_attempts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    content_item_id UUID        NOT NULL REFERENCES content_items (id),
    mode            TEXT        NOT NULL DEFAULT 'practice',
    status          TEXT        NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    answers         JSONB       NOT NULL DEFAULT '{}',
    correct_count   INTEGER     NOT NULL DEFAULT 0,
    total_count     INTEGER     NOT NULL DEFAULT 0,
    score           NUMERIC(5,2),
    time_spent_ms   INTEGER     NOT NULL DEFAULT 0,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX listening_attempts_user_idx ON listening_attempts (user_id, created_at DESC);

CREATE TRIGGER listening_attempts_set_updated_at BEFORE UPDATE ON listening_attempts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
