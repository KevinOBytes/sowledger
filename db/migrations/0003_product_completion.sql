ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS scheduled_block_id varchar(255);

CREATE TABLE IF NOT EXISTS scheduled_work_blocks (
  id varchar(255) PRIMARY KEY,
  workspace_id varchar(255) NOT NULL,
  user_id varchar(255) NOT NULL,
  project_id varchar(255),
  task_id varchar(255),
  action_id varchar(255),
  linked_time_entry_id varchar(255),
  title varchar(255) NOT NULL,
  notes text,
  tags jsonb DEFAULT '[]'::jsonb NOT NULL,
  starts_at timestamp NOT NULL,
  ends_at timestamp NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'planned',
  created_by_user_id varchar(255) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id varchar(255) PRIMARY KEY,
  workspace_id varchar(255) NOT NULL,
  name varchar(255) NOT NULL,
  key_hash varchar(255) NOT NULL UNIQUE,
  key_prefix varchar(32) NOT NULL,
  scopes jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_by_user_id varchar(255) NOT NULL,
  last_used_at timestamp,
  expires_at timestamp,
  revoked_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_key_requests (
  id varchar(255) PRIMARY KEY,
  workspace_id varchar(255) NOT NULL,
  api_key_id varchar(255) NOT NULL,
  method varchar(10) NOT NULL,
  path varchar(1024) NOT NULL,
  status real NOT NULL,
  ip_hash varchar(255),
  user_agent varchar(512),
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE workspace_tags ADD COLUMN IF NOT EXISTS project_id varchar(255);
ALTER TABLE workspace_tags ADD COLUMN IF NOT EXISTS color varchar(50) NOT NULL DEFAULT '#3b82f6';
ALTER TABLE workspace_tags ADD COLUMN IF NOT EXISTS is_billable_default boolean NOT NULL DEFAULT true;
ALTER TABLE workspace_tags ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_scheduled_blocks_workspace_user ON scheduled_work_blocks (workspace_id, user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_blocks_project ON scheduled_work_blocks (workspace_id, project_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_scheduled_block ON time_entries (scheduled_block_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_workspace_id ON api_keys (workspace_id);
CREATE INDEX IF NOT EXISTS idx_api_key_requests_key_id ON api_key_requests (api_key_id);
