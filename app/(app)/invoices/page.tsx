"use client";

import { useEffect, useState } from "react";
import { DollarSign, Download, FileText, Receipt } from "lucide-react";
import { toast } from "sonner";

type InvoiceRecord = {
  id: string;
  number: string;
  projectName: string;
  amount: number;
  status: string;
  dueDate?: string;
  createdAt: string;
};

type BillableEntry = {
  id: string;
  userEmail: string;
  projectName: string;
  description: string;
  startedAt: string;
  durationSeconds: number;
  hourlyRate: number;
  amount: number;
};

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [billables, setBillables] = useState<BillableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [requiresUpgrade, setRequiresUpgrade] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      const res = await fetch("/api/invoices");
      if (res.ok) {
        const data = await res.json();
        setInvoices(data.invoices || []);
        setBillables(data.billableEntries || []);
      } else if (res.status === 402) {
        setRequiresUpgrade(true);
      }
    } catch {
      // The visible page state stays useful; toast noise here would repeat on refresh.
    } finally {
      setLoading(false);
    }
  }

  function toggleSelection(id: string) {
    const updated = new Set(selectedEntries);
    if (updated.has(id)) updated.delete(id);
    else updated.add(id);
    setSelectedEntries(updated);
  }

  async function handleGenerateInvoice() {
    if (selectedEntries.size === 0) return;
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeEntryIds: Array.from(selectedEntries) }),
      });
      if (res.ok) {
        setSelectedEntries(new Set());
        await fetchData();
        toast.success("Invoice generated");
      } else {
        const data = await res.json();
        toast.error("Could not generate invoice", { description: data.error });
      }
    } catch {
      toast.error("Could not generate invoice");
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f6f3ee] p-8 text-slate-500">
        <div className="flex flex-col items-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-t-2 border-cyan-500" />
          <p>Tallying financials...</p>
        </div>
      </main>
    );
  }

  if (requiresUpgrade) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#f6f3ee] p-8">
        <div className="max-w-md rounded-[32px] border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-50">
            <Receipt className="h-8 w-8 text-cyan-700" />
          </div>
          <h2 className="mb-3 text-2xl font-bold text-slate-950">Invoicing is a Starter feature</h2>
          <p className="mb-8 text-slate-500">
            Move to Starter for $9/workspace/month to turn approved billable time into invoices and exports.
          </p>
          <a href="/settings/billing" className="inline-flex rounded-xl bg-cyan-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-cyan-500">
            Move to Starter
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f3ee] p-4 text-slate-950 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Output</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Invoicing</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-500">Turn approved billable time into invoice records, then print or export supporting detail.</p>
            </div>
            <button
              onClick={handleGenerateInvoice}
              disabled={selectedEntries.size === 0}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Receipt className="h-4 w-4" />
              Generate invoice ({selectedEntries.size})
            </button>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              <DollarSign className="h-5 w-5 text-emerald-600" />
              Approved Billables Pipeline
            </h2>
            <p className="mt-2 text-sm text-slate-500">Select approved entries to create the next invoice.</p>
            <div className="mt-5 space-y-3">
              {billables.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  No approved billables awaiting invoice.
                </div>
              ) : billables.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  onClick={() => toggleSelection(entry.id)}
                  className={`w-full rounded-3xl border p-4 text-left transition ${selectedEntries.has(entry.id) ? "border-cyan-300 bg-cyan-50" : "border-slate-200 bg-slate-50 hover:border-cyan-200 hover:bg-cyan-50/50"}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-950">{entry.projectName}</p>
                      <p className="mt-1 text-xs text-slate-500">{entry.description || "No description provided"}</p>
                      <p className="mt-2 text-xs text-slate-400">{entry.userEmail}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-bold text-emerald-700">${entry.amount.toFixed(2)}</p>
                      <p className="text-xs text-slate-500">{(entry.durationSeconds / 3600).toFixed(1)} hrs x ${entry.hourlyRate}/hr</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              <FileText className="h-5 w-5 text-cyan-700" />
              Issued invoices
            </h2>
            <p className="mt-2 text-sm text-slate-500">Keep generated invoice records easy to find.</p>
            <div className="mt-5 space-y-3">
              {invoices.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  No invoices generated yet.
                </div>
              ) : invoices.map((invoice) => (
                <article key={invoice.id} className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-950">{invoice.number}</span>
                      <span className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">{invoice.status}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">Amount due: <span className="font-semibold text-slate-950">${invoice.amount.toFixed(2)}</span></p>
                  </div>
                  <button onClick={() => window.print()} className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-cyan-200 hover:text-cyan-700">
                    <Download className="h-4 w-4" />
                    Print PDF
                  </button>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
