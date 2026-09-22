DELETE FROM email_verification_codes WHERE purpose = 'console_signin';

ALTER TABLE email_verification_codes DROP CONSTRAINT email_verification_codes_purpose_check;

ALTER TABLE email_verification_codes
    ADD CONSTRAINT email_verification_codes_purpose_check
    CHECK (purpose IN ('signup', 'account_delete'));

UPDATE users SET role = 'ADMIN' WHERE role = 'OWNER';

ALTER TABLE users DROP COLUMN IF EXISTS created_by;
ALTER TABLE users DROP COLUMN IF EXISTS must_change_password;

DELETE FROM roles WHERE name = 'OWNER';
