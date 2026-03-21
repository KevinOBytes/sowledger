import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { store, Invoice } from "@/lib/store";

export async function GET() {
  try {
    const session = await requireSession();
    // Only managers/owners can view invoices
    requireRole("manager", session.role);

    const invoices = Array.from(store.invoices.values())
      .filter((i) => i.workspaceId === session.workspaceId)
      .map((i) => {
        const project = i.projectId ? store.projects.get(i.projectId) : null;
        return {
          ...i,
          projectName: project?.name || "General Workspace",
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Also return approved but not invoiced entries so they can generate new invoices
    const billableEntries = Array.from(store.entries.values())
      .filter((e) => e.workspaceId === session.workspaceId && e.status === "approved" && e.hourlyRate && e.durationSeconds)
      .map((e) => {
        const user = store.users.get(e.userId);
        const project = e.projectId ? store.projects.get(e.projectId) : null;
        return {
          ...e,
          userEmail: user?.email || "Unknown User",
          projectName: project?.name || "General",
          amount: (e.durationSeconds! / 3600) * e.hourlyRate!,
        };
      })
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

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
    
    const body = await req.json() as { timeEntryIds: string[]; projectId?: string; dueDate?: string };
    
    if (!body.timeEntryIds || body.timeEntryIds.length === 0) {
      return NextResponse.json({ error: "No time entries selected." }, { status: 400 });
    }

    let totalAmount = 0;
    
    for (const id of body.timeEntryIds) {
      const entry = store.entries.get(id);
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

    const workspaceInvoices = Array.from(store.invoices.values()).filter((i) => i.workspaceId === session.workspaceId);
    const nextNum = workspaceInvoices.length + 1;
    
    const invoice: Invoice = {
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      projectId: body.projectId,
      number: `INV-${new Date().getFullYear()}-${nextNum.toString().padStart(4, "0")}`,
      amount: totalAmount,
      status: "draft",
      dueDate: body.dueDate,
      timeEntryIds: body.timeEntryIds,
      createdAt: new Date().toISOString(),
    };

    store.invoices.set(invoice.id, invoice);

    for (const id of body.timeEntryIds) {
      const entry = store.entries.get(id)!;
      entry.status = "invoiced";
    }

    return NextResponse.json({ ok: true, invoice });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 403 });
  }
}
