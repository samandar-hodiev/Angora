-- Built-in backgrounds for the Owner Console.
--
-- Uploading an image was the only option, which made the feature a chore: an operator who
-- simply wants a less flat console had to go and find a picture first. The learner app has
-- had eleven built-in backgrounds since 000013, defined as CSS gradients on the client, and
-- the console can use exactly the same set.
--
-- The selection replaces wallpaper_enabled. A boolean beside a nullable image key could
-- describe states that do not exist ("enabled, with nothing to show"), while one column
-- holding 'none', a preset id, or 'custom' can only ever describe one.

ALTER TABLE owner_preferences ADD COLUMN wallpaper_preset TEXT NOT NULL DEFAULT 'none';

-- Anyone who already uploaded one keeps it selected.
UPDATE owner_preferences
SET wallpaper_preset = 'custom'
WHERE wallpaper_enabled AND wallpaper_storage_key IS NOT NULL;

ALTER TABLE owner_preferences DROP COLUMN wallpaper_enabled;

COMMENT ON COLUMN owner_preferences.wallpaper_preset IS
    'none | a built-in preset id | custom. The preset ids themselves live in the web app, because they are CSS.';
