"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, Building2Icon, CheckIcon, Edit2, Mail, XIcon } from "lucide-react";

type Client = { id: string; name: string; email: string | null; status: "active" | "archived" };
type Project = { id: string; clientId: string | null };

export function ClientsPageClient({ initialClients, projects }: { initialClients: Client[]; projects: Project[] }) {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>(initialClients);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => setClients(initialClients), 0);
    return () => window.clearTimeout(timeout);
  }, [initialClients]);

  function startEdit(client: Client) {
    setEditingId(client.id);
    setEditName(client.name);
    setEditEmail(client.email || "");
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    const res = await fetch("/api/clients", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: id, name: editName.trim(), email: editEmail.trim() || undefined }),
    });
    if (res.ok) {
      setClients((current) => current.map((client) => client.id === id ? { ...client, name: editName.trim(), email: editEmail.trim() || null } : client));
      setEditingId(null);
      router.refresh();
    }
  }

  async function toggleStatus(id: string, currentStatus: Client["status"]) {
    const status = currentStatus === "active" ? "archived" : "active";
    const res = await fetch("/api/clients", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: id, status }),
    });
    if (res.ok) {
      setClients((current) => current.map((client) => client.id === id ? { ...client, status } : client));
      router.refresh();
    }
  }

  const activeClients = clients.filter((client) => client.status === "active");
  const archivedClients = clients.filter((client) => client.status === "archived");

  function renderClient(client: Client) {
    const clientProjects = projects.filter((project) => project.clientId === client.id);
    const isEditing = editingId === client.id;
    return (
      <article key={client.id} className={`rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-cyan-200 hover:shadow-md ${client.status === "archived" ? "opacity-60" : ""}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <div className="rounded-2xl bg-cyan-50 p-3 text-cyan-700"><Building2Icon className="h-6 w-6" /></div>
            <div className="min-w-0">
              {isEditing ? (
                <div className="space-y-2">
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-cyan-500" autoFocus onKeyDown={(e) => { if (e.key === "Enter") saveEdit(client.id); if (e.key === "Escape") setEditingId(null); }} />
                  <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500" onKeyDown={(e) => { if (e.key === "Enter") saveEdit(client.id); if (e.key === "Escape") setEditingId(null); }} />
                </div>
              ) : (
                <>
                  <h3 className="truncate text-xl font-semibold text-slate-950">{client.name}</h3>
                  <p className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-500">
                    <Mail className="h-3 w-3" />
                    <span className="truncate">{client.email || "No billing email"}</span>
                  </p>
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            {isEditing ? (
              <>
                <button onClick={() => saveEdit(client.id)} title="Save changes" className="rounded-xl bg-emerald-50 p-2 text-emerald-700 hover:bg-emerald-100"><CheckIcon className="h-4 w-4" /></button>
                <button onClick={() => setEditingId(null)} title="Cancel editing" className="rounded-xl bg-slate-50 p-2 text-slate-500 hover:bg-slate-100"><XIcon className="h-4 w-4" /></button>
              </>
            ) : (
              <>
                <button title="Edit Client" onClick={() => startEdit(client)} className="rounded-xl bg-slate-50 p-2 text-slate-500 hover:bg-cyan-50 hover:text-cyan-700"><Edit2 className="h-4 w-4" /></button>
                <button title={client.status === "active" ? "Archive Client" : "Restore Client"} onClick={() => toggleStatus(client.id, client.status)} className="rounded-xl bg-slate-50 p-2 text-slate-500 hover:bg-cyan-50 hover:text-cyan-700"><Archive className="h-4 w-4" /></button>
              </>
            )}
          </div>
        </div>
        <div className="mt-7 flex items-center justify-between border-t border-slate-100 pt-5 text-sm">
          <span className="font-semibold text-slate-500">{clientProjects.length} project{clientProjects.length === 1 ? "" : "s"}</span>
          <Link href={`/projects?client=${client.id}`} className="font-bold text-cyan-700 hover:text-cyan-600">View pipeline</Link>
        </div>
      </article>
    );
  }

  if (clients.length === 0) {
    return (
      <div className="rounded-[32px] border border-dashed border-slate-300 bg-white p-16 text-center shadow-sm">
        <Building2Icon className="mx-auto mb-4 h-14 w-14 text-slate-300" />
        <h3 className="text-xl font-semibold text-slate-950">No clients yet</h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">Add clients to group projects, invoices, time history, and exports by customer.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{activeClients.map(renderClient)}</div>
      {archivedClients.length > 0 && (
        <section className="space-y-4 border-t border-slate-200 pt-6">
          <h2 className="text-sm font-bold uppercase tracking-[0.25em] text-slate-400">Archived clients</h2>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{archivedClients.map(renderClient)}</div>
        </section>
      )}
    </div>
  );
}
