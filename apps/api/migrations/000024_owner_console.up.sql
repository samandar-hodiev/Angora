-- Owner Console preferences.
--
-- The platform already had a settings table (site_settings, 000017), and it was quietly
-- doing two jobs: it holds the Learner App's configuration — default language, daily goal,
-- placement test, wallpapers, maintenance — but it was reached through a console page
-- called simply "Settings", which made it look like the console's own configuration. It is
-- not. Changing the learner default theme should never change the operator's own console,
-- and vice versa.
--
-- So the two are separated by table, not by a naming convention inside one JSONB blob:
--
--   site_settings      → the Learner App. Platform-wide, one row, owner-edited.
--   owner_preferences  → the Owner Console. Per operator, because a console theme, a
--                        console language and a console wallpaper belong to the person
--                        looking at the screen, not to the platform.
--
-- Nothing here can affect a learner, and nothing in site_settings can affect the console.

CREATE TABLE owner_preferences (
    user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,

    -- The console's own language. Separate from profiles.native_language, which is the
    -- language a learner is taught in.
    locale      TEXT NOT NULL DEFAULT 'uz' CHECK (locale IN ('uz', 'ru', 'en')),
    -- The console is dark today and stays dark by default; 'system' and 'light' are opt-in.
    theme       TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('system', 'dark', 'light')),
    timezone    TEXT NOT NULL DEFAULT 'Asia/Tashkent',
    date_format TEXT NOT NULL DEFAULT 'dmy' CHECK (date_format IN ('dmy', 'mdy', 'iso')),
    time_format TEXT NOT NULL DEFAULT '24h' CHECK (time_format IN ('12h', '24h')),

    -- How the sidebar opens. 'remember' keeps whatever the operator last left it as, which
    -- is the behaviour that already existed.
    sidebar_mode TEXT NOT NULL DEFAULT 'remember'
                 CHECK (sidebar_mode IN ('expanded', 'collapsed', 'remember')),

    -- The console background. The bytes live in object storage exactly like a learner's
    -- wallpaper; this table keeps the key and the URL and nothing else. Overlay is how much
    -- the image is dimmed, because a console is tables and numbers before it is a picture.
    wallpaper_storage_key TEXT,
    wallpaper_url         TEXT,
    wallpaper_enabled     BOOLEAN  NOT NULL DEFAULT false,
    wallpaper_overlay     SMALLINT NOT NULL DEFAULT 70 CHECK (wallpaper_overlay BETWEEN 0 AND 100),

    -- Which operational events this operator wants to hear about, and their accessibility
    -- choices. JSONB because both are open sets that will grow.
    notifications JSONB NOT NULL DEFAULT '{}',
    accessibility JSONB NOT NULL DEFAULT '{}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER owner_preferences_set_updated_at BEFORE UPDATE ON owner_preferences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
