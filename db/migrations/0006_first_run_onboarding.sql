CREATE TABLE IF NOT EXISTS onboarding_progress (
  id varchar(255) PRIMARY KEY,
  workspace_id varchar(255) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id varchar(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  completed_steps jsonb DEFAULT '[]'::jsonb NOT NULL,
  skipped_at timestamp,
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_progress_workspace_user
  ON onboarding_progress (workspace_id, user_id);
