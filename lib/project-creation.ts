import { and, eq } from "drizzle-orm";

import { checkWorkspaceLimits } from "@/lib/billing";
import { db } from "@/lib/db";
import { clients, projects, workspaces } from "@/lib/db/schema";
import { WorkflowError } from "@/lib/workflow-validation";

export async function createWorkspaceProject(input: typeof projects.$inferInsert) {
  return db.transaction(async (tx) => {
    // App and API creation share this lock, so the final plan slot cannot be
    // consumed by two requests that both counted before either inserted.
    const [workspace] = await tx.select({ id: workspaces.id }).from(workspaces)
      .where(eq(workspaces.id, input.workspaceId)).for("update");
    if (!workspace) throw new Error("Workspace not found");

    const limits = await checkWorkspaceLimits(input.workspaceId, "projects", tx);
    if (!limits.allowed) return { allowed: false, error: limits.error } as const;

    if (input.clientId) {
      const [client] = await tx.select({ id: clients.id }).from(clients)
        .where(and(eq(clients.workspaceId, input.workspaceId), eq(clients.id, input.clientId))).for("key share");
      if (!client) throw new WorkflowError("The selected client is no longer available. Refresh the client list and choose another client.", 409);
    }

    const [project] = await tx.insert(projects).values(input).returning();
    return { allowed: true, project } as const;
  });
}
