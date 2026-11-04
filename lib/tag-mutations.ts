import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, workspaceTags } from "@/lib/db/schema";
import { WorkflowError } from "@/lib/workflow-validation";
import { tagFields, tagId, tagObject, type TagFields } from "@/lib/tag-validation";

type TagTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
// Project deletion uses the same project-before-tag lock order. Do not read or
// lock the old association: only explicitly submitted fields may be written.
async function withTargetProject<T>(workspaceId: string, fields: Partial<TagFields>, write: (tx: TagTransaction) => Promise<T>) {
  return db.transaction(async tx => {
    if (fields.projectId !== undefined && fields.projectId !== null) {
      const [project] = await tx.select().from(projects).where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, fields.projectId))).for("update");
      if (!project) throw new WorkflowError("projectId is not in this workspace", 400);
    }
    return write(tx);
  }, { isolationLevel: "read committed" });
}
export async function createWorkspaceTag(workspaceId: string, value: unknown, nativeDuplicateCheck = false) {
  const fields = tagFields(value, "create") as TagFields;
  // Compatibility only; not a uniqueness guarantee under concurrent creation.
  if (nativeDuplicateCheck) {
    const existing = await db.select().from(workspaceTags).where(and(eq(workspaceTags.workspaceId, workspaceId), eq(workspaceTags.name, fields.name)));
    if (existing.length) throw new WorkflowError("Tag with this name already exists", 400);
  }
  return withTargetProject(workspaceId, fields, async tx => {
    const [tag] = await tx.insert(workspaceTags).values({ id: crypto.randomUUID(), workspaceId, ...fields }).returning();
    if (!tag) throw new Error("Tag insert returned no record");
    return tag;
  });
}
export async function updateWorkspaceTag(workspaceId: string, value: unknown, surface: "native" | "public") {
  const body = tagObject(value), id = tagId(body.tagId), fields = tagFields(body, surface);
  return withTargetProject(workspaceId, fields, async tx => {
    const [tag] = await tx.update(workspaceTags).set(fields).where(and(eq(workspaceTags.workspaceId, workspaceId), eq(workspaceTags.id, id))).returning();
    if (!tag) throw new WorkflowError("Tag not found.", 404);
    return tag;
  });
}
export async function deleteWorkspaceTag(workspaceId: string, value: unknown, archive = false) {
  const id = tagId(value), predicate = and(eq(workspaceTags.workspaceId, workspaceId), eq(workspaceTags.id, id));
  const [tag] = archive
    ? await db.update(workspaceTags).set({ status: "archived" }).where(predicate).returning()
    : await db.delete(workspaceTags).where(predicate).returning();
  if (!tag) throw new WorkflowError("Tag not found.", 404);
  return tag.id;
}
