import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { clients as clientsTable, projects as projectsTable } from "@/lib/db/schema";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { eq, desc } from "drizzle-orm";
import { CreateClientButton } from "@/components/create-client-button";
import { ClientsPageClient } from "@/components/clients-page-client";

export const metadata = { title: "Clients - Billabled" };

export default async function ClientsPage() {
  const session = await requireSession();
  let clientsData: Array<{ id: string; name: string; email: string | null; status: "active" | "archived" }> = [];
  let projectsData: Array<{ id: string; clientId: string | null }> = [];
  let loadError: string | null = null;

  try {
    await ensureWorkspaceSchema();
    clientsData = await db.select({ id: clientsTable.id, name: clientsTable.name, email: clientsTable.email, status: clientsTable.status }).from(clientsTable).where(eq(clientsTable.workspaceId, session.workspaceId)).orderBy(desc(clientsTable.createdAt));
    projectsData = await db.select({ id: projectsTable.id, clientId: projectsTable.clientId }).from(projectsTable).where(eq(projectsTable.workspaceId, session.workspaceId));
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Unable to load clients right now.";
  }

  return (
    <main className="min-h-screen bg-[#f6f3ee] p-4 text-slate-950 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Manage</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Clients</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-500">Keep client records connected to projects, billing, and export-ready time history.</p>
            </div>
            <CreateClientButton />
          </div>
          {!loadError && (
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-full bg-cyan-50 px-3 py-1 text-cyan-700">{clientsData.filter((client) => client.status === "active").length} active</span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{projectsData.length} linked projects</span>
            </div>
          )}
        </header>
        {loadError ? (
          <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-amber-900 shadow-sm">
            <h2 className="text-lg font-semibold">Clients are temporarily unavailable</h2>
            <p className="mt-2 text-sm">{loadError}</p>
          </div>
        ) : (
          <ClientsPageClient initialClients={clientsData} projects={projectsData} />
        )}
      </div>
    </main>
  );
}
