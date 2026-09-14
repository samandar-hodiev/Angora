-- Subscriptions and entitlements.
--
-- Code never asks "is this user Pro?". It asks "does this user have entitlement X, and
-- how much of limit Y is left?". Plans are just bundles of entitlements, so a new plan
-- (annual, trial, promo, school licence) is data, not code.

CREATE TABLE subscription_plans (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code             TEXT        NOT NULL UNIQUE,
    name             TEXT        NOT NULL,
    description      TEXT        NOT NULL DEFAULT '',
    billing_interval TEXT        NOT NULL DEFAULT 'none'
                     CHECK (billing_interval IN ('none', 'month', 'year')),
    price_cents      INTEGER     NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
    currency         CHAR(3)     NOT NULL DEFAULT 'USD',
    trial_days       INTEGER     NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
    -- The plan every user without a live subscription falls back to.
    is_default       BOOLEAN     NOT NULL DEFAULT false,
    is_public        BOOLEAN     NOT NULL DEFAULT true,
    is_active        BOOLEAN     NOT NULL DEFAULT true,
    sort_order       INTEGER     NOT NULL DEFAULT 0,
    metadata         JSONB       NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX subscription_plans_single_default ON subscription_plans (is_default) WHERE is_default;

CREATE TRIGGER subscription_plans_set_updated_at BEFORE UPDATE ON subscription_plans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE entitlements (
    key         TEXT PRIMARY KEY,
    kind        TEXT        NOT NULL CHECK (kind IN ('feature', 'limit')),
    description TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A row grants an entitlement to a plan. For kind = 'limit', limit_value NULL means
-- unlimited. A missing row means the plan does not include the entitlement.
CREATE TABLE plan_entitlements (
    plan_id         UUID    NOT NULL REFERENCES subscription_plans (id) ON DELETE CASCADE,
    entitlement_key TEXT    NOT NULL REFERENCES entitlements (key) ON DELETE CASCADE,
    limit_value     INTEGER CHECK (limit_value IS NULL OR limit_value >= 0),
    limit_period    TEXT    CHECK (limit_period IN ('day', 'week', 'month', 'lifetime')),
    PRIMARY KEY (plan_id, entitlement_key)
);

CREATE TABLE subscriptions (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    plan_id                  UUID        NOT NULL REFERENCES subscription_plans (id),
    status                   TEXT        NOT NULL
                             CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired')),
    -- manual | promo | stripe | app_store | google_play ... (payments module owns these)
    provider                 TEXT        NOT NULL DEFAULT 'manual',
    provider_subscription_id TEXT,
    current_period_start     TIMESTAMPTZ NOT NULL DEFAULT now(),
    current_period_end       TIMESTAMPTZ,
    trial_ends_at            TIMESTAMPTZ,
    cancel_at_period_end     BOOLEAN     NOT NULL DEFAULT false,
    canceled_at              TIMESTAMPTZ,
    metadata                 JSONB       NOT NULL DEFAULT '{}',
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX subscriptions_user_idx ON subscriptions (user_id, created_at DESC);
CREATE UNIQUE INDEX subscriptions_one_live_per_user ON subscriptions (user_id)
    WHERE status IN ('trialing', 'active', 'past_due');
CREATE UNIQUE INDEX subscriptions_provider_ref_key ON subscriptions (provider, provider_subscription_id)
    WHERE provider_subscription_id IS NOT NULL;

CREATE TRIGGER subscriptions_set_updated_at BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Metered usage per limit per period window.
CREATE TABLE usage_counters (
    user_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    entitlement_key TEXT        NOT NULL REFERENCES entitlements (key) ON DELETE CASCADE,
    period_start    TIMESTAMPTZ NOT NULL,
    used            INTEGER     NOT NULL DEFAULT 0 CHECK (used >= 0),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, entitlement_key, period_start)
);

-- Seed catalogue. Prices and limits are starting values and are expected to change via
-- later migrations or the admin panel.
INSERT INTO entitlements (key, kind, description) VALUES
    ('speaking.practice',       'feature', 'Speaking practice sessions'),
    ('writing.practice',        'feature', 'Writing practice'),
    ('reading.practice',        'feature', 'Reading practice'),
    ('listening.practice',      'feature', 'Listening practice'),
    ('pronunciation.analysis',  'feature', 'Detailed pronunciation analysis'),
    ('ai_coach.chat',           'feature', 'Chat with the AI coach'),
    ('ielts.mode',              'feature', 'IELTS preparation mode'),
    ('speaking.evaluations',    'limit',   'AI speaking evaluations'),
    ('writing.evaluations',     'limit',   'AI writing evaluations'),
    ('ai_coach.messages',       'limit',   'AI coach messages'),
    ('ielts.mock_exams',        'limit',   'Full IELTS mock exams');

INSERT INTO subscription_plans (code, name, description, billing_interval, price_cents, trial_days, is_default, sort_order) VALUES
    ('free',      'Free',      'Start practising English with daily AI feedback.',       'none',  0,    0, true,  1),
    ('pro',       'Pro',       'Unlimited-feeling practice with the AI coach.',          'month', 999,  7, false, 2),
    ('ielts_pro', 'IELTS Pro', 'Everything in Pro plus IELTS mode and mock exams.',      'month', 1499, 7, false, 3);

INSERT INTO plan_entitlements (plan_id, entitlement_key, limit_value, limit_period)
SELECT p.id, e.key, e.limit_value, e.limit_period
FROM (VALUES
    ('free',      'speaking.practice',      NULL, NULL),
    ('free',      'writing.practice',       NULL, NULL),
    ('free',      'reading.practice',       NULL, NULL),
    ('free',      'listening.practice',     NULL, NULL),
    ('free',      'speaking.evaluations',   3,    'day'),
    ('free',      'writing.evaluations',    2,    'day'),

    ('pro',       'speaking.practice',      NULL, NULL),
    ('pro',       'writing.practice',       NULL, NULL),
    ('pro',       'reading.practice',       NULL, NULL),
    ('pro',       'listening.practice',     NULL, NULL),
    ('pro',       'pronunciation.analysis', NULL, NULL),
    ('pro',       'ai_coach.chat',          NULL, NULL),
    ('pro',       'speaking.evaluations',   50,   'day'),
    ('pro',       'writing.evaluations',    30,   'day'),
    ('pro',       'ai_coach.messages',      200,  'day'),

    ('ielts_pro', 'speaking.practice',      NULL, NULL),
    ('ielts_pro', 'writing.practice',       NULL, NULL),
    ('ielts_pro', 'reading.practice',       NULL, NULL),
    ('ielts_pro', 'listening.practice',     NULL, NULL),
    ('ielts_pro', 'pronunciation.analysis', NULL, NULL),
    ('ielts_pro', 'ai_coach.chat',          NULL, NULL),
    ('ielts_pro', 'ielts.mode',             NULL, NULL),
    ('ielts_pro', 'speaking.evaluations',   50,   'day'),
    ('ielts_pro', 'writing.evaluations',    30,   'day'),
    ('ielts_pro', 'ai_coach.messages',      200,  'day'),
    ('ielts_pro', 'ielts.mock_exams',       10,   'month')
) AS e (plan_code, key, limit_value, limit_period)
JOIN subscription_plans p ON p.code = e.plan_code;
