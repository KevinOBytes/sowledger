import type { clients } from "@/lib/db/schema";
import { isValidEmail } from "@/lib/validators";
import { WorkflowError } from "@/lib/workflow-validation";

/** Shared native/public contract; existing address and currency storage semantics remain unchanged. */
export function clientUpdates(raw: unknown, creating: boolean) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new WorkflowError("Send a client object with the fields to save.", 400);
  const body = raw as Record<string, unknown>;
  const updates: Partial<typeof clients.$inferInsert> = {};
  if (creating || Object.hasOwn(body, "name")) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 255) throw new WorkflowError("Client name must be a nonempty string of at most 255 characters.", 400);
    updates.name = body.name.trim();
  }
  if (Object.hasOwn(body, "email")) {
    if (body.email !== null && typeof body.email !== "string") throw new WorkflowError("Billing email must be a string or null to clear it.", 400);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email && (email.length > 255 || !isValidEmail(email))) throw new WorkflowError("Use a valid billing email of at most 255 characters.", 400);
    updates.email = email || null;
  }
  if (Object.hasOwn(body, "address")) {
    if (body.address !== null && typeof body.address !== "string") throw new WorkflowError("Address must be a string or null.", 400);
    updates.address = body.address;
  }
  if (Object.hasOwn(body, "currencyOverride")) {
    if (body.currencyOverride !== null && (typeof body.currencyOverride !== "string" || body.currencyOverride.length > 10)) throw new WorkflowError("Currency override must be a string of at most 10 characters or null.", 400);
    updates.currencyOverride = body.currencyOverride;
  }
  if (!creating && Object.hasOwn(body, "status")) {
    if (body.status !== "active" && body.status !== "archived") throw new WorkflowError("Client status must be active or archived.", 400);
    updates.status = body.status;
  }
  if (!creating && (typeof body.clientId !== "string" || !body.clientId.trim() || body.clientId.length > 255)) throw new WorkflowError("clientId must be a nonempty string of at most 255 characters.", 400);
  if (!Object.keys(updates).length) throw new WorkflowError("Include a client field to update.", 400);
  return { clientId: body.clientId as string, updates };
}
