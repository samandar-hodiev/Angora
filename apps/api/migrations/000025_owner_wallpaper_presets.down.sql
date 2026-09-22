ALTER TABLE owner_preferences ADD COLUMN wallpaper_enabled BOOLEAN NOT NULL DEFAULT false;
UPDATE owner_preferences SET wallpaper_enabled = true WHERE wallpaper_preset <> 'none';
ALTER TABLE owner_preferences DROP COLUMN wallpaper_preset;
