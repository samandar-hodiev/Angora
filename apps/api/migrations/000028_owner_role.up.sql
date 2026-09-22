-- The owner: one account, above the administrators.
--
-- Until now the most powerful role was ADMIN, and every operator who had it could grant it
-- to somebody else. That is fine while the only operator is the person who built the thing,
-- and wrong the moment there are two: whoever owns the business should be the only one who
-- can decide who else gets in.
--
-- So OWNER is ADMIN plus one thing — the right to add and remove staff — and the console
-- refuses to let an ADMIN reach the staff page at all. The owner is designated by email in
-- configuration (OWNER_EMAIL), not by a row somebody can edit their way into.

INSERT INTO roles (name, description) VALUES ('OWNER', 'Platform owner')
ON CONFLICT (name) DO NOTHING;

-- Staff accounts are created by the owner with a password the owner hands over out of band.
-- The first thing the account should do is replace it, and until it has, the API says so.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

-- Who created a staff account, so the staff list can say where each one came from. SET NULL
-- rather than CASCADE: removing an owner must never remove the administrators they added.
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users (id) ON DELETE SET NULL;

-- Signing in to the console is a third kind of emailed code.
ALTER TABLE email_verification_codes DROP CONSTRAINT email_verification_codes_purpose_check;

ALTER TABLE email_verification_codes
    ADD CONSTRAINT email_verification_codes_purpose_check
    CHECK (purpose IN ('signup', 'account_delete', 'console_signin'));
