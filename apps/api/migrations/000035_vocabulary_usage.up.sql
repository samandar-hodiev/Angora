-- Vocabulary a learner can use, not only look up.
--
-- A word with a definition and a translation tells the learner what it means, not how to use
-- it: which words it goes with, whether it is formal, what an Uzbek or Russian speaker gets
-- wrong with it, and how it differs from the word next to it — "job" and "occupation" both
-- translate as "kasb". These columns hold that, written once per word and shared by every
-- learner. enriched_at is when it was written; a word without it is filled in the first time
-- a learner opens it.
ALTER TABLE vocabulary
    ADD COLUMN usage_note     TEXT        NOT NULL DEFAULT '',
    ADD COLUMN register       TEXT        NOT NULL DEFAULT '',
    ADD COLUMN collocations   TEXT[]      NOT NULL DEFAULT '{}',
    ADD COLUMN synonyms       TEXT[]      NOT NULL DEFAULT '{}',
    ADD COLUMN antonyms       TEXT[]      NOT NULL DEFAULT '{}',
    ADD COLUMN word_family    TEXT[]      NOT NULL DEFAULT '{}',
    ADD COLUMN common_mistake TEXT        NOT NULL DEFAULT '',
    ADD COLUMN enriched_at    TIMESTAMPTZ;

-- Topic browsing filters on tags.
CREATE INDEX vocabulary_tags_idx ON vocabulary USING gin (tags);

-- "What is the difference between job and occupation?" asked once, answered for everyone:
-- the same words at the same level are one generation, read back for free.
CREATE TABLE vocabulary_comparisons (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The words, lower case, sorted and joined with "|": job|occupation.
    terms_key      TEXT        NOT NULL,
    level_code     TEXT        NOT NULL,
    prompt_version TEXT        NOT NULL,
    body           JSONB       NOT NULL,
    model          TEXT        NOT NULL DEFAULT '',
    ai_request_id  UUID REFERENCES ai_requests (id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (terms_key, level_code, prompt_version)
);

INSERT INTO entitlements (key, kind, description) VALUES
    ('vocabulary.ai_compare', 'limit', 'Word comparisons written by the AI')
ON CONFLICT (key) DO NOTHING;

-- A comparison already asked by anyone is free to read; the limit counts new ones only.
INSERT INTO plan_entitlements (plan_id, entitlement_key, limit_value, limit_period)
SELECT p.id, v.key, v.limit_value, v.limit_period
FROM (VALUES
    ('free',      'vocabulary.ai_compare', 20,   'month'),
    ('pro',       'vocabulary.ai_compare', 300,  'month'),
    ('ielts_pro', 'vocabulary.ai_compare', NULL, 'month')
) AS v(plan_code, key, limit_value, limit_period)
JOIN subscription_plans p ON p.code = v.plan_code
ON CONFLICT (plan_id, entitlement_key) DO NOTHING;
