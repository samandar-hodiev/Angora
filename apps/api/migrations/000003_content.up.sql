-- Learning content. Nothing here is hardcoded in clients: web and mobile fetch it, and a
-- future admin panel / CMS writes it.

CREATE TABLE topics (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT        NOT NULL UNIQUE,
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER topics_set_updated_at BEFORE UPDATE ON topics
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE lessons (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug         TEXT        NOT NULL UNIQUE,
    title        TEXT        NOT NULL,
    description  TEXT        NOT NULL DEFAULT '',
    skill_id     UUID        NOT NULL REFERENCES skills (id),
    level_id     UUID        NOT NULL REFERENCES levels (id),
    topic_id     UUID REFERENCES topics (id) ON DELETE SET NULL,
    status       TEXT        NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'review', 'published', 'archived')),
    sort_order   INTEGER     NOT NULL DEFAULT 0,
    metadata     JSONB       NOT NULL DEFAULT '{}',
    published_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX lessons_skill_level_idx ON lessons (skill_id, level_id, status);

CREATE TRIGGER lessons_set_updated_at BEFORE UPDATE ON lessons
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One table for every practice item: speaking topics, writing tasks, reading passages,
-- listening exercises, grammar exercises and exam (IELTS) questions. The shared metadata
-- is relational and indexed; the type-specific payload lives in `body`, validated by the
-- owning module against `schema_version`. A new content type needs no new table.
--
-- Known types: speaking_topic, writing_task, reading_passage, listening_exercise,
-- grammar_exercise, exam_question, mock_exam.
CREATE TABLE content_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type           TEXT        NOT NULL,
    title          TEXT        NOT NULL,
    skill_id       UUID REFERENCES skills (id),
    level_id       UUID REFERENCES levels (id),
    topic_id       UUID REFERENCES topics (id) ON DELETE SET NULL,
    lesson_id      UUID REFERENCES lessons (id) ON DELETE SET NULL,
    -- NULL for general English content; e.g. 'ielts' for exam-specific content.
    exam           TEXT,
    difficulty     SMALLINT    NOT NULL DEFAULT 5 CHECK (difficulty BETWEEN 1 AND 10),
    tags           TEXT[]      NOT NULL DEFAULT '{}',
    status         TEXT        NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'review', 'published', 'archived')),
    body           JSONB       NOT NULL DEFAULT '{}',
    schema_version INTEGER     NOT NULL DEFAULT 1,
    created_by     UUID REFERENCES users (id) ON DELETE SET NULL,
    published_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX content_items_type_status_idx ON content_items (type, status);
CREATE INDEX content_items_skill_level_idx ON content_items (skill_id, level_id) WHERE status = 'published';
CREATE INDEX content_items_topic_idx ON content_items (topic_id);
CREATE INDEX content_items_exam_idx ON content_items (exam) WHERE exam IS NOT NULL;
CREATE INDEX content_items_tags_idx ON content_items USING GIN (tags);

CREATE TRIGGER content_items_set_updated_at BEFORE UPDATE ON content_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE grammar_topics (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT        NOT NULL UNIQUE,
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    level_id    UUID REFERENCES levels (id),
    sort_order  INTEGER     NOT NULL DEFAULT 0,
    status      TEXT        NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'review', 'published', 'archived')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER grammar_topics_set_updated_at BEFORE UPDATE ON grammar_topics
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE vocabulary (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    term              TEXT        NOT NULL,
    part_of_speech    TEXT        NOT NULL DEFAULT '',
    definition        TEXT        NOT NULL DEFAULT '',
    examples          JSONB       NOT NULL DEFAULT '[]',
    pronunciation_ipa TEXT        NOT NULL DEFAULT '',
    level_id          UUID REFERENCES levels (id),
    topic_id          UUID REFERENCES topics (id) ON DELETE SET NULL,
    frequency_rank    INTEGER,
    tags              TEXT[]      NOT NULL DEFAULT '{}',
    status            TEXT        NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'review', 'published', 'archived')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX vocabulary_term_pos_key ON vocabulary (lower(term), part_of_speech);
CREATE INDEX vocabulary_level_idx ON vocabulary (level_id);

CREATE TRIGGER vocabulary_set_updated_at BEFORE UPDATE ON vocabulary
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
