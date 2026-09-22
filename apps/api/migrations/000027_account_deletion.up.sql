-- Deleting your own account.
--
-- The confirmation is an emailed code, for the same reason sign-up uses one: it proves the
-- person asking still holds the mailbox, which a session cookie on a borrowed laptop does
-- not. So the code table has to admit a second purpose.
--
-- The deletion itself needs no new table. Every foreign key into users is already either
-- ON DELETE CASCADE (the learner's own rows: progress, attempts, vocabulary, sessions) or
-- ON DELETE SET NULL (rows that outlive them: audit entries, content they authored), so
-- one DELETE removes the account and leaves the record of it having existed.

ALTER TABLE email_verification_codes DROP CONSTRAINT email_verification_codes_purpose_check;

ALTER TABLE email_verification_codes
    ADD CONSTRAINT email_verification_codes_purpose_check
    CHECK (purpose IN ('signup', 'account_delete'));
