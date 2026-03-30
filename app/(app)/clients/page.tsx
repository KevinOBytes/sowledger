import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { clients as clientsTable, projects as projectsTable } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import Link from "next/link";
import { Building2Icon, Archive, FolderKanban } from "lucide-react";
import { CreateClientButton } from "@/components/create-client-button";

export const metadata = { title: "Clients – Billabled" };

export default async function ClientsPage() {
  const session = await requireSession();
  
  const clients = await db.select().from(clientsTable).where(eq(clientsTable.workspaceId, session.workspaceId)).orderBy(desc(clientsTable.createdAt));
    
  // Fetch all projects to count association per client
  const projects = await db.select().from(projectsTable).where(eq(projectsTable.workspaceId, session.workspaceId));

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

      {clients.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-16 text-center flex flex-col items-center">
            <Building2Icon className="w-16 h-16 text-slate-700 mb-4" />
            <h3 className="text-xl font-medium text-white">No active clients</h3>
            <p className="text-slate-400 mt-2 max-w-md">Clients organize your projects around billable entities. Add a client to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {clients.map(client => {
            const clientProjects = projects.filter(p => p.clientId === client.id);
            return (
              <div 
                key={client.id} 
                className={`group relative flex flex-col rounded-2xl border border-white/5 bg-[#0a0f1c] p-6 shadow-xl transition-all hover:bg-[#0c1222] hover:border-emerald-500/30 ${client.status === 'archived' ? 'opacity-50 grayscale hover:opacity-80 hover:grayscale-0' : ''}`}
              >
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-emerald-500/10 p-2 border border-emerald-500/20">
                            <Building2Icon className="h-6 w-6 text-emerald-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-white group-hover:text-emerald-400 transition-colors">{client.name}</h3>
                            {client.email && <p className="text-xs text-slate-400 mt-0.5">{client.email}</p>}
                        </div>
                    </div>
                    {client.status === "archived" && <Archive className="h-4 w-4 text-slate-500" />}
                </div>
                
                <div className="mt-6 pt-6 border-t border-white/5 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 text-slate-400">
                        <FolderKanban className="h-4 w-4" />
                        {clientProjects.length} Projects
                    </div>
                    <Link href={`/projects?client=${client.id}`} className="text-emerald-400 font-medium hover:text-emerald-300 transition flex items-center gap-1 text-xs">
                        View Projects &rarr;
                    </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </main>
  );
}
