import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, clients, integrationConnections, integrationSyncRecords, invoiceLifecycle, invoices, memberships, projects, timeEntries, webhooks } from "@/lib/db/schema";
import { appendAuditLog, verifyAuditSignature } from "@/lib/security";
import { WorkflowError } from "@/lib/workflow-validation";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;
type Invoice = Omit<typeof invoices.$inferSelect, "status"> & { status: string };
type Lifecycle = typeof invoiceLifecycle.$inferSelect;
type Audit = typeof auditLogs.$inferSelect;
const conflict = (message: string) => new WorkflowError(message, 409);
const validIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length > 0 && ids.length <= 100 && ids.every(id => typeof id === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(id)) && new Set(ids).size === ids.length;

/** Acquire FIRST, before project -> client -> time -> invoice row locks. */
export async function lockInvoiceLifecycle(tx: Transaction, workspaceId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`invoice-lifecycle:${workspaceId}`}, 0))`);
}

export function invoiceFingerprint(invoice: Invoice) {
  return createHash("sha256").update(JSON.stringify({ version: 1, workspaceId: invoice.workspaceId, invoiceId: invoice.id, number: invoice.number, projectId: invoice.projectId, amount: invoice.amount, dueDate: invoice.dueDate?.toISOString() ?? null, createdAt: invoice.createdAt.toISOString(), timeEntryIds: invoice.timeEntryIds })).digest("hex");
}

function intact(invoice: Invoice, lifecycle: Lifecycle | undefined | null) {
  return Boolean(lifecycle && lifecycle.workspaceId === invoice.workspaceId && lifecycle.invoiceId === invoice.id
    && validIds(invoice.timeEntryIds) && validIds(lifecycle.originalTimeEntryIds)
    && isDeepStrictEqual(invoice.timeEntryIds, lifecycle.originalTimeEntryIds)
    && lifecycle.invoiceFingerprint === invoiceFingerprint(invoice) && lifecycle.createdBy && lifecycle.createdAt);
}

export function parseInvoiceVoidRequest(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new WorkflowError("Confirm that this invoice was not billed elsewhere.", 400);
  const body = raw as Record<string, unknown>;
  if (body.confirmNotBilledElsewhere !== true || Object.keys(body).some(key => !["confirmNotBilledElsewhere", "reason"].includes(key))) throw new WorkflowError("Confirm that this invoice was not billed elsewhere.", 400);
  if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 500)) throw new WorkflowError("The optional reason must be 500 characters or fewer.", 400);
  return { reason: typeof body.reason === "string" ? body.reason.trim() : "" };
}

/** Fixed field order reconstructs the EXACT originally signed JSON after JSONB reordering. */
export function invoiceReleaseDiff(lifecycle: Lifecycle) {
  return { release: { before: null, after: { version: 1, workspaceId: lifecycle.workspaceId, invoiceId: lifecycle.invoiceId, invoiceFingerprint: lifecycle.invoiceFingerprint, originalTimeEntryIds: lifecycle.originalTimeEntryIds, createdBy: lifecycle.createdBy, createdAt: lifecycle.createdAt.toISOString(), voidedBy: lifecycle.voidedBy, voidedAt: lifecycle.voidedAt?.toISOString() ?? null, reason: lifecycle.voidReason, confirmNotBilledElsewhere: true } } };
}

export function verifiedInvoiceRelease(invoice: Invoice, lifecycle: Lifecycle | undefined | null, audit: Audit | undefined | null) {
  if (invoice.status !== "void" || !lifecycle || !intact(invoice, lifecycle) || lifecycle.exposedAt || lifecycle.exposureReason
    || !lifecycle.voidedAt || !lifecycle.voidedBy || lifecycle.voidReason === null || !lifecycle.releaseAuditId || !audit) return false;
  const expected = invoiceReleaseDiff(lifecycle);
  return audit.id === lifecycle.releaseAuditId && audit.workspaceId === invoice.workspaceId && audit.timeEntryId === invoice.id
    && audit.actorUserId === lifecycle.voidedBy && audit.eventType === "invoice_voided"
    && isDeepStrictEqual(audit.diff, expected) && verifyAuditSignature(audit.eventType, expected, audit.signature);
}

/** The sole contract used by creation and listing; literal void is never enough. */
export async function verifiedReleasedInvoiceIds(client: Reader, workspaceId: string, rows: readonly Invoice[]) {
  const result = new Set<string>();
  if (!rows.some(invoice => invoice.status === "void")) return result;
  const lifecycles = await client.select().from(invoiceLifecycle).where(eq(invoiceLifecycle.workspaceId, workspaceId));
  const audits = await client.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, workspaceId), eq(auditLogs.eventType, "invoice_voided")));
  for (const invoice of rows) {
    const lifecycle = lifecycles.find(row => row.invoiceId === invoice.id);
    if (invoice.workspaceId === workspaceId && verifiedInvoiceRelease(invoice, lifecycle, audits.find(row => row.id === lifecycle?.releaseAuditId))) result.add(invoice.id);
  }
  return result;
}

export async function recordInvoiceProvenance(tx: Transaction, invoice: typeof invoices.$inferSelect, actorUserId: string) {
  if (!validIds(invoice.timeEntryIds)) throw conflict("Invoice links could not be verified.");
  // A prior financial export of approved time is still external exposure after creation.
  const prior = await tx.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.workspaceId, invoice.workspaceId), inArray(auditLogs.timeEntryId, invoice.timeEntryIds), eq(auditLogs.eventType, "time_financial_exported"))).limit(1);
  const [saved] = await tx.insert(invoiceLifecycle).values({ invoiceId: invoice.id, workspaceId: invoice.workspaceId, originalTimeEntryIds: [...invoice.timeEntryIds], invoiceFingerprint: invoiceFingerprint(invoice), createdBy: actorUserId, createdAt: new Date(), exposedAt: prior.length ? new Date() : null, exposureReason: prior.length ? "Previously exported time" : null }).returning();
  if (!saved || !intact(invoice, saved)) throw conflict("Invoice provenance could not be confirmed.");
}

async function blockingHistory(client: Reader, invoice: Invoice) {
  const history = await client.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, invoice.workspaceId), inArray(auditLogs.timeEntryId, [invoice.id, ...invoice.timeEntryIds])));
  if (history.some(event => event.eventType === "client_invoice_signed_off" || event.eventType === "invoice_financial_exposed" || event.eventType === "time_financial_exported" || /quickbooks/i.test(event.eventType))) return "This invoice has signoff or external/export history and cannot be safely voided.";
  const receipt = await client.select({ id: integrationSyncRecords.id }).from(integrationSyncRecords).where(and(eq(integrationSyncRecords.workspaceId, invoice.workspaceId), eq(integrationSyncRecords.provider, "quickbooks"), eq(integrationSyncRecords.resourceType, "invoice"), eq(integrationSyncRecords.resourceId, invoice.id))).limit(1);
  return receipt.length ? "This invoice has QuickBooks history. Reconcile it externally; SOWLedger cannot cancel it." : null;
}

export async function invoiceVoidEligibility(client: Reader, invoice: Invoice, lifecycle?: Lifecycle) {
  if (invoice.status !== "draft") return { eligible: false, reason: "Only draft invoices can be voided." };
  if (!lifecycle) return { eligible: false, reason: "Legacy invoice: complete creation history is unavailable. It cannot be safely voided." };
  if (!intact(invoice, lifecycle)) return { eligible: false, reason: "Invoice details or original time links have changed. Ask a manager to review the history." };
  if (lifecycle.exposedAt || lifecycle.exposureReason) return { eligible: false, reason: "This draft has been exported or shared externally and cannot be safely voided." };
  if (lifecycle.voidedAt || lifecycle.voidedBy || lifecycle.voidReason !== null || lifecycle.releaseAuditId) return { eligible: false, reason: "This invoice has incomplete or conflicting release history." };
  const history = await blockingHistory(client, invoice);
  if (history) return { eligible: false, reason: history };
  const entries = await client.select().from(timeEntries).where(and(eq(timeEntries.workspaceId, invoice.workspaceId), inArray(timeEntries.id, invoice.timeEntryIds)));
  const owners = await client.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.workspaceId, invoice.workspaceId));
  if (entries.length !== invoice.timeEntryIds.length || entries.some(entry => entry.status !== "invoiced" || !entry.stoppedAt || !owners.some(owner => owner.userId === entry.userId))) return { eligible: false, reason: "Linked time is missing, no longer owned by this workspace, or no longer Invoiced." };
  const all = await client.select().from(invoices).where(eq(invoices.workspaceId, invoice.workspaceId));
  const released = await verifiedReleasedInvoiceIds(client, invoice.workspaceId, all);
  if (all.some(other => other.id !== invoice.id && !released.has(other.id) && Array.isArray(other.timeEntryIds) && other.timeEntryIds.some(id => invoice.timeEntryIds.includes(id)))) return { eligible: false, reason: "Some linked time is also referenced by another unreleased invoice." };
  return { eligible: true, reason: null };
}

export async function voidDraftInvoice(input: { workspaceId: string; invoiceId: string; actorUserId: string; reason: string }) {
  return db.transaction(async tx => {
    await lockInvoiceLifecycle(tx, input.workspaceId);
    const key = and(eq(invoices.workspaceId, input.workspaceId), eq(invoices.id, input.invoiceId));
    const [invoice] = await tx.select().from(invoices).where(key);
    if (!invoice) throw new WorkflowError("Invoice not found.", 404);
    const [lifecycle] = await tx.select().from(invoiceLifecycle).where(and(eq(invoiceLifecycle.workspaceId, input.workspaceId), eq(invoiceLifecycle.invoiceId, input.invoiceId)));
    if ((await verifiedReleasedInvoiceIds(tx, input.workspaceId, [invoice])).has(invoice.id)) return { invoice, alreadyVoided: true };
    // All operations share the lifecycle lock; existing parent lock order stays intact.
    if (validIds(invoice.timeEntryIds)) {
      const discovered = await tx.select().from(timeEntries).where(and(eq(timeEntries.workspaceId, input.workspaceId), inArray(timeEntries.id, invoice.timeEntryIds)));
      const projectIds = [...new Set(discovered.flatMap(row => row.projectId ? [row.projectId] : []))].sort();
      const savedProjects = projectIds.length ? await tx.select().from(projects).where(and(eq(projects.workspaceId, input.workspaceId), inArray(projects.id, projectIds))).orderBy(projects.id).for("update") : [];
      const clientIds = [...new Set(savedProjects.flatMap(row => row.clientId ? [row.clientId] : []))].sort();
      if (clientIds.length) await tx.select().from(clients).where(and(eq(clients.workspaceId, input.workspaceId), inArray(clients.id, clientIds))).orderBy(clients.id).for("key share");
      await tx.select().from(timeEntries).where(and(eq(timeEntries.workspaceId, input.workspaceId), inArray(timeEntries.id, invoice.timeEntryIds))).orderBy(timeEntries.id).for("update");
    }
    await tx.select({ id: invoices.id }).from(invoices).where(key).for("update");
    const eligibility = await invoiceVoidEligibility(tx, invoice, lifecycle);
    if (!eligibility.eligible || !lifecycle) throw conflict(eligibility.reason ?? "This invoice cannot be safely voided.");
    const [updated] = await tx.update(invoices).set({ status: "void" }).where(and(key, eq(invoices.status, "draft"))).returning();
    if (!updated) throw conflict("Invoice changed. Refresh and review it.");
    const released = await tx.update(timeEntries).set({ status: "approved" }).where(and(eq(timeEntries.workspaceId, input.workspaceId), inArray(timeEntries.id, lifecycle.originalTimeEntryIds), eq(timeEntries.status, "invoiced"))).returning({ id: timeEntries.id });
    if (released.length !== lifecycle.originalTimeEntryIds.length || new Set(released.map(row => row.id)).size !== released.length || released.some(row => !lifecycle.originalTimeEntryIds.includes(row.id))) throw conflict("Linked time changed. Nothing was released.");
    for (const id of lifecycle.originalTimeEntryIds) await appendAuditLog({ workspaceId: input.workspaceId, timeEntryId: id, actorUserId: input.actorUserId, eventType: "entry_invoice_released", diff: { status: { before: "invoiced", after: "approved" }, invoiceId: { before: invoice.id, after: invoice.id } } }, tx);
    const complete = { ...lifecycle, voidedAt: new Date(), voidedBy: input.actorUserId, voidReason: input.reason };
    const releaseAuditId = await appendAuditLog({ workspaceId: input.workspaceId, timeEntryId: invoice.id, actorUserId: input.actorUserId, eventType: "invoice_voided", diff: invoiceReleaseDiff(complete) }, tx);
    const [saved] = await tx.update(invoiceLifecycle).set({ voidedAt: complete.voidedAt, voidedBy: complete.voidedBy, voidReason: complete.voidReason, releaseAuditId }).where(and(eq(invoiceLifecycle.workspaceId, input.workspaceId), eq(invoiceLifecycle.invoiceId, invoice.id))).returning();
    const [audit] = await tx.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, input.workspaceId), eq(auditLogs.id, releaseAuditId)));
    if (!verifiedInvoiceRelease(updated, saved, audit)) throw conflict("The complete release record could not be verified. Nothing was released.");
    return { invoice: updated, alreadyVoided: false };
  }, { isolationLevel: "read committed" });
}

/** Caller holds the lifecycle lock. No external payload may escape before commit. */
export async function exposeInvoice(tx: Transaction, workspaceId: string, invoiceId: string, actorUserId: string, reason: string, allowVoidHistory = false) {
  const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.id, invoiceId)));
  if (!invoice) throw new WorkflowError("Invoice not found.", 404);
  if (invoice.status === "void") {
    if (allowVoidHistory) return; // Historical record only: never proof from newly rebilled entries.
    throw conflict("This invoice was voided. Its current linked time cannot be exported as invoice proof.");
  }
  const key = and(eq(invoiceLifecycle.workspaceId, workspaceId), eq(invoiceLifecycle.invoiceId, invoiceId));
  const [lifecycle] = await tx.select().from(invoiceLifecycle).where(key);
  if (lifecycle) {
    if (!lifecycle.exposedAt) {
      const [saved] = await tx.update(invoiceLifecycle).set({ exposedAt: new Date(), exposureReason: reason }).where(key).returning();
      if (!saved?.exposedAt) throw conflict("Export history could not be recorded. No document was exported.");
    }
  } else {
    // Do not backfill legacy provenance. A signed marker records exposure only.
    const [prior] = await tx.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.workspaceId, workspaceId), eq(auditLogs.timeEntryId, invoiceId), eq(auditLogs.eventType, "invoice_financial_exposed"))).limit(1);
    if (!prior) await appendAuditLog({ workspaceId, timeEntryId: invoiceId, actorUserId, eventType: "invoice_financial_exposed", diff: { exposure: { before: null, after: reason } } }, tx);
  }
}

export async function exposeFinancialRows(tx: Transaction, workspaceId: string, actorUserId: string, invoiceIds: readonly string[], entryIds: readonly string[], reason: string) {
  const all = await tx.select().from(invoices).where(eq(invoices.workspaceId, workspaceId));
  const ownedEntries = entryIds.length ? await tx.select({ id: timeEntries.id }).from(timeEntries).where(eq(timeEntries.workspaceId, workspaceId)) : [];
  const requested = new Set(entryIds);
  const ids = new Set(ownedEntries.filter(row => requested.has(row.id)).map(row => row.id));
  for (const invoice of all) if (invoiceIds.includes(invoice.id) || Array.isArray(invoice.timeEntryIds) && invoice.timeEntryIds.some(id => ids.has(id))) await exposeInvoice(tx, workspaceId, invoice.id, actorUserId, reason, true);
  const previous = await tx.select({ timeEntryId: auditLogs.timeEntryId }).from(auditLogs).where(and(eq(auditLogs.workspaceId, workspaceId), eq(auditLogs.eventType, "time_financial_exported")));
  const marked = new Set(previous.map(row => row.timeEntryId));
  for (const id of ids) if (!marked.has(id)) await appendAuditLog({ workspaceId, timeEntryId: id, actorUserId, eventType: "time_financial_exported", diff: { exposure: { before: null, after: reason } } }, tx);
}

export async function reserveInvoiceNotificationExposure(workspaceId: string, invoiceId: string, actorUserId: string) {
  return db.transaction(async tx => {
    await lockInvoiceLifecycle(tx, workspaceId);
    const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.id, invoiceId)));
    if (!invoice || invoice.status === "void") return false;
    const hooks = await tx.select({ events: webhooks.events }).from(webhooks).where(eq(webhooks.workspaceId, workspaceId));
    const slack = await tx.select({ status: integrationConnections.status, config: integrationConnections.config, credentials: integrationConnections.credentials }).from(integrationConnections).where(and(eq(integrationConnections.workspaceId, workspaceId), eq(integrationConnections.provider, "slack")));
    const target = hooks.some(hook => hook.events.includes("*") || hook.events.includes("invoice.created")) || slack.some(connection => {
      const events = Array.isArray(connection.config.events) ? connection.config.events : [];
      return Boolean(connection.credentials.webhookUrl) && ["connected", "error"].includes(connection.status) && (!events.length || events.includes("*") || events.includes("invoice.created"));
    });
    if (!target) return false; // MUST skip both dispatchers, including their fresh recipient lookups.
    await exposeInvoice(tx, workspaceId, invoiceId, actorUserId, "Invoice creation notification reserved");
    return true;
  });
}
