ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name varchar(255);

ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone varchar(100);
UPDATE users SET timezone = 'UTC' WHERE timezone IS NULL;
ALTER TABLE users ALTER COLUMN timezone SET DEFAULT 'UTC';
ALTER TABLE users ALTER COLUMN timezone SET NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_tags jsonb DEFAULT '[]'::jsonb;
UPDATE users SET preferred_tags = '[]'::jsonb WHERE preferred_tags IS NULL;
ALTER TABLE users ALTER COLUMN preferred_tags SET DEFAULT '[]'::jsonb;
ALTER TABLE users ALTER COLUMN preferred_tags SET NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_preferences jsonb DEFAULT '{}'::jsonb;
UPDATE users SET calendar_preferences = '{}'::jsonb WHERE calendar_preferences IS NULL;
ALTER TABLE users ALTER COLUMN calendar_preferences SET DEFAULT '{}'::jsonb;
ALTER TABLE users ALTER COLUMN calendar_preferences SET NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now();
