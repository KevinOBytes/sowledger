import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaceTags, projects as projectsTable } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { TagsDataTable } from "@/components/tags-data-table";

export const metadata = { title: "Tag Settings – Billabled" };

export default async function TagsSettingsPage() {
  const session = await requireSession();
  
  const tags = await db.select().from(workspaceTags).where(eq(workspaceTags.workspaceId, session.workspaceId)).orderBy(desc(workspaceTags.status), workspaceTags.name);
  const projects = await db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.workspaceId, session.workspaceId));

  return (
    <main className="p-6 sm:p-10 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Tags Configuration</h2>
          <p className="mt-2 text-sm text-slate-400">
            Configure unified tagging for tracking across projects. Assign billable defaults, scoped projects, and custom colors.
          </p>
        </div>
      </div>

      <div className="space-y-6">
         <TagsDataTable initialTags={tags} projects={projects} />
      </div>
    </main>
  );
}
