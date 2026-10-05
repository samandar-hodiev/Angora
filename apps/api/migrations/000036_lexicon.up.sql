-- Lexicon: words, phrases and collocations, each at one checked level.
--
-- A word used to be explained six times, once per CEFR level: "eat" written for A1 and again,
-- word for word, for C2. A learner meets the word at one level; what differs between levels is
-- not the explanation of one sense but the senses themselves — "run" is A1 for moving fast and
-- B2 for running a company. So an entry now has one explanation at its own level, and its other
-- senses each with their own level.
--
-- kind     word | phrase (phrasal verb, idiom, fixed phrase) | collocation (make a decision).
-- senses   [{"definition", "level", "example"}]: meanings beyond the main one.
-- level_source where the level came from: list (a CEFR word list), ai_checked (written by the
--          model and confirmed by a second, independent check), ai (the two disagreed or no
--          check ran: unverified), curated (an owner set it).
ALTER TABLE vocabulary
    ADD COLUMN kind         TEXT  NOT NULL DEFAULT 'word' CHECK (kind IN ('word', 'phrase', 'collocation')),
    ADD COLUMN senses       JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN level_source TEXT  NOT NULL DEFAULT 'ai' CHECK (level_source IN ('list', 'ai_checked', 'ai', 'curated'));

CREATE INDEX vocabulary_kind_status_idx ON vocabulary (kind, status, level_id);

-- Multi-word entries are phrases or collocations by their part of speech.
UPDATE vocabulary SET kind = 'phrase' WHERE part_of_speech IN ('phrasal verb', 'idiom', 'phrase');

-- One explanation per entry: keep the one at the word's own level and drop the rest.
UPDATE vocabulary v SET level_content = jsonb_build_object(l.code, v.level_content -> l.code)
FROM levels l
WHERE l.id = v.level_id AND v.level_content ? l.code AND (SELECT count(*) FROM jsonb_object_keys(v.level_content)) > 1;

-- A CEFR word list: the reference a level is checked against (see cmd/cefr-import).
CREATE TABLE cefr_wordlist (
    headword   TEXT NOT NULL,
    pos        TEXT NOT NULL DEFAULT '',
    level_code TEXT NOT NULL CHECK (level_code IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
    source     TEXT NOT NULL,
    PRIMARY KEY (headword, pos)
);

-- "big → large → huge → enormous → immense": one meaning, a word for each level. Asked once,
-- shared by everyone who asks for the same word.
CREATE TABLE vocabulary_ladders (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    term_key       TEXT        NOT NULL,
    prompt_version TEXT        NOT NULL,
    body           JSONB       NOT NULL,
    model          TEXT        NOT NULL DEFAULT '',
    ai_request_id  UUID REFERENCES ai_requests (id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (term_key, prompt_version)
);

INSERT INTO entitlements (key, kind, description) VALUES
    ('vocabulary.ai_ladder', 'limit', 'Level ladders written by the AI')
ON CONFLICT (key) DO NOTHING;

INSERT INTO plan_entitlements (plan_id, entitlement_key, limit_value, limit_period)
SELECT p.id, v.key, v.limit_value, v.limit_period
FROM (VALUES
    ('free',      'vocabulary.ai_ladder', 20,   'month'),
    ('pro',       'vocabulary.ai_ladder', 300,  'month'),
    ('ielts_pro', 'vocabulary.ai_ladder', NULL, 'month')
) AS v(plan_code, key, limit_value, limit_period)
JOIN subscription_plans p ON p.code = v.plan_code
ON CONFLICT (plan_id, entitlement_key) DO NOTHING;
