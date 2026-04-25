import { db } from "@/lib/db";
import { users, workspaces, memberships, projects, goals, invitations, magicLinks, timeEntries, auditLogs, lockPeriods, userActions, projectTasks, notifications, invoices, webhooks, scheduledWorkBlocks, apiKeys, apiKeyRequests, organizations, workspacePeople } from "@/lib/db/schema";
import { eq, and, gt, desc } from "drizzle-orm";

export type WorkspaceRole = "client" | "member" | "manager" | "owner";
export type KanbanColumn = "todo" | "in_progress" | "review" | "done";

export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type MagicLinkRecord = typeof magicLinks.$inferSelect;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type AuditItem = typeof auditLogs.$inferSelect;
export type LockPeriod = typeof lockPeriods.$inferSelect;
export type UserAction = typeof userActions.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type ProjectTask = typeof projectTasks.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type WebhookIntegration = typeof webhooks.$inferSelect;
export type ScheduledWorkBlock = typeof scheduledWorkBlocks.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type ApiKeyRequest = typeof apiKeyRequests.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type WorkspacePerson = typeof workspacePeople.$inferSelect;

export async function ensureUser(email: string) {
  const normalized = email.trim().toLowerCase();
  let [user] = await db.select().from(users).where(eq(users.email, normalized));
  if (user) return user;

  const newUser = {
    id: crypto.randomUUID(),
    email: normalized,
    timezone: "UTC",
    preferredTags: [],
  };
  [user] = await db.insert(users).values(newUser).returning();
  return user;
}

export async function ensureWorkspace(slug: string) {
  const normalized = slug.trim().toLowerCase();
  let [workspace] = await db.select().from(workspaces).where(eq(workspaces.slug, normalized));
  if (workspace) return workspace;

  const newWs = {
    id: crypto.randomUUID(),
    slug: normalized,
    name: normalized,
    baseCurrency: "USD",
  };
  [workspace] = await db.insert(workspaces).values(newWs).returning();
  return workspace;
}

export async function ensureMembership(userId: string, workspaceId: string, defaultRole: WorkspaceRole = "member") {
  let [membership] = await db.select().from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)));
  if (membership) return membership;

  const newMem = { userId, workspaceId, role: defaultRole };
  [membership] = await db.insert(memberships).values(newMem).returning();
  return membership;
}

export async function getMembership(userId: string, workspaceId: string) {
  const [membership] = await db.select().from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)));
  return membership ?? null;
}

export async function createProject(input: Omit<typeof projects.$inferInsert, "id" | "createdAt" | "percentComplete"> & { percentComplete?: number }) {
  const project = {
    id: crypto.randomUUID(),
    percentComplete: input.percentComplete ?? 0,
    ...input,
  };
  const [res] = await db.insert(projects).values(project).returning();
  return res;
}

export async function createGoal(input: Omit<typeof goals.$inferInsert, "id" | "createdAt" | "completed"> & { completed?: boolean }) {
  const goal = {
    id: crypto.randomUUID(),
    completed: input.completed ?? false,
    ...input,
  };
  const [res] = await db.insert(goals).values(goal).returning();
  return res;
}

export async function createInvitation(input: Omit<typeof invitations.$inferInsert, "id">) {
  const invite = { id: crypto.randomUUID(), ...input };
  const [res] = await db.insert(invitations).values(invite).returning();
  return res;
}

export async function findPendingInvitation(email: string, workspaceId: string) {
  const normalized = email.trim().toLowerCase();
  const now = Date.now();
  const [invite] = await db.select().from(invitations)
    .where(and(
      eq(invitations.workspaceId, workspaceId),
      eq(invitations.email, normalized),
      gt(invitations.expiresAt, now)
    )).orderBy(desc(invitations.expiresAt));
  if (invite && !invite.acceptedAt) return invite;
  return null;
}

export async function listWorkspaceTags(workspaceId: string) {
  const tags = new Set<string>();
  const entries = await db.select({ tags: timeEntries.tags }).from(timeEntries).where(eq(timeEntries.workspaceId, workspaceId));
  for (const entry of entries) {
    for (const tag of entry.tags) {
      tags.add(tag);
    }
  }
  return [...tags].sort();
}

export async function calculateEffectiveRate(userId: string, workspaceId: string, actionId: string): Promise<number | undefined> {
  const [action] = await db.select().from(userActions).where(eq(userActions.id, actionId));
  if (action && action.workspaceId === workspaceId && action.userId === userId && action.hourlyRate !== null) {
    return action.hourlyRate;
  }
  return undefined;
}

export async function createNotification(input: Omit<typeof notifications.$inferInsert, "id" | "createdAt" | "read">) {
  const notif = {
    id: crypto.randomUUID(),
    read: false,
    ...input,
  };
  const [res] = await db.insert(notifications).values(notif).returning();
  return res;
}
