-- External sign-in identities linked to an account.
--
-- One account can have several identities: google today, apple and phone (SMS OTP) later.
-- provider_subject is the provider's stable user id (Google "sub"), never the email,
-- because emails can change.

CREATE TABLE user_identities (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    provider         TEXT        NOT NULL,   -- google | apple | phone
    provider_subject TEXT        NOT NULL,
    email            TEXT        NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_subject)
);

CREATE INDEX user_identities_user_idx ON user_identities (user_id);
