-- Site settings and the wallpaper library.
--
-- Two things the owner console could describe but not change, because there was nowhere to
-- put them. Settings are a single row of grouped JSON rather than a column per setting: the
-- groups change as the product does, and a migration per checkbox is not a good trade.
--
-- These are DEFAULTS. A learner who has chosen their own theme, goal or wallpaper keeps it;
-- these values are what a new account starts from, and what the app falls back to.
CREATE TABLE site_settings (
    id         BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    general    JSONB       NOT NULL DEFAULT '{}',
    learner    JSONB       NOT NULL DEFAULT '{}',
    features   JSONB       NOT NULL DEFAULT '{}',
    maintenance JSONB      NOT NULL DEFAULT '{}',
    updated_by UUID REFERENCES users (id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER site_settings_set_updated_at BEFORE UPDATE ON site_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO site_settings (id, general, learner, features, maintenance) VALUES (true,
    '{"site_name": "Engora",
      "site_description": "Your AI English coach — practice, feedback and a plan that adapts to you.",
      "support_email": "support@engora.com",
      "timezone": "Asia/Tashkent"}',
    '{"interface_language": "en", "explanation_language": "uz", "theme": "dark",
      "landing_page": "dashboard", "daily_goal_minutes": 15, "placement_test": true}',
    '{"ai_coach": true, "placement_test": true, "leaderboard": false, "public_registration": true,
      "realtime_speaking_coach": false}',
    '{"enabled": false, "message": "Engora is being updated. We will be back shortly.", "allow_owner_access": true}');

-- The wallpapers a learner may choose from. The CSS lives in the client (the learner app has
-- always owned its own presets); this table decides which of them are offered and in what
-- order, so turning one off is a setting rather than a release.
CREATE TABLE wallpapers (
    id         TEXT PRIMARY KEY,
    name       TEXT        NOT NULL,
    enabled    BOOLEAN     NOT NULL DEFAULT true,
    sort_order INTEGER     NOT NULL DEFAULT 0,
    animated   BOOLEAN     NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER wallpapers_set_updated_at BEFORE UPDATE ON wallpapers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO wallpapers (id, name, sort_order, animated) VALUES
    ('aurora',      'Aurora',      1,  false),
    ('dusk',        'Dusk',        2,  false),
    ('sunrise',     'Sunrise',     3,  false),
    ('ocean',       'Ocean',       4,  false),
    ('mist',        'Mist',        5,  false),
    ('aurora-live', 'Aurora live', 6,  true),
    ('blossom',     'Blossom',     7,  false),
    ('ember',       'Ember',       8,  false),
    ('lavender',    'Lavender',    9,  false),
    ('sand',        'Sand',        10, false),
    ('prism',       'Prism',       11, false)
ON CONFLICT (id) DO NOTHING;
