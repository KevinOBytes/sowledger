"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, Download, FolderKanban, Receipt, ShieldCheck, Zap } from "lucide-react";

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
  digest?: string;
  signedOffAt?: string;
};

async function digestForInvoice(invoiceId: string) {
  try {
    const response = await fetch(`/api/invoices/${invoiceId}/proof-pack`);
    if (!response.ok) return null;
    const data = await response.json().catch(() => ({}));
    return typeof data.digest === "string" ? data.digest : response.headers.get("x-sowledger-proof-sha256");
  } catch {
    return null;
  }
}

export default function ClientDashboard() {
  const [projects, setProjects] = useState<ProjectAggregate[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvedInvoiceIds, setApprovedInvoiceIds] = useState<Set<string>>(new Set());
  const [signingInvoiceId, setSigningInvoiceId] = useState<string | null>(null);
  const [signoffErrors, setSignoffErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch("/api/client");
        if (res.ok) {
          const data = await res.json();
          setProjects(data.projects || []);
          const nextInvoices: InvoiceRecord[] = await Promise.all((data.invoices || []).map(async (invoice: InvoiceRecord) => ({
            ...invoice,
            digest: invoice.digest || await digestForInvoice(invoice.id) || undefined,
          })));
          setInvoices(nextInvoices);
          setApprovedInvoiceIds((current) => {
            const next = new Set(current);
            nextInvoices.forEach((invoice) => {
              const status = invoice.status.toLowerCase();
              if (status === "approved" || status === "signed" || status === "paid" || invoice.signedOffAt) {
                next.add(invoice.id);
              }
            });
            return next;
          });
        }
      } catch {
        // Client portal should stay readable if a refresh fails.
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  async function approveProof(invoiceId: string) {
    setSigningInvoiceId(invoiceId);
    setSignoffErrors((current) => {
      const next = { ...current };
      delete next[invoiceId];
      return next;
    });
    try {
      const res = await fetch("/api/client/signoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not approve proof");
      setApprovedInvoiceIds((current) => new Set(current).add(invoiceId));
    } catch (error) {
      setSignoffErrors((current) => ({
        ...current,
        [invoiceId]: error instanceof Error ? error.message : "Could not approve proof",
      }));
    } finally {
      setSigningInvoiceId(null);
    }
  }

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
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">Progress and approval-ready proof</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">Review project progress and approve invoice proof packets without needing the full internal workspace.</p>
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
            <h2 className="text-xl font-semibold">Proof packets</h2>
          </div>
          {invoices.length === 0 ? (
            <div className="rounded-[32px] border border-dashed border-stone-300 bg-white p-12 text-center text-slate-500 shadow-sm">
              No approval-ready proof packets have been issued yet.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {invoices.map((invoice) => {
                const approved = approvedInvoiceIds.has(invoice.id);
                return (
                  <article key={invoice.id} className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-cyan-200">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-slate-950">{invoice.number}</span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{invoice.status}</span>
                          {approved && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" />
                              Approved
                            </span>
                          )}
                        </div>
                        <span className="mt-1 block truncate text-xs text-slate-500">{invoice.projectName}</span>
                        <p className="mt-2 text-sm text-slate-500">
                          Proof packet total: <span className="font-bold text-emerald-700">${invoice.amount.toFixed(2)}</span>
                        </p>
                        {invoice.digest && <p className="mt-2 break-all font-mono text-[11px] text-slate-400">Digest: {invoice.digest}</p>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <button
                          onClick={() => approveProof(invoice.id)}
                          disabled={approved || signingInvoiceId === invoice.id}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-emerald-600"
                        >
                          <ShieldCheck className="h-4 w-4" />
                          {approved ? "Proof approved" : signingInvoiceId === invoice.id ? "Approving..." : "Approve proof"}
                        </button>
                        <button onClick={() => window.print()} className="rounded-xl border border-stone-200 p-2 text-slate-500 transition hover:border-cyan-200 hover:text-cyan-700" title="Download PDF">
                          <Download className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {signoffErrors[invoice.id] && (
                      <div className="mt-3 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{signoffErrors[invoice.id]}</span>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
