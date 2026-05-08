CREATE TABLE IF NOT EXISTS integration_connections (
  id varchar(255) PRIMARY KEY,
  workspace_id varchar(255) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider varchar(40) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'needs_setup',
  display_name varchar(255),
  external_account_id varchar(255),
  credentials jsonb DEFAULT '{}'::jsonb NOT NULL,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  token_expires_at timestamp,
  last_synced_at timestamp,
  last_error text,
  created_by_user_id varchar(255) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_sync_records (
  id varchar(255) PRIMARY KEY,
  workspace_id varchar(255) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id varchar(255) NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  provider varchar(40) NOT NULL,
  resource_type varchar(80) NOT NULL,
  resource_id varchar(255) NOT NULL,
  external_id varchar(512) NOT NULL,
  external_url varchar(1024),
  sync_status varchar(20) NOT NULL DEFAULT 'synced',
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  last_synced_at timestamp NOT NULL DEFAULT now(),
  last_error text
);

ALTER TABLE scheduled_work_blocks ADD COLUMN IF NOT EXISTS reminder_sent_at timestamp;

CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_connections_workspace_provider
  ON integration_connections (workspace_id, provider);

CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_sync_records_resource
  ON integration_sync_records (workspace_id, provider, resource_type, resource_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_sync_records_external
  ON integration_sync_records (workspace_id, provider, external_id);
