DROP TRIGGER IF EXISTS irregular_verbs_set_updated_at ON irregular_verbs;
ALTER TABLE irregular_verbs DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS updated_at;
