import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, organizations, projects, workspacePeople } from "@/lib/db/schema";
import { WorkflowError } from "@/lib/workflow-validation";

export async function deleteUnreferencedWorkspaceClient(workspaceId: string, clientId: string) {
  await db.transaction(async tx => {
    const condition = and(eq(clients.workspaceId, workspaceId), eq(clients.id, clientId));
    const [client] = await tx.select({ id: clients.id }).from(clients).where(condition).for("update");
    if (!client) throw new WorkflowError("Client not found.", 404);
    // Client-first, then a fresh NON-locking project read. Never take a project
    // or workspace lock here: project creation/history uses the other direction.
    // Proven-global-reference exception: existence only, by the globally unique
    // client already authorized above. Do not detach corrupt foreign records.
    // Actual organization/person constraints may differ from ORM declarations.
    const [linked] = await tx.select({ exists: sql<boolean>`true` }).from(projects).where(eq(projects.clientId, clientId)).limit(1);
    if (linked) throw new WorkflowError("This client has linked projects. Archive the client to preserve its billing history.", 409);
    const conflict = () => new WorkflowError("This client has linked records that need review. Archive the client or ask an administrator to reconcile its billing history.", 409);
    const [foreignOrganization] = await tx.select({ exists: sql<boolean>`true` }).from(organizations).where(and(eq(organizations.clientId, clientId), ne(organizations.workspaceId, workspaceId))).limit(1);
    if (foreignOrganization) throw conflict();
    // Retain directory targets for current unconstrained people writers. Lock
    // only authorized owned organizations, sorted; never a project/workspace.
    const ownedOrganizations = await tx.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.workspaceId, workspaceId), eq(organizations.clientId, clientId))).orderBy(organizations.id).for("update");
    if (ownedOrganizations.length) {
      const [foreignPerson] = await tx.select({ exists: sql<boolean>`true` }).from(workspacePeople).where(and(inArray(workspacePeople.organizationId, ownedOrganizations.map(organization => organization.id)), ne(workspacePeople.workspaceId, workspaceId))).limit(1);
      if (foreignPerson) throw conflict();
      const organizationIds = ownedOrganizations.map(organization => organization.id);
      const detached = await tx.update(organizations).set({ clientId: null }).where(and(eq(organizations.workspaceId, workspaceId), eq(organizations.clientId, clientId), inArray(organizations.id, organizationIds))).returning({ id: organizations.id });
      if (detached.length !== organizationIds.length || new Set(detached.map(organization => organization.id)).size !== organizationIds.length || detached.some(organization => !organizationIds.includes(organization.id))) throw new WorkflowError("Linked directory records changed. Refresh the client list and try again.", 409);
    }
    // Organizations/people intentionally remain; only their client link changes.
    const deleted = await tx.delete(clients).where(condition).returning({ id: clients.id });
    if (deleted.length !== 1 || deleted[0].id !== clientId) throw new WorkflowError("Client not found.", 404);
  }, { isolationLevel: "read committed" });
}
