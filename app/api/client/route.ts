import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLogs, projects, timeEntries, invoices } from "@/lib/db/schema";
import { eq, and, ne, desc, inArray } from "drizzle-orm";
import { buildInvoiceProofPack } from "@/lib/invoice-proof-pack";
import { getClientEntitledInvoiceIds, getClientEntitlementIds } from "@/lib/client-entitlements";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("client", session.role);

    const clientIds = await getClientEntitlementIds(session);
    if (clientIds.length === 0) {
      return NextResponse.json({ ok: true, projects: [], invoices: [] });
    }

    const workspaceProjects = await db
      .select()
      .from(projects)
      .where(and(eq(projects.workspaceId, session.workspaceId), inArray(projects.clientId, clientIds)));
    const projectIds = workspaceProjects.map((project) => project.id);
    
    // Aggregate hours per project
    const allEntries = projectIds.length > 0
      ? await db.select().from(timeEntries).where(and(eq(timeEntries.workspaceId, session.workspaceId), inArray(timeEntries.projectId, projectIds), ne(timeEntries.status, "draft")))
      : [];

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

    const entitledInvoiceIds = await getClientEntitledInvoiceIds(session.workspaceId, clientIds);
    const workspaceInvoices = entitledInvoiceIds.size > 0
      ? await db.select().from(invoices).where(and(eq(invoices.workspaceId, session.workspaceId), inArray(invoices.id, [...entitledInvoiceIds]))).orderBy(desc(invoices.createdAt))
      : [];
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
