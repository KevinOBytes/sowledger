import { NextRequest, NextResponse, after } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { clients, invoices as invoicesTable, invoiceLifecycle, memberships, timeEntries, projects, users } from "@/lib/db/schema";
import { dispatchIntegrationNotification } from "@/lib/integrations/notifications";
import { dispatchWebhook } from "@/lib/security";
import { readRequestJson, workflowErrorResponse, WorkflowError, entryIdsFrom } from "@/lib/workflow-validation";
import { parseDueDate } from "@/lib/date-input";
import { getAppOrigin } from "@/lib/app-url";
import { InvoiceAmountError } from "@/lib/invoice-amount";
import { classifyInvoiceGraph, classifyInvoiceSelection, createInvoiceFromSelection } from "@/lib/invoice-selection";
import { desc, eq, and, inArray } from "drizzle-orm";
import { invoiceVoidEligibility, reserveInvoiceNotificationExposure, verifiedReleasedInvoiceIds } from "@/lib/invoice-lifecycle";

function invoiceError(error: unknown, fallback: string, method?: "POST") {
  if (error instanceof InvoiceAmountError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  return workflowErrorResponse(error, fallback, method ? { route: "/api/invoices", method } : undefined);
}

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    const isMember = session.role === "member";
    const { checkWorkspaceLimits } = await import("@/lib/billing");
    const limits = await checkWorkspaceLimits(session.workspaceId, "invoices");
    if (!limits.allowed) return NextResponse.json({ error: limits.error, requiresUpgrade: true, invoices: [], billableEntries: [] }, { status: 402 });

    const workspaceInvoices = await db.select().from(invoicesTable).where(eq(invoicesTable.workspaceId, session.workspaceId)).orderBy(desc(invoicesTable.createdAt));
    const released = await verifiedReleasedInvoiceIds(db, session.workspaceId, workspaceInvoices);
    const lifecycles = isMember ? [] : await db.select().from(invoiceLifecycle).where(eq(invoiceLifecycle.workspaceId, session.workspaceId));
    const workspaceProjects = await db.select().from(projects).where(eq(projects.workspaceId, session.workspaceId));
    const workspaceClients = await db.select().from(clients).where(eq(clients.workspaceId, session.workspaceId));
    // Keep malformed approved rows visible so managers can see why they cannot bill them.
    const approvedEntries = await db.select().from(timeEntries).where(and(eq(timeEntries.workspaceId, session.workspaceId), eq(timeEntries.status, "approved"), isMember ? eq(timeEntries.userId, session.sub) : undefined)).orderBy(desc(timeEntries.startedAt));
    const historyIds = [...new Set(workspaceInvoices.flatMap(invoice => Array.isArray(invoice.timeEntryIds) ? invoice.timeEntryIds.filter(id => typeof id === "string") : []))];
    // The per-invoice 100-entry limit does not bound lifetime history. Keep all
    // IDs, but leave ample headroom below PostgreSQL's 16-bit bind count.
    const historyEntries = new Map<string, { id: string; projectId: string | null; userId: string }>();
    for (let offset = 0; offset < historyIds.length; offset += 1000) {
      const chunk = historyIds.slice(offset, offset + 1000);
      const entries = await db.select({ id: timeEntries.id, projectId: timeEntries.projectId, userId: timeEntries.userId }).from(timeEntries).where(and(eq(timeEntries.workspaceId, session.workspaceId), inArray(timeEntries.id, chunk)));
      for (const entry of entries) historyEntries.set(entry.id, entry);
    }
    // Keep complete workspace history server-side for eligibility conflicts,
    // but only expose member summaries whose entire linked graph is owned.
    const visibleInvoices = isMember ? workspaceInvoices.filter(invoice => {
      const ids = invoice.timeEntryIds;
      return Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length
        && ids.every(id => typeof id === "string" && id.trim().length > 0 && historyEntries.get(id)?.userId === session.sub);
    }) : workspaceInvoices;
    const invoices = await Promise.all(visibleInvoices.map(async invoice => {
      let group: { clientId: string | null; clientName: string | null; billingAudience: "client" | "internal" | "unknown" } = { clientId: null, clientName: null, billingAudience: "unknown" };
      const ids = invoice.timeEntryIds;
      if (Array.isArray(ids) && ids.length && new Set(ids).size === ids.length) {
        const linked = ids.flatMap(id => { const entry = historyEntries.get(id); return entry ? [entry] : []; });
        if (linked.length === ids.length) try {
          const { clientId, clientName, billingAudience } = classifyInvoiceGraph(linked, workspaceProjects, workspaceClients);
          group = { clientId, clientName, billingAudience };
        } catch { /* Unknown history must not imply portal visibility. */ }
      }
      return { ...invoice, ...group, projectName: workspaceProjects.find(p => p.id === invoice.projectId)?.name ?? "General Workspace", ...(!isMember ? { voidEligibility: await invoiceVoidEligibility(db, invoice, lifecycles.find(row => row.invoiceId === invoice.id)) } : {}) };
    }));
    const workspaceMemberships = await db.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.workspaceId, session.workspaceId));
    // Users are global identities reached only through this workspace's memberships.
    const userIds = [...new Set(workspaceMemberships.map(member => member.userId))];
    const workspaceUsers = new Map<string, typeof users.$inferSelect>();
    for (let offset = 0; offset < userIds.length; offset += 1000) {
      const chunk = await db.select().from(users).where(inArray(users.id, userIds.slice(offset, offset + 1000)));
      for (const user of chunk) workspaceUsers.set(user.id, user);
    }
    const billableEntries = approvedEntries.map(entry => {
      let preview: { amountCents: number | null; amount: number | null; clientId: string | null; clientName: string | null; billingAudience: "client" | "internal" | null; eligible: boolean; ineligibleReason: string | null };
      try {
        const selection = classifyInvoiceSelection([entry], workspaceProjects, workspaceClients);
        if (workspaceInvoices.some(invoice => !released.has(invoice.id) && Array.isArray(invoice.timeEntryIds) && invoice.timeEntryIds.includes(entry.id))) throw new WorkflowError("This time is already linked to an invoice. Ask a manager to review it.", 409);
        preview = { ...selection, amount: selection.amountCents / 100, eligible: true, ineligibleReason: null };
      } catch (error) {
        if (!(error instanceof WorkflowError)) throw error;
        preview = { amountCents: null, amount: null, clientId: null, clientName: null, billingAudience: null, eligible: false, ineligibleReason: error.message };
      }
      return { ...entry, durationSeconds: Number.isFinite(entry.durationSeconds) ? entry.durationSeconds : null, hourlyRate: Number.isFinite(entry.hourlyRate) ? entry.hourlyRate : null, userEmail: workspaceUsers.get(entry.userId)?.email ?? "Unknown User", projectName: workspaceProjects.find(project => project.id === entry.projectId)?.name ?? "General", ...preview };
    });
    return NextResponse.json({ ok: true, workspaceId: session.workspaceId, invoices, billableEntries, canManage: session.role === "manager" || session.role === "owner" });
  } catch (error) { return invoiceError(error, "Could not load invoices. Please try again."); }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const { checkWorkspaceLimits } = await import("@/lib/billing");
    const limits = await checkWorkspaceLimits(session.workspaceId, "invoices");
    if (!limits.allowed) return NextResponse.json({ error: limits.error }, { status: 402 });
    const raw: unknown = await readRequestJson(req);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new WorkflowError("Send a valid invoice selection.", 400);
    const body = raw as Record<string, unknown>;
    const timeEntryIds = entryIdsFrom(body.timeEntryIds);
    if (body.projectId !== undefined && (typeof body.projectId !== "string" || !body.projectId.trim() || body.projectId.length > 255)) throw new WorkflowError("Choose a valid project.", 400);
    const invoice = await createInvoiceFromSelection({ workspaceId: session.workspaceId, actorUserId: session.sub, ids: timeEntryIds, projectId: body.projectId as string | undefined, dueDate: parseDueDate(body.dueDate) });
    // Register only after the entire callback transaction has committed.
    after(async () => {
      if (!await reserveInvoiceNotificationExposure(session.workspaceId, invoice.id, session.sub)) return;
      await Promise.all([
        dispatchWebhook(session.workspaceId, "invoice.created", { invoiceId: invoice.id, number: invoice.number, amount: invoice.amount, status: invoice.status, timeEntryIds }),
        dispatchIntegrationNotification(session.workspaceId, "invoice.created", { title: `Invoice ${invoice.number} created`, body: `Draft invoice for $${invoice.amount.toFixed(2)} with ${timeEntryIds.length} time entries.`, url: `${getAppOrigin()}/invoices` }),
      ]);
    });
    return NextResponse.json({ ok: true, invoice });
  } catch (error) { return invoiceError(error, "We couldn't confirm the invoice was saved. Refresh your invoices before trying again.", "POST"); }
}
