-- SOWLedger shares neon-violet-school with other applications, so every object
-- is explicitly namespaced instead of relying on a pooled connection's
-- search_path.
-- Keep runtime tables in tracked migrations so requests never need to create
-- product tables as part of authentication or page loading.

CREATE SCHEMA IF NOT EXISTS sowledger;

CREATE TABLE IF NOT EXISTS sowledger.clients (
  id varchar(255) PRIMARY KEY,
  workspace_id varchar(255) NOT NULL,
  name varchar(255) NOT NULL,
  email varchar(255),
  address text,
  currency_override varchar(10),
  status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sowledger.project_tasks (
  id varchar(255) PRIMARY KEY,
  workspace_id varchar(255) NOT NULL,
  project_id varchar(255) NOT NULL,
  parent_id varchar(255),
  title varchar(255) NOT NULL,
  description text,
  status varchar(20) NOT NULL DEFAULT 'todo',
  position real NOT NULL DEFAULT 0,
  due_date timestamp,
  assignee_id varchar(255),
  estimated_hours real,
  blocked_by_task_ids jsonb DEFAULT '[]'::jsonb,
  attachments jsonb DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sowledger.workspace_tags (
  id varchar(255) PRIMARY KEY,
  workspace_id varchar(255) NOT NULL,
  project_id varchar(255),
  name varchar(255) NOT NULL,
  color varchar(50) NOT NULL DEFAULT '#3b82f6',
  is_billable_default boolean NOT NULL DEFAULT false,
  status varchar(20) NOT NULL DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_clients_workspace_id ON sowledger.clients (workspace_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_workspace_id ON sowledger.project_tasks (workspace_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project_id ON sowledger.project_tasks (project_id);
CREATE INDEX IF NOT EXISTS idx_workspace_tags_workspace_id ON sowledger.workspace_tags (workspace_id);

ALTER TABLE sowledger.projects ADD COLUMN IF NOT EXISTS client_id varchar(255);
ALTER TABLE sowledger.projects ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE sowledger.projects ADD COLUMN IF NOT EXISTS color varchar(50) NOT NULL DEFAULT '#3b82f6';
ALTER TABLE sowledger.projects ADD COLUMN IF NOT EXISTS billing_model varchar(20) NOT NULL DEFAULT 'hourly';
ALTER TABLE sowledger.projects ADD COLUMN IF NOT EXISTS hourly_rate real;
ALTER TABLE sowledger.projects ADD COLUMN IF NOT EXISTS budget_type varchar(20) NOT NULL DEFAULT 'none';
ALTER TABLE sowledger.projects ADD COLUMN IF NOT EXISTS budget_amount real;
ALTER TABLE sowledger.projects ADD COLUMN IF NOT EXISTS budget_alert_threshold real NOT NULL DEFAULT 80;
ALTER TABLE sowledger.projects ADD COLUMN IF NOT EXISTS start_date timestamp;
ALTER TABLE sowledger.projects ADD COLUMN IF NOT EXISTS end_date timestamp;
ALTER TABLE sowledger.projects ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;
ALTER TABLE sowledger.projects ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'active';
ALTER TABLE sowledger.projects ADD COLUMN IF NOT EXISTS percent_complete real NOT NULL DEFAULT 0;
ALTER TABLE sowledger.projects ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now();

ALTER TABLE sowledger.time_entries ADD COLUMN IF NOT EXISTS scheduled_block_id varchar(255);

CREATE INDEX IF NOT EXISTS idx_time_entries_scheduled_block ON sowledger.time_entries (scheduled_block_id);
