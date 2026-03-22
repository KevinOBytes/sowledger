import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { projects as projectsTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { KanbanBoard } from "@/components/kanban-board";
import { ActivityFeed } from "@/components/activity-feed";
import Link from "next/link";
import { ChevronLeft, Activity, LayoutDashboard } from "lucide-react";

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
    <main className="flex h-screen flex-col bg-[#050914] p-6 sm:p-10">
      <div className="mb-2">
        <Link href="/projects" className="inline-flex items-center gap-2 text-sm font-medium text-slate-400 hover:text-cyan-400 transition-colors mb-4">
            <ChevronLeft className="h-4 w-4" /> All Projects
        </Link>
        <div className="flex items-center justify-between">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-white">{project.name}</h1>
                <p className="mt-2 text-sm text-slate-400">Manage tasks across execution stages and review chronological activity.</p>
            </div>
            <div className="hidden sm:flex items-center gap-4">
                <div className="rounded-full border border-white/5 bg-white/5 px-4 py-1.5 text-sm font-medium text-slate-300">
                    {project.billingModel === "hourly" ? "Hourly Billing" : "Fixed Fee"}
                </div>
            </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-6 mt-8 border-b border-white/10 px-2">
            <Link 
                href={`?tab=board`} 
                className={`flex items-center gap-2 pb-3 font-medium transition-colors ${tab === 'board' ? 'border-b-2 border-cyan-400 text-cyan-400' : 'text-slate-400 hover:text-slate-200 border-b-2 border-transparent'}`}
            >
                <LayoutDashboard className="h-4 w-4" /> Board
            </Link>
            <Link 
                href={`?tab=activity`} 
                className={`flex items-center gap-2 pb-3 font-medium transition-colors ${tab === 'activity' ? 'border-b-2 border-cyan-400 text-cyan-400' : 'text-slate-400 hover:text-slate-200 border-b-2 border-transparent'}`}
            >
                <Activity className="h-4 w-4" /> Activity Feed
            </Link>
        </div>
      </div>

      {/* Dynamic Tab Content */}
      <div className="flex-1 overflow-hidden mt-6">
        {tab === "board" ? (
            <KanbanBoard projectId={project.id} />
        ) : (
            <div className="h-full overflow-y-auto lg:pr-4 max-w-4xl">
               <ActivityFeed projectId={project.id} />
            </div>
        )}
      </div>
    </main>
  );
}
