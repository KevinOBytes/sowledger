import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { invoices as invoicesTable, memberships as membershipsTable, timeEntries as timeEntriesTable, projects as projectsTable, users as usersTable } from "@/lib/db/schema";
import { dispatchIntegrationNotification } from "@/lib/integrations/notifications";
import { desc, eq, and, inArray, isNotNull, sql } from "drizzle-orm";

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

    return NextResponse.json({ ok: true, invoices, billableEntries });
  } catch (error) {
    const err = error as Record<string, unknown>;
    const status = err.code === "FORBIDDEN" || err.status === 403 ? 403 : 401;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    
    const { checkWorkspaceLimits } = await import("@/lib/billing");
    const limits = await checkWorkspaceLimits(session.workspaceId, "invoices");
    if (!limits.allowed) return NextResponse.json({ error: limits.error }, { status: 402 });

    const body = await req.json() as { timeEntryIds: string[]; projectId?: string; dueDate?: string };
    
    if (!Array.isArray(body.timeEntryIds) || body.timeEntryIds.length === 0) {
      return NextResponse.json({ error: "No time entries selected." }, { status: 400 });
    }
    const timeEntryIds = [...new Set(body.timeEntryIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
    if (timeEntryIds.length !== body.timeEntryIds.length) {
      return NextResponse.json({ error: "Time entry IDs must be unique strings." }, { status: 400 });
    }

    if (body.projectId) {
      const [project] = await db
        .select({ id: projectsTable.id })
        .from(projectsTable)
        .where(and(eq(projectsTable.id, body.projectId), eq(projectsTable.workspaceId, session.workspaceId)));
      if (!project) return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
    }

    const entries = await db
      .select()
      .from(timeEntriesTable)
      .where(and(
        eq(timeEntriesTable.workspaceId, session.workspaceId),
        inArray(timeEntriesTable.id, timeEntryIds),
      ));
    const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
    for (const id of timeEntryIds) {
      const entry = entriesById.get(id);
      if (!entry) return NextResponse.json({ error: `Invalid entry ${id}` }, { status: 400 });
      if (entry.status !== "approved") return NextResponse.json({ error: `Entry ${id} must be approved before invoicing` }, { status: 400 });
      if (!entry.stoppedAt) return NextResponse.json({ error: `Entry ${id} must be completed before invoicing` }, { status: 400 });
      if (!Number.isFinite(entry.durationSeconds) || entry.durationSeconds === null || entry.durationSeconds < 0) {
        return NextResponse.json({ error: `Entry ${id} has invalid duration` }, { status: 400 });
      }
      if (!Number.isFinite(entry.hourlyRate) || entry.hourlyRate === null || entry.hourlyRate < 0) {
        return NextResponse.json({ error: `Entry ${id} has invalid hourly rate` }, { status: 400 });
      }
    }
    if (body.projectId && entries.some((entry) => entry.projectId !== body.projectId)) {
      return NextResponse.json({ error: "Selected entries must match supplied projectId" }, { status: 400 });
    }

    const totalAmount = entries.reduce((sum, entry) => sum + ((entry.durationSeconds ?? 0) / 3600) * (entry.hourlyRate ?? 0), 0);
    if (!Number.isFinite(totalAmount) || totalAmount < 0) {
      return NextResponse.json({ error: "Invoice total is invalid" }, { status: 400 });
    }

    const invoice = await db.transaction(async (tx) => {
      const invoiceId = crypto.randomUUID();

      const [createdInvoice] = await tx.insert(invoicesTable).values({
        id: invoiceId,
        workspaceId: session.workspaceId,
        projectId: body.projectId || null,
        number: invoiceNumberFromId(invoiceId),
        amount: totalAmount,
        status: "draft",
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        timeEntryIds,
      }).returning();

      const updatedEntries = await tx.update(timeEntriesTable)
        .set({ status: "invoiced" })
        .where(and(
          eq(timeEntriesTable.workspaceId, session.workspaceId),
          inArray(timeEntriesTable.id, timeEntryIds),
          eq(timeEntriesTable.status, "approved"),
          isNotNull(timeEntriesTable.stoppedAt),
          isNotNull(timeEntriesTable.durationSeconds),
          isNotNull(timeEntriesTable.hourlyRate),
          sql`${timeEntriesTable.durationSeconds} >= 0`,
          sql`${timeEntriesTable.hourlyRate} >= 0`,
        ))
        .returning({ id: timeEntriesTable.id });

      if (updatedEntries.length !== timeEntryIds.length) {
        throw new Error("One or more entries are no longer invoiceable");
      }

      return createdInvoice;
    });

    dispatchIntegrationNotification(session.workspaceId, "invoice.created", {
      title: `Invoice ${invoice.number} created`,
      body: `$${invoice.amount.toFixed(2)} moved into invoice-ready output with ${timeEntryIds.length} linked entries.`,
      url: `${process.env.NEXT_PUBLIC_APP_URL || ""}/invoices`,
    }).catch(() => {});

    return NextResponse.json({ ok: true, invoice });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 403 });
  }
}
