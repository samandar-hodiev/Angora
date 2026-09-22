DELETE FROM email_verification_codes WHERE purpose = 'account_delete';

ALTER TABLE email_verification_codes DROP CONSTRAINT email_verification_codes_purpose_check;

ALTER TABLE email_verification_codes
    ADD CONSTRAINT email_verification_codes_purpose_check
    CHECK (purpose IN ('signup'));
