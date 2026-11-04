import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, invoices, projects, timeEntries } from "@/lib/db/schema";
import { appendAuditLog } from "@/lib/security";
import { WorkflowError } from "@/lib/workflow-validation";
import { assertInvoiceAmountReadback, checkedInvoiceCents, invoiceAmountCandidate } from "@/lib/invoice-amount";
import { lockInvoiceLifecycle, recordInvoiceProvenance, verifiedReleasedInvoiceIds } from "@/lib/invoice-lifecycle";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Entry = typeof timeEntries.$inferSelect;
type Project = Pick<typeof projects.$inferSelect, "id" | "clientId" | "name">;
type Client = Pick<typeof clients.$inferSelect, "id" | "name">;
export type InvoiceGroup = { projectId: string | null; clientId: string | null; clientName: string | null; billingAudience: "client" | "internal" };

/** Relationships only; usable for historical classification without rewriting money/proof. */
export function classifyInvoiceGraph(entries: readonly Pick<Entry, "projectId">[], savedProjects: readonly Project[], savedClients: readonly Client[], explicitProjectId?: string): InvoiceGroup {
  if (!entries.length) throw new WorkflowError("One or more entries were not found.", 404);
  const groups = entries.map(entry => {
    if (explicitProjectId !== undefined && entry.projectId !== explicitProjectId) throw new WorkflowError("Selected entries must belong to the chosen project.", 400);
    if (entry.projectId === null) return null;
    const project = savedProjects.find(p => p.id === entry.projectId);
    if (!project) throw new WorkflowError("An entry has an unavailable project or client. Ask a manager to review it.", 400);
    if (project.clientId === null) return null;
    const client = savedClients.find(c => c.id === project.clientId);
    if (!client) throw new WorkflowError("An entry has an unavailable project or client. Ask a manager to review it.", 400);
    return client;
  });
  const first = groups[0];
  if (groups.some(group => (group?.id ?? null) !== (first?.id ?? null))) throw new WorkflowError("Choose time for one client, or an entirely internal selection. Client and internal time cannot be combined.", 400);
  return { projectId: entries.every(entry => entry.projectId === entries[0].projectId) ? entries[0].projectId : null, clientId: first?.id ?? null, clientName: first?.name ?? null, billingAudience: first ? "client" : "internal" };
}

export function classifyInvoiceSelection(entries: readonly Entry[], savedProjects: readonly Project[], savedClients: readonly Client[], explicitProjectId?: string) {
  const group = classifyInvoiceGraph(entries, savedProjects, savedClients, explicitProjectId);
  for (const entry of entries) if (entry.status !== "approved" || !entry.stoppedAt) throw new WorkflowError("Only completed, approved time can be invoiced.", 409);
  let amountCents;
  try { amountCents = checkedInvoiceCents(entries); } catch { throw new WorkflowError("Every entry needs recorded time, a valid hourly rate and a safe invoice total.", 400); }
  return { ...group, amountCents };
}

export async function loadLockedInvoiceSelection(tx: Transaction, workspaceId: string, ids: string[], explicitProjectId?: string) {
  const condition = and(eq(timeEntries.workspaceId, workspaceId), inArray(timeEntries.id, ids));
  const discovered = await tx.select({ id: timeEntries.id, projectId: timeEntries.projectId }).from(timeEntries).where(condition);
  if (discovered.length !== ids.length) throw new WorkflowError("One or more entries were not found.", 404);
  const projectIds = [...new Set(discovered.flatMap(entry => entry.projectId === null ? [] : [entry.projectId]))].sort();
  const savedProjects = projectIds.length ? await tx.select().from(projects).where(and(eq(projects.workspaceId, workspaceId), inArray(projects.id, projectIds))).orderBy(projects.id).for("update") : [];
  if (savedProjects.length !== projectIds.length) throw new WorkflowError("An entry has an unavailable project or client. Ask a manager to review it.", 400);
  const clientIds = [...new Set(savedProjects.flatMap(project => project.clientId === null ? [] : [project.clientId]))].sort();
  const savedClients = clientIds.length ? await tx.select().from(clients).where(and(eq(clients.workspaceId, workspaceId), inArray(clients.id, clientIds))).orderBy(clients.id).for("key share") : [];
  if (savedClients.length !== clientIds.length) throw new WorkflowError("An entry has an unavailable project or client. Ask a manager to review it.", 400);
  const entries = await tx.select().from(timeEntries).where(condition).orderBy(timeEntries.id).for("update");
  if (entries.length !== ids.length || entries.some(entry => discovered.find(old => old.id === entry.id)?.projectId !== entry.projectId)) throw new WorkflowError("Selected time changed. Refresh the list and review your selection.", 409);
  const selection = classifyInvoiceSelection(entries, savedProjects, savedClients, explicitProjectId);
  const existing = await tx.select().from(invoices).where(eq(invoices.workspaceId, workspaceId));
  const released = await verifiedReleasedInvoiceIds(tx, workspaceId, existing);
  if (existing.some(invoice => !released.has(invoice.id) && Array.isArray(invoice.timeEntryIds) && invoice.timeEntryIds.some(id => ids.includes(id)))) throw new WorkflowError("Some selected time is already linked to an invoice. Ask a manager to review it.", 409);
  return { entries, ...selection };
}

export async function createInvoiceFromSelection(input: { workspaceId: string; actorUserId: string; ids: string[]; projectId?: string; dueDate: Date | null }) {
  return db.transaction(async tx => {
    await lockInvoiceLifecycle(tx, input.workspaceId);
    const selection = await loadLockedInvoiceSelection(tx, input.workspaceId, input.ids, input.projectId);
    const candidate = invoiceAmountCandidate(selection.amountCents);
    const probe = await tx.execute<{ amount: number }>(sql`select cast(${candidate.decimal} as real) as amount`);
    assertInvoiceAmountReadback(probe.rows[0]?.amount, candidate);
    const invoiceId = crypto.randomUUID();
    const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const [created] = await tx.insert(invoices).values({ id: invoiceId, workspaceId: input.workspaceId, projectId: selection.projectId, number: `INV-${day}-${invoiceId.slice(0, 8).toUpperCase()}`, amount: candidate.dollars, status: "draft", dueDate: input.dueDate, timeEntryIds: input.ids }).returning();
    assertInvoiceAmountReadback(created?.amount, candidate);
    const [persisted] = await tx.select().from(invoices).where(and(eq(invoices.workspaceId, input.workspaceId), eq(invoices.id, invoiceId)));
    assertInvoiceAmountReadback(persisted?.amount, candidate);
    if (!created || !persisted || created.id !== invoiceId || persisted.id !== invoiceId || persisted.workspaceId !== input.workspaceId) throw new WorkflowError("The invoice could not be confirmed. Refresh and review the selected time.", 409);
    const updated = await tx.update(timeEntries).set({ status: "invoiced" }).where(and(eq(timeEntries.workspaceId, input.workspaceId), inArray(timeEntries.id, input.ids), eq(timeEntries.status, "approved"))).returning({ id: timeEntries.id });
    if (updated.length !== input.ids.length || new Set(updated.map(entry => entry.id)).size !== input.ids.length || updated.some(entry => !input.ids.includes(entry.id))) throw new WorkflowError("Selected time changed. Refresh the list and review your selection.", 409);
    for (const entry of selection.entries) await appendAuditLog({ workspaceId: input.workspaceId, timeEntryId: entry.id, actorUserId: input.actorUserId, eventType: "entry_invoiced", diff: { status: { before: "approved", after: "invoiced" }, invoiceId: { before: null, after: invoiceId } } }, tx);
    await appendAuditLog({ workspaceId: input.workspaceId, timeEntryId: created.id, actorUserId: input.actorUserId, eventType: "invoice_created", diff: { invoice: { before: null, after: created } } }, tx);
    await recordInvoiceProvenance(tx, persisted, input.actorUserId);
    return { ...persisted, amountCents: selection.amountCents, clientId: selection.clientId, clientName: selection.clientName, billingAudience: selection.billingAudience };
  }, { isolationLevel: "read committed" });
}
