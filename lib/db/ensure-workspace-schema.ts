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

  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_clients_workspace_id ON clients (workspace_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_project_tasks_workspace_id ON project_tasks (workspace_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_workspace_tags_workspace_id ON workspace_tags (workspace_id)`);
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
