-- Accounts holding a removed role fall back to the learner role rather than being left
-- pointing at a role that no longer exists.
UPDATE users SET role = 'USER' WHERE role IN ('ANALYST', 'SUPPORT', 'CONTENT_MANAGER');
DELETE FROM roles WHERE name IN ('ANALYST', 'SUPPORT', 'CONTENT_MANAGER');
