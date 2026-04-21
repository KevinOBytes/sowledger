import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { projects, timeEntries, invoices } from "@/lib/db/schema";
import { eq, and, ne, desc } from "drizzle-orm";

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
    
    const mappedInvoices = workspaceInvoices.map(i => {
        const project = i.projectId ? workspaceProjects.find(p => p.id === i.projectId) : null;
        return {
            ...i,
            projectName: project?.name || "General Workspace"
        };
    });

    return NextResponse.json({ ok: true, projects: projectAggregates, invoices: mappedInvoices });
  } catch {
     return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
