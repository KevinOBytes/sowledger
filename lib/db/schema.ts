import { boolean, jsonb, pgTable, real, text, timestamp, varchar, primaryKey, bigint } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: varchar("id", { length: 255 }).primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  displayName: varchar("display_name", { length: 255 }),
  timezone: varchar("timezone", { length: 100 }).notNull().default("UTC"),
  preferredTags: jsonb("preferred_tags").$type<string[]>().default([]).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const workspaces = pgTable("workspaces", {
  id: varchar("id", { length: 255 }).primaryKey(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  baseCurrency: varchar("base_currency", { length: 10 }).notNull().default("USD"),
  plan: varchar("plan", { enum: ["free", "pro", "smb", "enterprise"] }).notNull().default("free"),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  stripePriceId: varchar("stripe_price_id", { length: 255 }),
  stripeCurrentPeriodEnd: timestamp("stripe_current_period_end"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const memberships = pgTable("memberships", {
  workspaceId: varchar("workspace_id", { length: 255 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role", { enum: ["client", "member", "manager", "owner"] }).notNull().default("member"),
}, (table) => ({
  pk: primaryKey({ columns: [table.workspaceId, table.userId] }),
}));

export const clients = pgTable("clients", {
  id: varchar("id", { length: 255 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 255 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  address: text("address"),
  currencyOverride: varchar("currency_override", { length: 10 }),
  status: varchar("status", { enum: ["active", "archived"] }).notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const organizations = pgTable("organizations", {
  id: varchar("id", { length: 255 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 255 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  clientId: varchar("client_id", { length: 255 }).references(() => clients.id, { onDelete: "set null" }),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type", { enum: ["internal", "client", "vendor", "partner", "other"] }).notNull().default("other"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const workspacePeople = pgTable("workspace_people", {
  id: varchar("id", { length: 255 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 255 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id", { length: 255 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
  linkedUserId: varchar("linked_user_id", { length: 255 }).references(() => users.id, { onDelete: "set null" }),
  displayName: varchar("display_name", { length: 255 }),
  email: varchar("email", { length: 255 }),
  title: varchar("title", { length: 255 }),
  personType: varchar("person_type", { enum: ["member", "client", "contractor", "contact"] }).notNull().default("contact"),
  invitationStatus: varchar("invitation_status", { enum: ["none", "pending", "accepted"] }).notNull().default("none"),
  inviteRole: varchar("invite_role", { enum: ["client", "member", "manager", "owner"] }),
  status: varchar("status", { enum: ["active", "archived"] }).notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const projects = pgTable("projects", {
  id: varchar("id", { length: 255 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 255 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  clientId: varchar("client_id", { length: 255 }).references(() => clients.id, { onDelete: "set null" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  color: varchar("color", { length: 50 }).notNull().default("#3b82f6"),
  billingModel: varchar("billing_model", { enum: ["hourly", "fixed_fee", "hybrid"] }).notNull().default("hourly"),
  hourlyRate: real("hourly_rate"),
  budgetType: varchar("budget_type", { enum: ["hours", "fees", "none"] }).notNull().default("none"),
  budgetAmount: real("budget_amount"),
  budgetAlertThreshold: real("budget_alert_threshold").notNull().default(80),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  isPrivate: boolean("is_private").notNull().default(false),
  status: varchar("status", { enum: ["active", "archived"] }).notNull().default("active"),
  percentComplete: real("percent_complete").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const goals = pgTable("goals", {
  id: varchar("id", { length: 255 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 255 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: varchar("project_id", { length: 255 }),
  assignedUserId: varchar("assigned_user_id", { length: 255 }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  recurrence: varchar("recurrence", { enum: ["none", "weekly", "monthly", "quarterly", "yearly"] }).notNull().default("none"),
  targetHours: real("target_hours"),
  targetAmount: real("target_amount"),
  targetType: varchar("target_type", { enum: ["hours", "amount"] }).notNull().default("hours"),
  dueDate: timestamp("due_date"),
  completed: boolean("completed").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const invitations = pgTable("invitations", {
  id: varchar("id", { length: 255 }).primaryKey(),
  email: varchar("email", { length: 255 }).notNull(),
  workspaceId: varchar("workspace_id", { length: 255 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  role: varchar("role", { enum: ["client", "member", "manager", "owner"] }).notNull(),
  invitedByUserId: varchar("invited_by_user_id", { length: 255 }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  acceptedAt: bigint("accepted_at", { mode: "number" }),
});

export const magicLinks = pgTable("magic_links", {
  tokenId: varchar("token_id", { length: 255 }).primaryKey(),
  tokenHash: varchar("token_hash", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  workspaceSlug: varchar("workspace_slug", { length: 255 }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  usedAt: bigint("used_at", { mode: "number" }),
});

export const timeEntries = pgTable("time_entries", {
  id: varchar("id", { length: 255 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 255 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  scheduledBlockId: varchar("scheduled_block_id", { length: 255 }),
  taskId: varchar("task_id", { length: 255 }).notNull(),
  projectId: varchar("project_id", { length: 255 }),
  goalId: varchar("goal_id", { length: 255 }),
  tags: jsonb("tags").$type<string[]>().default([]).notNull(),
  startedAt: timestamp("started_at").notNull(),
  stoppedAt: timestamp("stopped_at"),
  durationSeconds: real("duration_seconds"),
  description: text("description"),
  action: varchar("action", { length: 255 }),
  hourlyRate: real("hourly_rate"),
  status: varchar("status", { enum: ["draft", "submitted", "approved", "invoiced"] }).notNull().default("draft"),
  source: varchar("source", { enum: ["web", "calendar", "manual"] }).notNull().default("web"),
  collaborators: jsonb("collaborators").$type<string[]>().default([]).notNull(),
  expenses: jsonb("expenses").$type<{ label: string; amount: number; currency: string; r2Key: string }[]>().default([]).notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: varchar("id", { length: 255 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 255 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  timeEntryId: varchar("time_entry_id", { length: 255 }).notNull(),
  actorUserId: varchar("actor_user_id", { length: 255 }).notNull(),
  eventType: varchar("event_type", { length: 255 }).notNull(),
  diff: jsonb("diff").notNull(),
  signature: text("signature").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const lockPeriods = pgTable("lock_periods", {
  id: varchar("id", { length: 255 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 255 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  reason: text("reason").notNull(),
  lockedByUserId: varchar("locked_by_user_id", { length: 255 }).notNull(),
});

export const userActions = pgTable("user_actions", {
  id: varchar("id", { length: 255 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 255 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  hourlyRate: real("hourly_rate"),
});

export const projectTasks = pgTable("project_tasks", {
  id: varchar("id", { length: 255 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 255 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: varchar("project_id", { length: 255 }).notNull().references(() => projects.id, { onDelete: "cascade" }),
  parentId: varchar("parent_id", { length: 255 }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: varchar("status", { enum: ["todo", "in_progress", "review", "done"] }).notNull().default("todo"),
  position: real("position").notNull(),
  dueDate: timestamp("due_date"),
  assigneeId: varchar("assignee_id", { length: 255 }),
  estimatedHours: real("estimated_hours"),
  blockedByTaskIds: jsonb("blocked_by_task_ids").$type<string[]>().default([]),
  attachments: jsonb("attachments").$type<{ name: string; url: string; size?: number }[]>().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: varchar("id", { length: 255 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 255 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  read: boolean("read").notNull().default(false),
  relatedEntityId: varchar("related_entity_id", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const invoices = pgTable("invoices", {
  id: varchar("id", { length: 255 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 255 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: varchar("project_id", { length: 255 }),
  number: varchar("number", { length: 255 }).notNull(),
  amount: real("amount").notNull(),
  status: varchar("status", { enum: ["draft", "sent", "paid"] }).notNull().default("draft"),
  dueDate: timestamp("due_date"),
  timeEntryIds: jsonb("time_entry_ids").$type<string[]>().default([]).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const webhooks = pgTable("webhooks", {
  id: varchar("id", { length: 255 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 255 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  url: varchar("url", { length: 1024 }).notNull(),
  events: jsonb("events").$type<string[]>().default([]).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const scheduledWorkBlocks = pgTable("scheduled_work_blocks", {
  id: varchar("id", { length: 255 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 255 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: varchar("project_id", { length: 255 }),
  taskId: varchar("task_id", { length: 255 }),
  actionId: varchar("action_id", { length: 255 }),
  linkedTimeEntryId: varchar("linked_time_entry_id", { length: 255 }),
  title: varchar("title", { length: 255 }).notNull(),
  notes: text("notes"),
  tags: jsonb("tags").$type<string[]>().default([]).notNull(),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at").notNull(),
  status: varchar("status", { enum: ["planned", "in_progress", "completed", "skipped", "canceled"] }).notNull().default("planned"),
  createdByUserId: varchar("created_by_user_id", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const apiKeys = pgTable("api_keys", {
  id: varchar("id", { length: 255 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 255 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  keyHash: varchar("key_hash", { length: 255 }).notNull().unique(),
  keyPrefix: varchar("key_prefix", { length: 32 }).notNull(),
  scopes: jsonb("scopes").$type<string[]>().default([]).notNull(),
  createdByUserId: varchar("created_by_user_id", { length: 255 }).notNull(),
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const apiKeyRequests = pgTable("api_key_requests", {
  id: varchar("id", { length: 255 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 255 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  apiKeyId: varchar("api_key_id", { length: 255 }).notNull(),
  method: varchar("method", { length: 10 }).notNull(),
  path: varchar("path", { length: 1024 }).notNull(),
  status: real("status").notNull(),
  ipHash: varchar("ip_hash", { length: 255 }),
  userAgent: varchar("user_agent", { length: 512 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const workspaceTags = pgTable("workspace_tags", {
  id: varchar("id", { length: 255 }).primaryKey(),
  workspaceId: varchar("workspace_id", { length: 255 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: varchar("project_id", { length: 255 }),
  name: varchar("name", { length: 255 }).notNull(),
  color: varchar("color", { length: 50 }).notNull().default("#3b82f6"),
  isBillableDefault: boolean("is_billable_default").notNull().default(true),
  status: varchar("status", { enum: ["active", "archived"] }).notNull().default("active"),
});
