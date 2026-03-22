import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { projects as projectsTable, projectTasks as tasksTable } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import Link from "next/link";
import { FolderKanban, Archive } from "lucide-react";
import { CreateProjectButton } from "@/components/create-project-button";

export const metadata = { title: "Projects – Billabled" };

export default async function ProjectsPage() {
  const session = await requireSession();
  
  const projects = await db.select().from(projectsTable).where(eq(projectsTable.workspaceId, session.workspaceId)).orderBy(desc(projectsTable.createdAt));
    
  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.workspaceId, session.workspaceId));

  return (
    <main className="p-6 sm:p-10 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Projects Pipeline</h1>
          <p className="mt-2 text-sm text-slate-400">Select a project to view its Kanban board and tasks.</p>
        </div>
        <div className="shrink-0 flex items-start self-end sm:self-auto relative z-50">
          <CreateProjectButton />
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-16 text-center flex flex-col items-center">
            <FolderKanban className="w-16 h-16 text-slate-700 mb-4" />
            <h3 className="text-xl font-medium text-white">No active projects</h3>
            <p className="text-slate-400 mt-2 max-w-md">Projects help you organize time entries and tasks. Create your first project by clicking the button above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map(proj => {
            const projTasks = tasks.filter(t => t.projectId === proj.id);
            const doneTasks = projTasks.filter(t => t.status === "done" && !t.parentId); // Only count top-level completions perhaps? Actually all is fine.
            const progress = projTasks.length ? Math.round((doneTasks.length / projTasks.length) * 100) : proj.percentComplete;
            return (
              <Link 
                key={proj.id} 
                href={`/projects/${proj.id}`} 
                className={`group relative flex flex-col rounded-2xl border border-white/5 bg-gradient-to-b from-white/[0.03] to-transparent p-6 shadow-xl transition-all hover:bg-white/[0.05] hover:border-cyan-500/30 ${proj.status === 'archived' ? 'opacity-50 grayscale hover:opacity-80 hover:grayscale-0' : ''}`}
              >
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-white group-hover:text-cyan-400 transition-colors">{proj.name}</h3>
                        {proj.status === "archived" && <Archive className="h-4 w-4 text-slate-500" />}
                    </div>
                    <div className="rounded-full bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-300">
                        {proj.billingModel}
                    </div>
                </div>
                
                <p className="mt-2 text-sm text-slate-400">{projTasks.length} total tasks</p>
                
                <div className="mt-auto pt-6">
                    <div className="flex items-center justify-between text-xs font-medium text-slate-400 mb-2">
                        <span>Project Progress</span>
                        <span className={progress === 100 ? "text-emerald-400" : ""}>{progress}%</span>
                    </div>
                    <div className="h-2 w-full bg-slate-800/50 rounded-full overflow-hidden">
                        <div 
                           className={`h-full rounded-full transition-all duration-500 ${progress === 100 ? "bg-emerald-500" : "bg-gradient-to-r from-cyan-500 to-indigo-500"}`} 
                           style={{ width: `${progress}%` }} 
                        />
                    </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </main>
  );
}
