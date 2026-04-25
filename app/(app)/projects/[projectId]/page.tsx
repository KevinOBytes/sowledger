import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { projects as projectsTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { KanbanBoard } from "@/components/kanban-board";
import { ActivityFeed } from "@/components/activity-feed";
import { ProjectActions } from "@/components/project-actions";
import { ProjectFinancials } from "@/components/project-financials";
import { ProjectTaskList } from "@/components/project-task-list";
import Link from "next/link";
import { ChevronLeft, Activity, LayoutDashboard, Archive, LayoutList } from "lucide-react";

export async function generateMetadata({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  return { title: project ? `${project.name} Workspace – Billabled` : "Workspace – Billabled" };
}

export default async function ProjectBoardPage({ 
  params,
  searchParams,
}: { 
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireSession();
  const { projectId } = await params;
  const { tab = "board" } = await searchParams;
  
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project || project.workspaceId !== session.workspaceId) {
    redirect("/projects");
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#f6f3ee] p-4 text-slate-950 sm:p-8">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col">
        <Link href="/projects" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-500 transition-colors hover:text-cyan-700">
            <ChevronLeft className="h-4 w-4" /> All projects
        </Link>
        <header className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Project workspace</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{project.name}</h1>
                {project.status === "archived" && (
                   <span className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">
                      <Archive className="h-3.5 w-3.5" />
                      Archived
                   </span>
                )}
              </div>
              <p className="mt-2 max-w-2xl text-sm text-slate-500">Manage tasks, budget risk, project assets, and chronological activity in one focused workspace.</p>
            </div>
            <div className="flex items-center gap-3">
                <div className="hidden rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-sm font-bold text-slate-600 sm:block">
                    {project.billingModel === "hourly" ? "Hourly Billing" : "Fixed Fee"}
                </div>
                <ProjectActions projectId={project.id} status={project.status} />
            </div>
          </div>
        
          <ProjectFinancials projectId={project.id} />

          <div className="mt-8 flex items-center gap-3 border-t border-slate-100 pt-4">
            <Link 
                href={`?tab=board`} 
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-colors ${tab === "board" ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-950"}`}
            >
                <LayoutDashboard className="h-4 w-4" /> Board
            </Link>
            <Link 
                href={`?tab=list`} 
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-colors ${tab === "list" ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-950"}`}
            >
                <LayoutList className="h-4 w-4" /> Task list
            </Link>
            <Link 
                href={`?tab=activity`} 
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-colors ${tab === "activity" ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-950"}`}
            >
                <Activity className="h-4 w-4" /> Activity Feed
            </Link>
          </div>
        </header>

      <div className="mt-6 min-h-0 flex-1 overflow-hidden">
        {tab === "board" ? (
            <KanbanBoard projectId={project.id} />
        ) : tab === "list" ? (
            <div className="h-full overflow-y-auto rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
              <ProjectTaskList projectId={project.id} />
            </div>
        ) : (
            <div className="h-full max-w-4xl overflow-y-auto rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm lg:pr-6">
               <ActivityFeed projectId={project.id} />
            </div>
        )}
      </div>
      </div>
    </main>
  );
}
