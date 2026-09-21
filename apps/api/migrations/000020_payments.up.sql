-- Payments: Click (my.click.uz) and whatever comes after it.
--
-- Two rules shape this schema.
--
-- 1. We never see card data. Click collects the card on its own page; the callbacks it
--    sends us carry transaction identifiers and an amount, nothing else. There is
--    therefore no column here that could hold a PAN, and there must never be one.
-- 2. The money record and the access record are separate. payment_transactions is what
--    the learner paid; subscriptions is what they may use. A transaction points at the
--    subscription it opened so support can answer "I paid, why is it locked?" without
--    guessing.

-- Click bills in so'm and nothing else. A plan priced only in USD cannot be bought with
-- Click, and the checkout endpoint says so rather than inventing an exchange rate.
ALTER TABLE subscription_plans ADD COLUMN price_uzs BIGINT CHECK (price_uzs IS NULL OR price_uzs > 0);

COMMENT ON COLUMN subscription_plans.price_uzs IS 'Price in so''m (not tiyin). NULL means the plan is not sold through a so''m provider.';

-- merchant_prepare_id in the Click protocol is an integer, and it has to stay stable
-- between the prepare and the complete call. A sequence gives one per transaction.
CREATE SEQUENCE payment_prepare_id_seq AS BIGINT START 1000;

CREATE TABLE payment_transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    plan_id             UUID        NOT NULL REFERENCES subscription_plans (id),
    provider            TEXT        NOT NULL DEFAULT 'click',
    status              TEXT        NOT NULL DEFAULT 'created'
                        CHECK (status IN ('created', 'prepared', 'paid', 'canceled', 'failed')),
    -- Minor units of `currency`: tiyin for UZS, cents for USD. Stored as the provider
    -- was asked to charge, so a later price change never rewrites history.
    amount_minor        BIGINT      NOT NULL CHECK (amount_minor > 0),
    currency            CHAR(3)     NOT NULL,
    -- Provider identifiers. click_trans_id is unique per provider and is what makes a
    -- repeated callback idempotent.
    provider_trans_id   TEXT,
    provider_payment_id TEXT,
    prepare_id          BIGINT,
    subscription_id     UUID        REFERENCES subscriptions (id) ON DELETE SET NULL,
    error_code          INTEGER,
    error_note          TEXT        NOT NULL DEFAULT '',
    prepared_at         TIMESTAMPTZ,
    paid_at             TIMESTAMPTZ,
    canceled_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX payment_transactions_provider_trans
    ON payment_transactions (provider, provider_trans_id) WHERE provider_trans_id IS NOT NULL;
CREATE INDEX payment_transactions_user_idx ON payment_transactions (user_id, created_at DESC);
CREATE INDEX payment_transactions_status_idx ON payment_transactions (status, created_at DESC);

CREATE TRIGGER payment_transactions_set_updated_at BEFORE UPDATE ON payment_transactions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every callback, verified or not. A rejected signature is the interesting one: it is
-- either a misconfigured secret or somebody probing the endpoint, and both are worth
-- seeing. Kept small on purpose: Click's payloads are a dozen scalar fields.
CREATE TABLE payment_callbacks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider        TEXT        NOT NULL,
    transaction_id  UUID        REFERENCES payment_transactions (id) ON DELETE SET NULL,
    action          TEXT        NOT NULL,
    signature_valid BOOLEAN     NOT NULL,
    payload         JSONB       NOT NULL DEFAULT '{}',
    response        JSONB       NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX payment_callbacks_created_idx ON payment_callbacks (created_at DESC);
CREATE INDEX payment_callbacks_transaction_idx ON payment_callbacks (transaction_id, created_at DESC);

-- Starting so'm prices for the paid plans. They are a starting point, not a decision:
-- the owner console edits them, and nothing in code reads these numbers.
UPDATE subscription_plans SET price_uzs = 49000 WHERE code = 'pro';
UPDATE subscription_plans SET price_uzs = 79000 WHERE code = 'ielts_pro';
