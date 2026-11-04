import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, organizations } from "@/lib/db/schema";
import { clientUpdates } from "@/lib/client-validation";
import { WorkflowError } from "@/lib/workflow-validation";

export async function createWorkspaceClient(workspaceId: string, raw: unknown) {
  const { updates } = clientUpdates(raw, true);
  return db.transaction(async tx => {
    const [client] = await tx.insert(clients).values({ ...updates, id: crypto.randomUUID(), workspaceId, name: updates.name! }).returning();
    if (!client) throw new WorkflowError("Client not found", 404);
    await tx.insert(organizations).values({ id: crypto.randomUUID(), workspaceId, clientId: client.id, name: client.name, type: "client" });
    return client;
  });
}

export async function updateWorkspaceClient(workspaceId: string, raw: unknown) {
  const { clientId, updates } = clientUpdates(raw, false);
  return db.transaction(async tx => {
    const [client] = await tx.update(clients).set(updates).where(and(eq(clients.id, clientId), eq(clients.workspaceId, workspaceId))).returning();
    if (!client) throw new WorkflowError("Client not found", 404);
    if (updates.name !== undefined) await tx.update(organizations).set({ name: updates.name }).where(and(eq(organizations.workspaceId, workspaceId), eq(organizations.clientId, clientId)));
    return client;
  });
}
