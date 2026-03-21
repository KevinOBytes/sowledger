import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("client", session.role);

    const workspaceProjects = Array.from(store.projects.values()).filter(p => p.workspaceId === session.workspaceId);
    
    // Aggregate hours per project
    const projectAggregates = workspaceProjects.map(p => {
       const entries = Array.from(store.entries.values()).filter(e => e.projectId === p.id && e.workspaceId === session.workspaceId && e.status !== "draft");
       const totalSeconds = entries.reduce((acc, curr) => acc + (curr.durationSeconds || 0), 0);
       return {
          id: p.id,
          name: p.name,
          percentComplete: p.percentComplete || 0,
          totalHours: totalSeconds / 3600
       };
    });

    const invoices = Array.from(store.invoices.values())
        .filter(i => i.workspaceId === session.workspaceId)
        .map(i => {
           const project = i.projectId ? store.projects.get(i.projectId) : null;
           return {
              ...i,
              projectName: project?.name || "General Workspace"
           };
        })
        .sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({ ok: true, projects: projectAggregates, invoices });
  } catch (error) {
     return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
