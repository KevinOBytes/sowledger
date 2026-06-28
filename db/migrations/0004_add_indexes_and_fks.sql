CREATE INDEX IF NOT EXISTS workspaces_stripe_sub_idx ON workspaces (stripe_subscription_id);
CREATE INDEX IF NOT EXISTS projects_workspace_idx ON projects (workspace_id);
CREATE INDEX IF NOT EXISTS projects_client_idx ON projects (client_id);
CREATE INDEX IF NOT EXISTS goals_workspace_idx ON goals (workspace_id);
CREATE INDEX IF NOT EXISTS goals_project_idx ON goals (project_id);
CREATE INDEX IF NOT EXISTS time_entries_workspace_idx ON time_entries (workspace_id);
CREATE INDEX IF NOT EXISTS time_entries_user_idx ON time_entries (user_id);
CREATE INDEX IF NOT EXISTS time_entries_project_idx ON time_entries (project_id);

ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_project_id_projects_id_fk;
ALTER TABLE goals ADD CONSTRAINT goals_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_project_id_projects_id_fk;
ALTER TABLE time_entries ADD CONSTRAINT time_entries_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
