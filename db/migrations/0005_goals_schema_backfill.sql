CREATE TABLE IF NOT EXISTS goals (
  id varchar(255) PRIMARY KEY,
  workspace_id varchar(255) NOT NULL,
  project_id varchar(255),
  assigned_user_id varchar(255),
  name varchar(255) NOT NULL,
  description text,
  recurrence varchar(20) NOT NULL DEFAULT 'none',
  target_hours real,
  target_amount real,
  target_type varchar(20) NOT NULL DEFAULT 'hours',
  due_date timestamp,
  completed boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE goals ADD COLUMN IF NOT EXISTS project_id varchar(255);
ALTER TABLE goals ADD COLUMN IF NOT EXISTS assigned_user_id varchar(255);
ALTER TABLE goals ADD COLUMN IF NOT EXISTS name varchar(255);
ALTER TABLE goals ADD COLUMN IF NOT EXISTS recurrence varchar(20) NOT NULL DEFAULT 'none';
ALTER TABLE goals ADD COLUMN IF NOT EXISTS target_hours real;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS target_amount real;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS target_type varchar(20) NOT NULL DEFAULT 'hours';
ALTER TABLE goals ADD COLUMN IF NOT EXISTS completed boolean NOT NULL DEFAULT false;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'goals'
      AND column_name = 'title'
  ) THEN
    EXECUTE 'UPDATE goals SET name = COALESCE(NULLIF(name, ''''), title) WHERE title IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'goals'
      AND column_name = 'status'
  ) THEN
    EXECUTE 'UPDATE goals SET completed = CASE WHEN lower(status) = ''completed'' THEN true ELSE completed END WHERE status IS NOT NULL';
  END IF;
END $$;

ALTER TABLE goals ALTER COLUMN name SET DEFAULT 'Untitled goal';
UPDATE goals SET name = 'Untitled goal' WHERE name IS NULL OR btrim(name) = '';
ALTER TABLE goals ALTER COLUMN name SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_goals_workspace_id ON goals (workspace_id);
