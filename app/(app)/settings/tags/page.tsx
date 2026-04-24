import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaceTags, projects as projectsTable } from "@/lib/db/schema";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { eq, desc } from "drizzle-orm";
import { TagsDataTable } from "@/components/tags-data-table";

export const metadata = { title: "Tags - Billabled" };

export default async function TagsSettingsPage() {
  const session = await requireSession();
  let tags: Array<{ id: string; name: string; color: string; projectId: string | null; isBillableDefault: boolean; status: "active" | "archived" }> = [];
  let projects: Array<{ id: string; name: string }> = [];
  let loadError: string | null = null;

  try {
    await ensureWorkspaceSchema();
    const rawTags = await db.select().from(workspaceTags).where(eq(workspaceTags.workspaceId, session.workspaceId)).orderBy(desc(workspaceTags.status), workspaceTags.name);
    tags = rawTags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color, projectId: tag.projectId, isBillableDefault: tag.isBillableDefault, status: tag.status }));
    const rawProjects = await db.select().from(projectsTable).where(eq(projectsTable.workspaceId, session.workspaceId));
    projects = rawProjects.map((project) => ({ id: project.id, name: project.name }));
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Unable to load tags right now.";
  }

  return (
    <main className="min-h-screen bg-[#f6f3ee] p-4 text-slate-950 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Settings</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Tags</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">Configure scoped tags, billable defaults, and colors so time entries stay searchable and exportable.</p>
          {!loadError && (
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-full bg-cyan-50 px-3 py-1 text-cyan-700">{tags.filter((tag) => tag.status === "active").length} active tags</span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{projects.length} project scopes</span>
            </div>
          )}
        </header>

        {loadError ? (
          <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-amber-900 shadow-sm">
            <h2 className="text-lg font-semibold">Tags are temporarily unavailable</h2>
            <p className="mt-2 text-sm">{loadError}</p>
          </div>
        ) : (
          <TagsDataTable initialTags={tags} projects={projects} />
        )}
      </div>
    </main>
  );
}
