-- Operator roles.
--
-- The platform shipped with USER and ADMIN, which meant anyone who could edit a lesson could
-- also change prices and read every learner's record. These three roles split that up; the
-- permissions each one carries live in internal/authz (one table, one place), so adding a
-- role later is a row here plus an entry there — never a change to a handler.
INSERT INTO roles (name, description) VALUES
    ('ANALYST',         'Reads analytics, AI usage and the question bank. Changes nothing.'),
    ('SUPPORT',         'Looks up learners and can suspend an account. No billing or content access.'),
    ('CONTENT_MANAGER', 'Manages learner-facing content and the assessment question bank.')
ON CONFLICT (name) DO NOTHING;
