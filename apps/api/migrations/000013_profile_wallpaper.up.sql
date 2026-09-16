-- The learner's own background image for the app's main learning area.
--
-- Wallpapers follow the avatar pattern: the bytes live in object storage and the profile
-- keeps only an unguessable storage key plus the path clients load the image from. Which
-- background is in use (a built-in preset or the uploaded image) is a preference, so it
-- stays in profiles.preferences and needs no column of its own.

ALTER TABLE profiles
    ADD COLUMN wallpaper_storage_key TEXT,
    ADD COLUMN wallpaper_url         TEXT;
