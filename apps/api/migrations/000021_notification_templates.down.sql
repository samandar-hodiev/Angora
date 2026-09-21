DROP INDEX IF EXISTS notifications_template_idx;
ALTER TABLE notifications DROP COLUMN IF EXISTS template_code;
DROP TABLE IF EXISTS notification_preferences;
DROP TABLE IF EXISTS notification_templates;
