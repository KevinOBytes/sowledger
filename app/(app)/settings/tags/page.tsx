import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaceTags, projects as projectsTable } from "@/lib/db/schema";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { eq, desc } from "drizzle-orm";
import { TagsDataTable } from "@/components/tags-data-table";

export const metadata = { title: "Tag Settings – Billabled" };

export default async function TagsSettingsPage() {
  const session = await requireSession();

  let tags: Array<{
    id: string;
    name: string;
    color: string;
    projectId: string | null;
    isBillableDefault: boolean;
    status: "active" | "archived";
  }> = [];
  let projects: Array<{ id: string; name: string }> = [];
  let loadError: string | null = null;

  try {
    await ensureWorkspaceSchema();

    const rawTags = await db
      .select()
      .from(workspaceTags)
      .where(eq(workspaceTags.workspaceId, session.workspaceId))
      .orderBy(desc(workspaceTags.status), workspaceTags.name);
    tags = rawTags.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      projectId: t.projectId,
      isBillableDefault: t.isBillableDefault,
      status: t.status,
    }));

    const rawProjects = await db.select().from(projectsTable).where(eq(projectsTable.workspaceId, session.workspaceId));
    projects = rawProjects.map((p) => ({
      id: p.id,
      name: p.name,
    }));
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Unable to load tags right now.";
  }

  return (
    <main className="p-6 sm:p-10 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Tags Configuration</h2>
          <p className="mt-2 text-sm text-slate-400">
            Configure unified tagging for tracking across projects. Assign billable defaults, scoped projects, and custom colors.
          </p>
          {!loadError && (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 font-medium text-cyan-300">
                {tags.filter((tag) => tag.status === "active").length} Active Tags
              </span>
              <span className="rounded-full border border-slate-700 bg-slate-800/70 px-3 py-1 font-medium text-slate-300">
                {projects.length} Project Scopes
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {loadError ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-amber-100">
            <h2 className="text-lg font-semibold">Tags are temporarily unavailable</h2>
            <p className="mt-2 text-sm text-amber-100/90">{loadError}</p>
          </div>
        ) : (
          <TagsDataTable initialTags={tags} projects={projects} />
        )}
      </div>
    </main>
  );
}
