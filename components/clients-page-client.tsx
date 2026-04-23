"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Building2Icon, Archive, FolderKanban, Edit2, CheckIcon, XIcon, Mail } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

type Client = {
  id: string;
  name: string;
  email: string | null;
  status: "active" | "archived";
};

type Project = {
  id: string;
  clientId: string | null;
};

export function ClientsPageClient({ initialClients, projects }: { initialClients: Client[], projects: Project[] }) {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>(initialClients);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");

  useEffect(() => {
    setClients(initialClients);
  }, [initialClients]);
  
  const activeClients = clients.filter(c => c.status === "active");
  const archivedClients = clients.filter(c => c.status === "archived");

  function startEdit(c: Client) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditEmail(c.email || "");
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    try {
      const res = await fetch(`/api/clients`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: id, name: editName.trim(), email: editEmail.trim() || undefined }),
      });
      if (res.ok) {
        setClients(clients.map(c => c.id === id ? { ...c, name: editName.trim(), email: editEmail.trim() || null } : c));
        setEditingId(null);
        router.refresh();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function toggleStatus(id: string, currentStatus: string) {
    try {
      const newStatus = currentStatus === "active" ? "archived" : "active";
      const res = await fetch(`/api/clients`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: id, status: newStatus }),
      });
      if (res.ok) {
        setClients(clients.map(c => c.id === id ? { ...c, status: newStatus } : c));
        router.refresh();
      }
    } catch (e) {
      console.error(e);
    }
  }

  const renderClient = (client: Client) => {
    const clientProjects = projects.filter(p => p.clientId === client.id);
    const isEditing = editingId === client.id;
    
    return (
      <motion.div 
        layout
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        key={client.id} 
        className={`group relative flex flex-col rounded-3xl border border-white/5 bg-[#0a0f1c]/80 backdrop-blur-3xl p-6 shadow-2xl transition-all duration-300 hover:bg-[#0f172a] hover:border-emerald-500/30 hover:shadow-emerald-900/10 ${client.status === 'archived' ? 'opacity-40 grayscale hover:opacity-100 hover:grayscale-0' : ''}`}
      >
        {/* Abstract background glow behind card */}
        <div className="absolute inset-0 -z-10 rounded-3xl bg-gradient-to-br from-emerald-500/0 via-transparent to-emerald-500/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        
        <div className="flex items-start justify-between z-10">
            <div className="flex items-start gap-4 flex-1 overflow-hidden">
                <div className="shrink-0 relative">
                    <div className="absolute inset-0 bg-emerald-500/20 blur-xl rounded-full scale-110 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="relative rounded-2xl bg-gradient-to-br from-emerald-400/10 to-emerald-600/10 p-3 border border-emerald-500/20 shadow-inner group-hover:shadow-emerald-500/20 transition-all">
                        <Building2Icon className="h-6 w-6 text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
                    </div>
                </div>
                <div className="flex-1 min-w-0 pr-2 pt-1">
                  {isEditing ? (
                    <div className="space-y-3 w-full bg-black/40 p-3 rounded-xl border border-white/10 shadow-inner">
                      <input 
                        type="text" 
                        title="Client Name"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Client Organization Name"
                        className="w-full bg-transparent border-b border-white/10 px-1 py-1.5 font-semibold text-white focus:outline-none focus:border-emerald-500 transition-colors"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(client.id); if (e.key === 'Escape') setEditingId(null); }}
                      />
                      <input 
                        type="email" 
                        title="Client Email"
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        placeholder="Billing Email (optional)"
                        className="w-full bg-transparent border-b border-white/10 px-1 py-1 text-sm text-slate-300 focus:outline-none focus:border-emerald-500 transition-colors"
                        onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(client.id); if (e.key === 'Escape') setEditingId(null); }}
                      />
                    </div>
                  ) : (
                    <>
                      <h3 className="text-xl font-bold tracking-tight text-white truncate transition-colors group-hover:text-emerald-300">{client.name}</h3>
                      {client.email ? (
                          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mt-1.5 truncate bg-black/20 w-fit px-2 py-0.5 rounded-full border border-white/5">
                             <Mail className="h-3 w-3 text-slate-500" />
                             {client.email}
                          </div>
                      ) : (
                          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 mt-1.5 truncate uppercase tracking-widest bg-black/20 w-fit px-2 py-0.5 rounded-full border border-white/5">
                             No Email Setup
                          </div>
                      )}
                    </>
                  )}
                </div>
            </div>
            
            <div className="flex items-center gap-1.5 shrink-0 z-10 pt-1">
              {isEditing ? (
                <>
                  <button onClick={() => saveEdit(client.id)} title="Save changes" className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-colors border border-emerald-500/30">
                    <CheckIcon className="h-4 w-4" />
                  </button>
                  <button onClick={() => setEditingId(null)} title="Cancel editing" className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors border border-white/5">
                    <XIcon className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 translate-x-2 group-hover:translate-x-0">
                  <button title="Edit Client" onClick={() => startEdit(client)} className="p-2 rounded-xl text-slate-400 hover:bg-white/10 hover:text-white transition-colors border border-transparent hover:border-white/5">
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button 
                    title={client.status === "active" ? "Archive Client" : "Restore Client"}
                    onClick={() => toggleStatus(client.id, client.status)} 
                    className="p-2 rounded-xl text-slate-400 hover:bg-white/10 hover:text-white transition-colors border border-transparent hover:border-white/5"
                  >
                    {client.status === "active" ? <Archive className="h-4 w-4" /> : <CheckIcon className="h-4 w-4" />}
                  </button>
                </div>
              )}
            </div>
        </div>
        
        <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between text-sm z-10 relative">
            <div className="flex items-center gap-2 text-slate-400 bg-slate-900/50 px-3 py-1.5 rounded-lg border border-white/5 shadow-inner">
                <FolderKanban className="h-4 w-4 text-emerald-500/70" />
                <span className="font-medium text-slate-300">{clientProjects.length}</span> Project{clientProjects.length !== 1 ? 's' : ''}
            </div>
            <Link href={`/projects?client=${client.id}`} className="text-emerald-400 font-semibold hover:text-emerald-300 transition-all flex items-center gap-1.5 text-xs bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg border border-emerald-500/20 hover:border-emerald-500/40">
                View Pipeline &rarr;
            </Link>
        </div>
      </motion.div>
    );
  };

  return (
    <>
      {clients.length === 0 ? (
        <AnimatePresence mode="popLayout">
            <motion.div 
               initial={{ opacity: 0, scale: 0.95 }}
               animate={{ opacity: 1, scale: 1 }}
               className="relative rounded-3xl border border-white/5 bg-[#0a0f1c]/50 backdrop-blur-md p-20 text-center flex flex-col items-center shadow-2xl overflow-hidden"
            >
                <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 to-transparent blur-3xl -z-10" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-64 w-64 bg-emerald-500/10 rounded-full blur-[100px] -z-10" />
                
                <div className="relative mb-6">
                    <div className="absolute inset-0 bg-emerald-500/20 blur-2xl rounded-full scale-150" />
                    <div className="relative flex h-24 w-24 items-center justify-center rounded-[2rem] bg-slate-800/60 border border-white/10 shadow-inner">
                        <Building2Icon className="w-12 h-12 text-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.5)]" />
                    </div>
                </div>
                
                <h3 className="text-2xl font-bold tracking-tight text-white">The Client Roster is Empty</h3>
                <p className="text-slate-400 mt-3 max-w-md text-sm leading-relaxed">
                    Clients are the top-level entity for organizing your projects. Add your first client to start structuring your workflow and billing pipelines.
                </p>
            </motion.div>
        </AnimatePresence>
      ) : (
        <div className="space-y-12">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <AnimatePresence mode="popLayout">
              {activeClients.map(renderClient)}
            </AnimatePresence>
          </div>

          {archivedClients.length > 0 && (
            <div className="space-y-6 pt-6 border-t border-white/5 relative">
              <div className="absolute top-0 left-0 hover:bg-slate-800/50 p-2 rounded-lg transition">
                 <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <Archive className="h-3 w-3" /> Archived Entities
                 </h3>
              </div>
              <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <AnimatePresence mode="popLayout">
                  {archivedClients.map(renderClient)}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
