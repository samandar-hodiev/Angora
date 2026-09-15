ALTER TABLE profiles
    DROP COLUMN IF EXISTS profile_completed_at,
    DROP COLUMN IF EXISTS avatar_storage_key,
    DROP COLUMN IF EXISTS phone_number,
    DROP COLUMN IF EXISTS phone_country,
    DROP COLUMN IF EXISTS last_name,
    DROP COLUMN IF EXISTS first_name;
DROP TABLE IF EXISTS email_verification_codes;
ALTER TABLE users DROP COLUMN IF EXISTS auth_provider;
