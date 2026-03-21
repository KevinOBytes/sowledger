"use client";

import { useEffect, useState } from "react";
import { FolderKanban, Receipt, Download, Clock, Zap } from "lucide-react";

type ProjectAggregate = {
  id: string;
  name: string;
  percentComplete: number;
  totalHours: number;
};

type InvoiceRecord = {
  id: string;
  number: string;
  projectName: string;
  amount: number;
  status: string;
  dueDate?: string;
  createdAt: string;
};

export default function ClientDashboard() {
  const [projects, setProjects] = useState<ProjectAggregate[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch("/api/client");
        if (res.ok) {
          const data = await res.json();
          setProjects(data.projects || []);
          setInvoices(data.invoices || []);
        }
      } catch {
        // Handle error silently
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-500">
        <div className="flex flex-col items-center gap-3">
          <Zap className="h-8 w-8 animate-pulse text-cyan-500" />
          <p>Syncing workspace data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-12 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-extrabold tracking-tight text-white mb-3">Client Portal</h1>
        <p className="text-lg text-slate-400">Welcome back. Here is the latest progress and billing status for your active deployments.</p>
      </div>

      <div className="grid gap-8 lg:grid-cols-5">
        
        {/* Active Projects (Takes up 3/5 cols on large screens) */}
        <div className="lg:col-span-3 space-y-6">
          <div className="flex items-center gap-2 mb-2">
            <FolderKanban className="h-5 w-5 text-cyan-400" />
            <h2 className="text-xl font-bold text-white">Active Projects</h2>
          </div>
          
          {projects.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-12 text-center text-slate-500">
              <p>No active projects mapped to this workspace.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {projects.map((p) => (
                <div key={p.id} className="group flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl transition-all hover:border-cyan-500/50 hover:bg-slate-900">
                  <div className="mb-8">
                    <h3 className="text-lg font-bold text-white group-hover:text-cyan-400 transition-colors">{p.name}</h3>
                    <div className="mt-3 flex items-center gap-2 text-sm text-slate-400">
                      <Clock className="h-4 w-4" />
                      <span>{p.totalHours.toFixed(1)} hrs billed</span>
                    </div>
                  </div>
                  
                  <div>
                    <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-500">
                      <span>Progress</span>
                      <span className="text-emerald-400">{p.percentComplete}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                      <div 
                        className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-1000 ease-out" 
                        style={{ width: `${p.percentComplete}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Invoices (Takes up 2/5 cols on large screens) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center gap-2 mb-2">
            <Receipt className="h-5 w-5 text-emerald-400" />
            <h2 className="text-xl font-bold text-white">Invoices & Billing</h2>
          </div>

          {invoices.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-12 text-center text-slate-500">
              <p>No invoices have been issued yet.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/50 p-4 transition hover:bg-slate-800">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white">{inv.number}</span>
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {inv.status}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500">{inv.projectName}</span>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <span className="font-bold text-emerald-400">${inv.amount.toFixed(2)}</span>
                    <button 
                      onClick={() => window.print()}
                      className="rounded p-2 text-slate-500 hover:bg-slate-700 hover:text-white transition-colors"
                      title="Download PDF"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
