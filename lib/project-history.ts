import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, goals, invoices, projects, scheduledWorkBlocks, timeEntries, workspaceTags } from "@/lib/db/schema";
import { WorkflowError } from "@/lib/workflow-validation";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function hasRecordedWork(tx: Transaction, workspaceId: string, projectId: string) {
  const [entry] = await tx.select({ id: timeEntries.id }).from(timeEntries)
    .where(and(eq(timeEntries.workspaceId, workspaceId), eq(timeEntries.projectId, projectId))).limit(1);
  if (entry) return true;
  const [invoice] = await tx.select({ id: invoices.id }).from(invoices)
    .where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.projectId, projectId))).limit(1);
  return Boolean(invoice);
}

export async function updateWorkspaceProject(workspaceId: string, projectId: string, updates: Partial<typeof projects.$inferInsert>) {
  return db.transaction(async (tx) => {
    const condition = and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId));
    const [existing] = await tx.select().from(projects).where(condition).for("update");
    if (!existing) throw new WorkflowError("Project not found.", 404);
    const nextClientId = updates.clientId === "" ? null : updates.clientId;
    // Invoice access currently follows the project's client. Keeping that
    // boundary stable also protects drafts that are being approved concurrently.
    if (nextClientId !== undefined && nextClientId !== existing.clientId && await hasRecordedWork(tx, workspaceId, projectId)) {
      throw new WorkflowError("This project has recorded time or invoices. Create a new project for a different client.", 409);
    }
    if (nextClientId) {
      const [client] = await tx.select({ id: clients.id }).from(clients)
        .where(and(eq(clients.workspaceId, workspaceId), eq(clients.id, nextClientId))).for("key share");
      if (!client) throw new WorkflowError("The selected client is no longer available. Refresh the client list and choose another client.", 409);
    }
    const [project] = await tx.update(projects).set({ ...updates, clientId: nextClientId }).where(condition).returning();
    return project;
  });
}

export async function deleteUnusedWorkspaceProject(workspaceId: string, projectId: string) {
  await db.transaction(async (tx) => {
    const condition = and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId));
    // A row lock also serializes against time-entry inserts through their
    // project foreign key, so recorded work cannot slip past the history check.
    const [project] = await tx.select({ id: projects.id }).from(projects).where(condition).for("update");
    if (!project) throw new WorkflowError("Project not found.", 404);
    if (await hasRecordedWork(tx, workspaceId, projectId)) {
      throw new WorkflowError("This project has recorded time or invoices. Archive it to keep its billing history.", 409);
    }
    await tx.update(goals).set({ projectId: null }).where(and(eq(goals.workspaceId, workspaceId), eq(goals.projectId, projectId)));
    await tx.update(scheduledWorkBlocks).set({ projectId: null, updatedAt: new Date() }).where(and(eq(scheduledWorkBlocks.workspaceId, workspaceId), eq(scheduledWorkBlocks.projectId, projectId)));
    await tx.update(workspaceTags).set({ projectId: null }).where(and(eq(workspaceTags.workspaceId, workspaceId), eq(workspaceTags.projectId, projectId)));
    await tx.delete(projects).where(condition);
  });
}
