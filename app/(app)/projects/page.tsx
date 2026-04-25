import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { projects as projectsTable, projectTasks as tasksTable } from "@/lib/db/schema";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Archive, FolderKanban, LayoutList, ArrowRight } from "lucide-react";
import { CreateProjectButton } from "@/components/create-project-button";

export const metadata = { title: "Projects - Billabled" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams?: Promise<{ client?: string }>;
}) {
  const session = await requireSession();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const clientFilter = resolvedSearchParams?.client || null;

  let projects: Array<{
    id: string;
    name: string;
    status: "active" | "archived";
    billingModel: "hourly" | "fixed_fee" | "hybrid";
    percentComplete: number;
  }> = [];
  let tasks: Array<{ id: string; projectId: string; status: "todo" | "in_progress" | "review" | "done"; parentId: string | null }> = [];
  let loadError: string | null = null;

  try {
    await ensureWorkspaceSchema();
    const rawProjects = await db
      .select()
      .from(projectsTable)
      .where(clientFilter ? and(eq(projectsTable.workspaceId, session.workspaceId), eq(projectsTable.clientId, clientFilter)) : eq(projectsTable.workspaceId, session.workspaceId))
      .orderBy(desc(projectsTable.createdAt));
    projects = rawProjects.map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
      billingModel: project.billingModel,
      percentComplete: project.percentComplete || 0,
    }));
    const rawTasks = await db.select().from(tasksTable).where(eq(tasksTable.workspaceId, session.workspaceId));
    tasks = rawTasks.map((task) => ({ id: task.id, projectId: task.projectId, status: task.status, parentId: task.parentId }));
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Unable to load projects right now.";
  }

  const activeCount = projects.filter((project) => project.status === "active").length;
  const archivedCount = projects.filter((project) => project.status === "archived").length;

  return (
    <main className="min-h-screen bg-[#f6f3ee] p-4 text-slate-950 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Manage</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Projects</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-500">Organize client work, tasks, budgets, and logged time into clear delivery pipelines.</p>
            </div>
            <CreateProjectButton />
          </div>
          {!loadError && (
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-full bg-cyan-50 px-3 py-1 text-cyan-700">{activeCount} active</span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{archivedCount} archived</span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{tasks.length} tasks</span>
              {clientFilter && <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">filtered to client</span>}
            </div>
          )}
        </header>

        {loadError ? (
          <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-amber-900 shadow-sm">
            <h2 className="text-lg font-semibold">Projects are temporarily unavailable</h2>
            <p className="mt-2 text-sm">{loadError}</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-[32px] border border-dashed border-slate-300 bg-white p-16 text-center shadow-sm">
            <FolderKanban className="mx-auto mb-4 h-14 w-14 text-slate-300" />
            <h3 className="text-xl font-semibold text-slate-950">No active projects</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">Create your first project to connect schedules, timers, manual logs, analytics, and exports.</p>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => {
              const projectTasks = tasks.filter((task) => task.projectId === project.id);
              const doneTasks = projectTasks.filter((task) => task.status === "done" && !task.parentId);
              const progress = projectTasks.length ? Math.round((doneTasks.length / projectTasks.length) * 100) : project.percentComplete;
              return (
                <article key={project.id} className={`group rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-cyan-200 hover:shadow-md ${project.status === "archived" ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <Link href={`/projects/${project.id}`} className="text-xl font-semibold text-slate-950 transition group-hover:text-cyan-700">
                          {project.name}
                        </Link>
                        {project.status === "archived" && <Archive className="h-4 w-4 text-slate-400" />}
                      </div>
                      <p className="mt-2 text-sm text-slate-500">{projectTasks.length} task{projectTasks.length === 1 ? "" : "s"} ready across board and list views.</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">{project.billingModel}</span>
                  </div>
                  <div className="mt-8">
                    <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-500"><span>Progress</span><span>{progress}%</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-cyan-600" style={{ width: `${progress}%` }} /></div>
                  </div>
                  <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Choose a workspace view</p>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/projects/${project.id}?tab=board`} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-3 py-2 text-sm font-bold text-white transition hover:bg-slate-800">
                        <FolderKanban className="h-4 w-4" />
                        Open board
                      </Link>
                      <Link href={`/projects/${project.id}?tab=list`} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:border-cyan-200 hover:text-cyan-700">
                        <LayoutList className="h-4 w-4" />
                        Task list
                      </Link>
                      <Link href={`/projects/${project.id}`} className="inline-flex items-center gap-1 text-sm font-bold text-slate-500 transition hover:text-cyan-700">
                        Open workspace
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
