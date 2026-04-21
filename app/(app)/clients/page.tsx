import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { clients as clientsTable, projects as projectsTable } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { CreateClientButton } from "@/components/create-client-button";
import { ClientsPageClient } from "@/components/clients-page-client";

export const metadata = { title: "Clients – Billabled" };

export default async function ClientsPage() {
  const session = await requireSession();
  
  const clientsData = await db.select({
    id: clientsTable.id,
    name: clientsTable.name,
    email: clientsTable.email,
    status: clientsTable.status,
  }).from(clientsTable).where(eq(clientsTable.workspaceId, session.workspaceId)).orderBy(desc(clientsTable.createdAt));
    
  // Fetch all projects to count association per client
  const projectsData = await db.select({
    id: projectsTable.id,
    clientId: projectsTable.clientId,
  }).from(projectsTable).where(eq(projectsTable.workspaceId, session.workspaceId));

  return (
    <main className="p-6 sm:p-10 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Clients</h1>
          <p className="mt-2 text-sm text-slate-400">Manage your clients and associated projects in one place.</p>
        </div>
        <div className="shrink-0 flex items-start self-end sm:self-auto relative z-50">
          <CreateClientButton />
        </div>
      </div>

      <ClientsPageClient initialClients={clientsData as any} projects={projectsData as any} />
    </main>
  );
}
