-- AI observability and structured, versioned AI results.

-- One row per provider call. This is the raw ledger for cost tracking, latency analysis
-- and debugging. It never stores prompts, audio or API keys.
CREATE TABLE ai_requests (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID REFERENCES users (id) ON DELETE SET NULL,
    task               TEXT          NOT NULL,           -- e.g. speaking_evaluation
    provider           TEXT          NOT NULL,
    model              TEXT          NOT NULL DEFAULT '',
    status             TEXT          NOT NULL CHECK (status IN ('succeeded', 'failed')),
    input_tokens       INTEGER       NOT NULL DEFAULT 0,
    output_tokens      INTEGER       NOT NULL DEFAULT 0,
    audio_seconds      NUMERIC(10,2) NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
    latency_ms         INTEGER       NOT NULL DEFAULT 0,
    error_code         TEXT          NOT NULL DEFAULT '',
    prompt_version     TEXT          NOT NULL DEFAULT '',
    request_id         TEXT          NOT NULL DEFAULT '',
    metadata           JSONB         NOT NULL DEFAULT '{}',
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX ai_requests_user_idx ON ai_requests (user_id, created_at DESC);
CREATE INDEX ai_requests_task_idx ON ai_requests (task, created_at DESC);
CREATE INDEX ai_requests_model_idx ON ai_requests (provider, model, created_at DESC);

-- Daily roll-up for dashboards and budget alerts. user_id is NULL for system work such as
-- content generation; NULLS NOT DISTINCT (PostgreSQL 15+) keeps those rows unique too.
CREATE TABLE ai_usage (
    usage_date         DATE          NOT NULL,
    user_id            UUID REFERENCES users (id) ON DELETE CASCADE,
    provider           TEXT          NOT NULL,
    model              TEXT          NOT NULL,
    task               TEXT          NOT NULL,
    request_count      INTEGER       NOT NULL DEFAULT 0,
    failed_count       INTEGER       NOT NULL DEFAULT 0,
    input_tokens       BIGINT        NOT NULL DEFAULT 0,
    output_tokens      BIGINT        NOT NULL DEFAULT 0,
    audio_seconds      NUMERIC(12,2) NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(14,6) NOT NULL DEFAULT 0,
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ai_usage_key UNIQUE NULLS NOT DISTINCT (usage_date, user_id, provider, model, task)
);

CREATE INDEX ai_usage_date_idx ON ai_usage (usage_date DESC);

-- Machine-readable AI evaluation results. Every row records exactly which model, prompt,
-- rubric and analysis pipeline produced it, so results can be compared across versions
-- and re-run for regression testing.
CREATE TABLE ai_analyses (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- What was analysed: speaking_session, writing_submission, ...
    subject_type     TEXT         NOT NULL,
    subject_id       UUID         NOT NULL,
    analysis_type    TEXT         NOT NULL,   -- speaking_evaluation, ielts_scoring, ...
    status           TEXT         NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    result           JSONB,
    overall_score    NUMERIC(5,2),
    schema_version   TEXT         NOT NULL,
    model_version    TEXT         NOT NULL DEFAULT '',
    prompt_version   TEXT         NOT NULL DEFAULT '',
    rubric_version   TEXT         NOT NULL DEFAULT '',
    analysis_version TEXT         NOT NULL DEFAULT '',
    provider         TEXT         NOT NULL DEFAULT '',
    ai_request_id    UUID REFERENCES ai_requests (id) ON DELETE SET NULL,
    error_code       TEXT         NOT NULL DEFAULT '',
    completed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX ai_analyses_subject_idx ON ai_analyses (subject_type, subject_id);
CREATE INDEX ai_analyses_user_idx ON ai_analyses (user_id, created_at DESC);
CREATE INDEX ai_analyses_version_idx ON ai_analyses (analysis_type, analysis_version);

CREATE TRIGGER ai_analyses_set_updated_at BEFORE UPDATE ON ai_analyses
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
