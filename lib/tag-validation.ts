import { WorkflowError } from "@/lib/workflow-validation";

export type TagFields = { name: string; color: string; projectId: string | null; isSOWLedgerDefault: boolean; status: "active" | "archived" };
export function tagObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkflowError("Send a JSON object.", 400);
  return value as Record<string, unknown>;
}
export function tagId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 255) throw new WorkflowError("tagId must be a nonempty string of at most 255 characters.", 400);
  return value; // Validate shape without silently selecting a different identity.
}
function projectId(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim() || value.length > 255) throw new WorkflowError("projectId must be a nonempty string of at most 255 characters, null, or an empty string.", 400);
  return value;
}
function text(value: unknown, max: number, message: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new WorkflowError(message, 400);
  return value.trim();
}
export function tagFields(value: unknown, mode: "create" | "native" | "public"): Partial<TagFields> {
  const body = tagObject(value), fields: Partial<TagFields> = {};
  const has = (key: string) => Object.hasOwn(body, key);
  if (has("name") || mode === "create") {
    const message = "Enter a tag name of at most 255 characters.";
    const name = text(body.name, 255, message);
    fields.name = mode === "public" ? name : name.toLowerCase();
    if (fields.name.length > 255) throw new WorkflowError(message, 400);
  }
  if (has("color")) fields.color = text(body.color, 50, "Choose a tag color of at most 50 characters.");
  if (has("projectId")) fields.projectId = projectId(body.projectId);
  if (has("isSOWLedgerDefault")) {
    if (typeof body.isSOWLedgerDefault !== "boolean") throw new WorkflowError("isSOWLedgerDefault must be true or false.", 400);
    fields.isSOWLedgerDefault = body.isSOWLedgerDefault;
  }
  if (mode !== "create" && has("status")) {
    if (body.status !== "active" && body.status !== "archived") throw new WorkflowError("Choose active or archived as the tag status.", 400);
    fields.status = body.status;
  }
  if (mode === "create") return { color: "#3b82f6", projectId: null, isSOWLedgerDefault: false, ...fields, status: "active" };
  if (!Object.keys(fields).length) throw new WorkflowError("Choose at least one tag field to update.", 400);
  return fields;
}
