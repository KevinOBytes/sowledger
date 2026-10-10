import { NextRequest, NextResponse, after } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { invoices as invoicesTable, memberships as membershipsTable, timeEntries as timeEntriesTable, projects as projectsTable, users as usersTable } from "@/lib/db/schema";
import { dispatchIntegrationNotification } from "@/lib/integrations/notifications";
import { appendAuditLog, dispatchWebhook } from "@/lib/security";
import { entryIdsFrom, WorkflowError, workflowErrorResponse } from "@/lib/workflow-validation";
import { getAppOrigin } from "@/lib/app-url";
import { timeEntryAmountCents } from "@/lib/invoice-amount";
import { desc, eq, and, inArray, isNotNull } from "drizzle-orm";

function invoiceNumberFromId(id: string, date = new Date()) {
  const day = date.toISOString().slice(0, 10).replaceAll("-", "");
  return `INV-${day}-${id.slice(0, 8).toUpperCase()}`;
}

export async function GET() {
  try {
    const session = await requireSession();
    // Members can view invoices
    requireRole("member", session.role);

    const { checkWorkspaceLimits } = await import("@/lib/billing");
    const limits = await checkWorkspaceLimits(session.workspaceId, "invoices");
    if (!limits.allowed) return NextResponse.json({ error: limits.error, requiresUpgrade: true, invoices: [], billableEntries: [] }, { status: 402 });

    const workspaceInvoices = await db.select().from(invoicesTable)
      .where(eq(invoicesTable.workspaceId, session.workspaceId))
      .orderBy(desc(invoicesTable.createdAt));
      
    const workspaceProjects = await db.select().from(projectsTable)
      .where(eq(projectsTable.workspaceId, session.workspaceId));

    const invoices = workspaceInvoices.map((i) => {
        const project = i.projectId ? workspaceProjects.find(p => p.id === i.projectId) : null;
        return {
          ...i,
          projectName: project?.name || "General Workspace",
        };
      });

    // Also return approved but not invoiced entries so they can generate new invoices
    const approvedEntries = await db.select().from(timeEntriesTable)
      .where(
        and(
          eq(timeEntriesTable.workspaceId, session.workspaceId),
          eq(timeEntriesTable.status, "approved"),
          isNotNull(timeEntriesTable.hourlyRate),
          isNotNull(timeEntriesTable.durationSeconds)
        )
      )
      .orderBy(desc(timeEntriesTable.startedAt));

    const workspaceMemberships = await db
      .select({ userId: membershipsTable.userId })
      .from(membershipsTable)
      .where(eq(membershipsTable.workspaceId, session.workspaceId));
    const workspaceUserIds = workspaceMemberships.map((membership) => membership.userId);
    const workspaceUsers = workspaceUserIds.length > 0 ? await db.select().from(usersTable).where(inArray(usersTable.id, workspaceUserIds)) : [];

    const billableEntries = approvedEntries.map((e) => {
        const user = workspaceUsers.find(u => u.id === e.userId);
        const project = e.projectId ? workspaceProjects.find(p => p.id === e.projectId) : null;
        return {
          ...e,
          userEmail: user?.email || "Unknown User",
          projectName: project?.name || "General",
          amount: (e.durationSeconds! / 3600) * e.hourlyRate!,
        };
      });

    return NextResponse.json({ ok: true, invoices, billableEntries, canManage: session.role === "manager" || session.role === "owner" });
  } catch (error) {
    return workflowErrorResponse(error, "Could not load invoices. Please try again.");
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const { checkWorkspaceLimits } = await import("@/lib/billing");
    const limits = await checkWorkspaceLimits(session.workspaceId, "invoices");
    if (!limits.allowed) return NextResponse.json({ error: limits.error }, { status: 402 });
    const body = await req.json() as { timeEntryIds?: unknown; projectId?: string; dueDate?: string };
    const timeEntryIds = entryIdsFrom(body?.timeEntryIds);
    if (body.projectId !== undefined && (typeof body.projectId !== "string" || !body.projectId || body.projectId.length > 255)) throw new WorkflowError("Choose a valid project.", 400);
    const dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (body.dueDate !== undefined && (typeof body.dueDate !== "string" || !dueDate || !Number.isFinite(dueDate.getTime()))) throw new WorkflowError("Choose a valid due date.", 400);

    const invoice = await db.transaction(async (tx) => {
      const entries = await tx.select().from(timeEntriesTable).where(and(eq(timeEntriesTable.workspaceId, session.workspaceId), inArray(timeEntriesTable.id, timeEntryIds))).orderBy(timeEntriesTable.id).for("update");
      if (entries.length !== timeEntryIds.length) throw new WorkflowError("One or more entries were not found.", 404);
      for (const entry of entries) {
        if (entry.status !== "approved" || !entry.stoppedAt) throw new WorkflowError("Only completed, approved time can be invoiced.", 409);
        if (entry.durationSeconds === null || !Number.isFinite(entry.durationSeconds) || entry.durationSeconds <= 0 || entry.hourlyRate === null || !Number.isFinite(entry.hourlyRate) || entry.hourlyRate < 0) throw new WorkflowError("Every entry needs recorded time and a valid hourly rate.", 400);
      }
      const projectId = body.projectId ?? (entries.every((entry) => entry.projectId === entries[0].projectId) ? entries[0].projectId : null);
      if (body.projectId && entries.some((entry) => entry.projectId !== body.projectId)) throw new WorkflowError("Selected entries must belong to the chosen project.", 400);
      if (projectId) {
        const [project] = await tx.select({ id: projectsTable.id }).from(projectsTable).where(and(eq(projectsTable.id, projectId), eq(projectsTable.workspaceId, session.workspaceId)));
        if (!project) throw new WorkflowError("Project not found.", 400);
      }
      // Round each line in cents so the printed line items add to the stored total.
      const totalCents = entries.reduce((sum, entry) => sum + timeEntryAmountCents(entry.durationSeconds ?? 0, entry.hourlyRate ?? 0), 0);
      if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new WorkflowError("The invoice total is invalid.", 400);
      const invoiceId = crypto.randomUUID();
      const [created] = await tx.insert(invoicesTable).values({
        id: invoiceId, workspaceId: session.workspaceId, projectId,
        number: invoiceNumberFromId(invoiceId), amount: totalCents / 100,
        status: "draft", dueDate, timeEntryIds,
      }).returning();
      await tx.update(timeEntriesTable).set({ status: "invoiced" }).where(and(eq(timeEntriesTable.workspaceId, session.workspaceId), inArray(timeEntriesTable.id, timeEntryIds), eq(timeEntriesTable.status, "approved")));
      for (const entry of entries) await appendAuditLog({
        workspaceId: session.workspaceId, timeEntryId: entry.id, actorUserId: session.sub, eventType: "entry_invoiced",
        diff: { status: { before: "approved", after: "invoiced" }, invoiceId: { before: null, after: invoiceId } },
      }, tx);
      await appendAuditLog({
        workspaceId: session.workspaceId, timeEntryId: created.id, actorUserId: session.sub, eventType: "invoice_created",
        diff: { invoice: { before: null, after: created } },
      }, tx);
      return created;
    });

    after(async () => {
      await Promise.all([
        dispatchWebhook(session.workspaceId, "invoice.created", { invoiceId: invoice.id, number: invoice.number, amount: invoice.amount, status: invoice.status, timeEntryIds }),
        dispatchIntegrationNotification(session.workspaceId, "invoice.created", {
          title: `Invoice ${invoice.number} created`,
          body: `Draft invoice for $${invoice.amount.toFixed(2)} with ${timeEntryIds.length} time entries.`,
          url: `${getAppOrigin()}/invoices`,
        }),
      ]);
    });
    return NextResponse.json({ ok: true, invoice });
  } catch (error) { return workflowErrorResponse(error, "Could not create this invoice. Please try again."); }
}
