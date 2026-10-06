-- Irregular verbs the owner can manage: add by hand, have the AI suggest more, edit, publish.
--
-- The 163 verbs from 000037 were checked by hand, so they stay published and learners see
-- exactly what they saw. New ones arrive as drafts and reach learners when published.
ALTER TABLE irregular_verbs
    ADD COLUMN status     TEXT        NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
    ADD COLUMN source     TEXT        NOT NULL DEFAULT 'curated' CHECK (source IN ('curated', 'ai')),
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE irregular_verbs ALTER COLUMN status SET DEFAULT 'draft';

CREATE TRIGGER irregular_verbs_set_updated_at BEFORE UPDATE ON irregular_verbs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
