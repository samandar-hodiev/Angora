-- Email verification codes, account profile setup and the account's primary auth method.
--
-- Authentication (users, credentials, identities, verification codes) stays separate from
-- the learner's profile (profiles). A new account is created only after its email is
-- verified; the profile is completed afterwards in a dedicated setup step.

ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'email'
    CHECK (auth_provider IN ('email', 'google', 'apple', 'phone'));

UPDATE users u SET auth_provider = 'google'
WHERE u.password_hash IS NULL
  AND EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id AND i.provider = 'google');

-- One open (unconsumed) code per email and purpose. Only a hash of the code is stored.
CREATE TABLE email_verification_codes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               TEXT        NOT NULL,
    purpose             TEXT        NOT NULL CHECK (purpose IN ('signup')),
    code_hash           TEXT        NOT NULL,
    attempts            SMALLINT    NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    -- Codes sent in the current window (created_at + 1 hour), for resend limits.
    send_count          SMALLINT    NOT NULL DEFAULT 1 CHECK (send_count >= 1),
    expires_at          TIMESTAMPTZ NOT NULL,
    resend_available_at TIMESTAMPTZ NOT NULL,
    consumed_at         TIMESTAMPTZ,
    ip                  TEXT        NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX email_verification_codes_open_key
    ON email_verification_codes (lower(email), purpose) WHERE consumed_at IS NULL;

CREATE TRIGGER email_verification_codes_set_updated_at BEFORE UPDATE ON email_verification_codes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE profiles
    ADD COLUMN first_name           TEXT NOT NULL DEFAULT '',
    ADD COLUMN last_name            TEXT NOT NULL DEFAULT '',
    ADD COLUMN phone_country        TEXT CHECK (phone_country ~ '^[A-Z]{2}$'),
    -- E.164, e.g. +998901234567
    ADD COLUMN phone_number         TEXT CHECK (phone_number ~ '^\+[1-9][0-9]{6,14}$'),
    ADD COLUMN avatar_storage_key   TEXT,
    ADD COLUMN profile_completed_at TIMESTAMPTZ;

-- Accounts created by the previous registration form already gave their name.
UPDATE profiles
SET first_name = split_part(btrim(display_name), ' ', 1),
    last_name  = btrim(substr(btrim(display_name), length(split_part(btrim(display_name), ' ', 1)) + 1)),
    profile_completed_at = created_at
WHERE btrim(display_name) <> '';
