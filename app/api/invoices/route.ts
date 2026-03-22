import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { invoices as invoicesTable, timeEntries as timeEntriesTable, projects as projectsTable, users as usersTable } from "@/lib/db/schema";
import { desc, eq, and, isNotNull } from "drizzle-orm";

export async function GET() {
  try {
    const session = await requireSession();
    // Only managers/owners can view invoices
    requireRole("manager", session.role);

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

    const allUsers = await db.select().from(usersTable);

    const billableEntries = approvedEntries.map((e) => {
        const user = allUsers.find(u => u.id === e.userId);
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
    
    if (!body.timeEntryIds || body.timeEntryIds.length === 0) {
      return NextResponse.json({ error: "No time entries selected." }, { status: 400 });
    }

    let totalAmount = 0;
    
    for (const id of body.timeEntryIds) {
      const [entry] = await db.select().from(timeEntriesTable).where(eq(timeEntriesTable.id, id));
      if (!entry || entry.workspaceId !== session.workspaceId) {
        return NextResponse.json({ error: `Invalid entry ${id}` }, { status: 400 });
      }
      if (entry.status === "invoiced") {
        return NextResponse.json({ error: `Entry ${id} is already invoiced` }, { status: 400 });
      }
      if (entry.durationSeconds && entry.hourlyRate) {
        totalAmount += (entry.durationSeconds / 3600) * entry.hourlyRate;
      }
    }

    const workspaceInvoices = await db.select().from(invoicesTable).where(eq(invoicesTable.workspaceId, session.workspaceId));
    const nextNum = workspaceInvoices.length + 1;
    
    const [invoice] = await db.insert(invoicesTable).values({
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      projectId: body.projectId || null,
      number: `INV-${new Date().getFullYear()}-${nextNum.toString().padStart(4, "0")}`,
      amount: totalAmount,
      status: "draft",
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      timeEntryIds: body.timeEntryIds,
    }).returning();


    for (const id of body.timeEntryIds) {
      await db.update(timeEntriesTable)
        .set({ status: "invoiced" })
        .where(eq(timeEntriesTable.id, id));
    }

    return NextResponse.json({ ok: true, invoice });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 403 });
  }
}
