import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { clients as clientsTable, projects as projectsTable } from "@/lib/db/schema";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { eq, desc } from "drizzle-orm";
import { CreateClientButton } from "@/components/create-client-button";
import { ClientsPageClient } from "@/components/clients-page-client";

export const metadata = { title: "Clients – Billabled" };

export default async function ClientsPage() {
  const session = await requireSession();

  let clientsData: Array<{
    id: string;
    name: string;
    email: string | null;
    status: "active" | "archived";
  }> = [];
  let projectsData: Array<{ id: string; clientId: string | null }> = [];
  let loadError: string | null = null;

  try {
    await ensureWorkspaceSchema();

    clientsData = await db
      .select({
        id: clientsTable.id,
        name: clientsTable.name,
        email: clientsTable.email,
        status: clientsTable.status,
      })
      .from(clientsTable)
      .where(eq(clientsTable.workspaceId, session.workspaceId))
      .orderBy(desc(clientsTable.createdAt));

    // Fetch all projects to count association per client
    projectsData = await db
      .select({
        id: projectsTable.id,
        clientId: projectsTable.clientId,
      })
      .from(projectsTable)
      .where(eq(projectsTable.workspaceId, session.workspaceId));
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Unable to load clients right now.";
  }

  return (
    <main className="p-6 sm:p-10 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Clients</h1>
          <p className="mt-2 text-sm text-slate-400">Manage your clients and associated projects in one place.</p>
          {!loadError && (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 font-medium text-cyan-300">
                {clientsData.filter((client) => client.status === "active").length} Active
              </span>
              <span className="rounded-full border border-slate-700 bg-slate-800/70 px-3 py-1 font-medium text-slate-300">
                {projectsData.length} Linked Projects
              </span>
            </div>
          )}
        </div>
        <div className="shrink-0 flex items-start self-end sm:self-auto relative z-50">
          <CreateClientButton />
        </div>
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-amber-100">
          <h2 className="text-lg font-semibold">Clients are temporarily unavailable</h2>
          <p className="mt-2 text-sm text-amber-100/90">{loadError}</p>
        </div>
      ) : (
        <ClientsPageClient initialClients={clientsData} projects={projectsData} />
      )}
    </main>
  );
}
