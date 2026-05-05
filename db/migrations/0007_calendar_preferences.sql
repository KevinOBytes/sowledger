ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_preferences jsonb DEFAULT '{}'::jsonb NOT NULL;
