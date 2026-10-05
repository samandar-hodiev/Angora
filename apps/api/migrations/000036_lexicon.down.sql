DELETE FROM plan_entitlements WHERE entitlement_key = 'vocabulary.ai_ladder';
DELETE FROM entitlements WHERE key = 'vocabulary.ai_ladder';
DROP TABLE IF EXISTS vocabulary_ladders;
DROP TABLE IF EXISTS cefr_wordlist;
DROP INDEX IF EXISTS vocabulary_kind_status_idx;
ALTER TABLE vocabulary
    DROP COLUMN IF EXISTS kind,
    DROP COLUMN IF EXISTS senses,
    DROP COLUMN IF EXISTS level_source;
