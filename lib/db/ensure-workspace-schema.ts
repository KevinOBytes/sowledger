import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

let ensureWorkspaceSchemaPromise: Promise<void> | null = null;

async function runSchemaEnsure() {
  // Core entities used by /clients, /projects and /settings/tags
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS clients (
      id varchar(255) PRIMARY KEY,
      workspace_id varchar(255) NOT NULL,
      name varchar(255) NOT NULL,
      email varchar(255),
      address text,
      currency_override varchar(10),
      status varchar(20) NOT NULL DEFAULT 'active',
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS project_tasks (
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
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS workspace_tags (
      id varchar(255) PRIMARY KEY,
      workspace_id varchar(255) NOT NULL,
      project_id varchar(255),
      name varchar(255) NOT NULL,
      color varchar(50) NOT NULL DEFAULT '#3b82f6',
      is_billable_default boolean NOT NULL DEFAULT true,
      status varchar(20) NOT NULL DEFAULT 'active'
    )
  `);

  await db.execute(sql`
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
    )
  `);

  await db.execute(sql`
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
    )
  `);

  await db.execute(sql`
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
    )
  `);

  // Ensure modern project fields exist for project, client, and tag flows.
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_id varchar(255)`);
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS description text`);
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS color varchar(50) NOT NULL DEFAULT '#3b82f6'`);
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS billing_model varchar(20) NOT NULL DEFAULT 'hourly'`);
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS hourly_rate real`);
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget_type varchar(20) NOT NULL DEFAULT 'none'`);
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget_amount real`);
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget_alert_threshold real NOT NULL DEFAULT 80`);
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date timestamp`);
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS end_date timestamp`);
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false`);
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'active'`);
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS percent_complete real NOT NULL DEFAULT 0`);
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now()`);

  await db.execute(sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS scheduled_block_id varchar(255)`);

  await db.execute(sql`ALTER TABLE workspace_tags ADD COLUMN IF NOT EXISTS project_id varchar(255)`);
  await db.execute(sql`ALTER TABLE workspace_tags ADD COLUMN IF NOT EXISTS color varchar(50) NOT NULL DEFAULT '#3b82f6'`);
  await db.execute(sql`ALTER TABLE workspace_tags ADD COLUMN IF NOT EXISTS is_billable_default boolean NOT NULL DEFAULT true`);
  await db.execute(sql`ALTER TABLE workspace_tags ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'active'`);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_clients_workspace_id ON clients (workspace_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_project_tasks_workspace_id ON project_tasks (workspace_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_workspace_tags_workspace_id ON workspace_tags (workspace_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_scheduled_blocks_workspace_user ON scheduled_work_blocks (workspace_id, user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_scheduled_blocks_project ON scheduled_work_blocks (workspace_id, project_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_time_entries_scheduled_block ON time_entries (scheduled_block_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_api_keys_workspace_id ON api_keys (workspace_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_api_key_requests_key_id ON api_key_requests (api_key_id)`);
}

export async function ensureWorkspaceSchema() {
  if (!ensureWorkspaceSchemaPromise) {
    ensureWorkspaceSchemaPromise = runSchemaEnsure().catch((error) => {
      ensureWorkspaceSchemaPromise = null;
      throw error;
    });
  }

  await ensureWorkspaceSchemaPromise;
}
