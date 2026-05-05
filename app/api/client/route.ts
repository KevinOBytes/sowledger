import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLogs, projects, timeEntries, invoices } from "@/lib/db/schema";
import { eq, and, ne, desc, inArray } from "drizzle-orm";
import { buildInvoiceProofPack } from "@/lib/invoice-proof-pack";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("client", session.role);

    const workspaceProjects = await db.select().from(projects).where(eq(projects.workspaceId, session.workspaceId));
    
    // Aggregate hours per project
    const allEntries = await db.select().from(timeEntries).where(and(eq(timeEntries.workspaceId, session.workspaceId), ne(timeEntries.status, "draft")));

    const projectAggregates = workspaceProjects.map(p => {
       const entries = allEntries.filter(e => e.projectId === p.id);
       const totalSeconds = entries.reduce((acc, curr) => acc + (curr.durationSeconds || 0), 0);
       return {
          id: p.id,
          name: p.name,
          percentComplete: p.percentComplete || 0,
          totalHours: totalSeconds / 3600
       };
    });

    const workspaceInvoices = await db.select().from(invoices).where(eq(invoices.workspaceId, session.workspaceId)).orderBy(desc(invoices.createdAt));
    const invoiceIds = workspaceInvoices.map((invoice) => invoice.id);
    const signoffs = invoiceIds.length > 0
      ? await db
        .select()
        .from(auditLogs)
        .where(and(
          eq(auditLogs.workspaceId, session.workspaceId),
          eq(auditLogs.eventType, "client_invoice_signed_off"),
          inArray(auditLogs.timeEntryId, invoiceIds),
        ))
      : [];
    const latestSignoffByInvoiceId = new Map<string, string>();
    for (const signoff of signoffs) {
      const current = latestSignoffByInvoiceId.get(signoff.timeEntryId);
      const next = signoff.createdAt.toISOString();
      if (!current || next > current) latestSignoffByInvoiceId.set(signoff.timeEntryId, next);
    }
    
    const mappedInvoices = await Promise.all(workspaceInvoices.map(async (i) => {
        const project = i.projectId ? workspaceProjects.find(p => p.id === i.projectId) : null;
        const proof = await buildInvoiceProofPack(session.workspaceId, i.id);
        return {
            ...i,
            projectName: project?.name || "General Workspace",
            digest: proof?.digest ?? null,
            signedOffAt: latestSignoffByInvoiceId.get(i.id) ?? null,
        };
    }));

    return NextResponse.json({ ok: true, projects: projectAggregates, invoices: mappedInvoices });
  } catch {
     return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
