-- IELTS mock exams.
--
-- An exam is a composition, not a new content type: its sections point at the reading sets,
-- listening clips and writing/speaking tasks that already exist, so authoring an exam is
-- arranging published content rather than duplicating it.
--
-- Placement is deliberately untouched. It has its own engine, its own config table and its
-- own scoring, and it drives onboarding; an exam that borrowed that machinery would couple
-- the two and put the onboarding path at risk every time an exam changed.
CREATE TABLE ielts_exams (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT        NOT NULL UNIQUE,
    title       TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    -- [{"skill": "listening", "content_item_id": "...", "time_limit_seconds": 1800}, ...]
    sections    JSONB       NOT NULL DEFAULT '[]',
    status      TEXT        NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'review', 'published', 'archived')),
    created_by  UUID REFERENCES users (id) ON DELETE SET NULL,
    published_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ielts_exams_status_idx ON ielts_exams (status);

CREATE TRIGGER ielts_exams_set_updated_at BEFORE UPDATE ON ielts_exams
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One learner's sitting. Section results accumulate as they go; the bands are computed when
-- the exam is submitted and then never recomputed, so a result stays reproducible even if
-- the exam definition or the band table changes later.
CREATE TABLE ielts_attempts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    exam_id      UUID        NOT NULL REFERENCES ielts_exams (id),
    status       TEXT        NOT NULL DEFAULT 'in_progress'
                 CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    -- {"listening": {"correct": 28, "total": 40, "band": 6.5, "submitted_at": "..."}, ...}
    sections     JSONB       NOT NULL DEFAULT '{}',
    overall_band NUMERIC(2,1) CHECK (overall_band IS NULL OR overall_band BETWEEN 0 AND 9),
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ielts_attempts_user_idx ON ielts_attempts (user_id, created_at DESC);
-- One open sitting per learner: a mock exam is a single continuous effort.
CREATE UNIQUE INDEX ielts_attempts_one_open ON ielts_attempts (user_id) WHERE status = 'in_progress';

CREATE TRIGGER ielts_attempts_set_updated_at BEFORE UPDATE ON ielts_attempts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
