"use client";

import { useEffect, useState } from "react";
import { Clock, Download, FolderKanban, Receipt, Zap } from "lucide-react";

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
        // Client portal should stay readable if a refresh fails.
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
          <Zap className="h-8 w-8 animate-pulse text-cyan-600" />
          <p>Syncing workspace data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="rounded-[32px] border border-stone-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Client portal</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">Progress and billing status</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">Review active project progress and issued invoices without needing the full internal workspace.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="space-y-4 lg:col-span-3">
          <div className="flex items-center gap-2">
            <FolderKanban className="h-5 w-5 text-cyan-700" />
            <h2 className="text-xl font-semibold">Active projects</h2>
          </div>
          {projects.length === 0 ? (
            <div className="rounded-[32px] border border-dashed border-stone-300 bg-white p-12 text-center text-slate-500 shadow-sm">
              No active projects mapped to this client portal yet.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {projects.map((project) => (
                <article key={project.id} className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm transition hover:border-cyan-200">
                  <h3 className="text-lg font-bold text-slate-950">{project.name}</h3>
                  <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                    <Clock className="h-4 w-4" />
                    <span>{project.totalHours.toFixed(1)} hrs billed</span>
                  </div>
                  <div className="mt-8">
                    <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
                      <span>Progress</span>
                      <span className="text-emerald-700">{project.percentComplete}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-1000 ease-out" style={{ width: `${project.percentComplete}%` }} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4 lg:col-span-2">
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-cyan-700" />
            <h2 className="text-xl font-semibold">Invoices and billing</h2>
          </div>
          {invoices.length === 0 ? (
            <div className="rounded-[32px] border border-dashed border-stone-300 bg-white p-12 text-center text-slate-500 shadow-sm">
              No invoices have been issued yet.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {invoices.map((invoice) => (
                <article key={invoice.id} className="flex items-center justify-between rounded-3xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-cyan-200">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-950">{invoice.number}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{invoice.status}</span>
                    </div>
                    <span className="mt-1 block truncate text-xs text-slate-500">{invoice.projectName}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-emerald-700">${invoice.amount.toFixed(2)}</span>
                    <button onClick={() => window.print()} className="rounded-xl border border-stone-200 p-2 text-slate-500 transition hover:border-cyan-200 hover:text-cyan-700" title="Download PDF">
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
