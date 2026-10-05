DELETE FROM plan_entitlements WHERE entitlement_key = 'vocabulary.ai_compare';
DELETE FROM entitlements WHERE key = 'vocabulary.ai_compare';
DROP TABLE IF EXISTS vocabulary_comparisons;
DROP INDEX IF EXISTS vocabulary_tags_idx;
ALTER TABLE vocabulary
    DROP COLUMN IF EXISTS usage_note,
    DROP COLUMN IF EXISTS register,
    DROP COLUMN IF EXISTS collocations,
    DROP COLUMN IF EXISTS synonyms,
    DROP COLUMN IF EXISTS antonyms,
    DROP COLUMN IF EXISTS word_family,
    DROP COLUMN IF EXISTS common_mistake,
    DROP COLUMN IF EXISTS enriched_at;
