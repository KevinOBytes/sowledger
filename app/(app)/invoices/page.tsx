"use client";

import { useEffect, useState } from "react";
import { Receipt, FileText, DollarSign, Download } from "lucide-react";

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
      // Handle network issue
    } finally {
      setLoading(false);
    }
  }

  function toggleSelection(id: string) {
    const updated = new Set(selectedEntries);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
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
        fetchData(); // reload
      } else {
        const data = await res.json();
        alert(`Failed: ${data.error}`);
      }
    } catch {
      alert("Failed to generate invoice.");
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-slate-400">
        <div className="flex flex-col items-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-t-2 border-cyan-500"></div>
          <p>Tallying financials...</p>
        </div>
      </div>
    );
  }

  if (requiresUpgrade) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-900/30">
            <Receipt className="h-8 w-8 text-cyan-400" />
          </div>
          <h2 className="mb-3 text-2xl font-bold text-white">Invoicing is a Pro feature</h2>
          <p className="mb-8 text-slate-400">
            Upgrade to the Pro plan to start generating professional invoices from your approved billables.
          </p>
          <a
            href="/settings/billing"
            className="inline-flex rounded-xl bg-cyan-600 px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-cyan-500"
          >
            Upgrade to Pro
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col p-4 sm:p-8">
      <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Invoicing</h1>
          <p className="mt-2 text-slate-400">Generate commercial invoices from approved billable blocks.</p>
        </div>
        <button
          onClick={handleGenerateInvoice}
          disabled={selectedEntries.size === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50"
        >
          <Receipt className="h-4 w-4" />
          Generate Invoice ({selectedEntries.size})
        </button>
      </div>

      <div className="mb-12 grid grid-cols-1 gap-8 lg:grid-cols-2 max-w-7xl mx-auto">
        {/* Billable Pipeline */}
        <div className="rounded-3xl border border-white/5 bg-white/[0.015] backdrop-blur-3xl p-6 shadow-2xl transition hover:border-emerald-500/20 hover:shadow-emerald-900/10">
          <h2 className="mb-6 flex items-center gap-2 text-lg font-semibold text-white">
            <DollarSign className="h-5 w-5 text-emerald-400" />
            Approved Billables Pipeline
          </h2>
          {billables.length === 0 ? (
            <p className="text-sm text-slate-500">No approved billables awaiting invoice.</p>
          ) : (
            <div className="space-y-3">
              {billables.map((b) => (
                <div
                  key={b.id}
                  onClick={() => toggleSelection(b.id)}
                  className={`group cursor-pointer rounded-2xl border p-4 transition-all duration-300 shadow-md ${
                    selectedEntries.has(b.id)
                      ? "border-cyan-500 bg-cyan-500/10 shadow-cyan-500/20"
                      : "border-white/5 bg-black/20 hover:border-white/10 hover:bg-black/40"
                  }`}
                >
                  <div className="flex justify-between">
                    <div>
                      <p className="font-medium text-white">{b.projectName}</p>
                      <p className="text-xs text-slate-400">{b.description || "No description provided"}</p>
                    </div>
                    <div className="flex flex-col items-end">
                      <p className="font-bold text-emerald-400">${b.amount.toFixed(2)}</p>
                      <p className="text-xs text-slate-500">
                        {(b.durationSeconds / 3600).toFixed(1)} hrs &times; ${b.hourlyRate}/hr
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Existing Invoices Tracker */}
        <div className="rounded-3xl border border-white/5 bg-white/[0.015] backdrop-blur-3xl p-6 shadow-2xl transition hover:border-indigo-500/20 hover:shadow-indigo-900/10">
          <h2 className="mb-6 flex items-center gap-2 text-lg font-semibold text-white">
            <FileText className="h-5 w-5 text-indigo-400" />
            Issued Invoices
          </h2>
          {invoices.length === 0 ? (
            <p className="text-sm text-slate-500">No invoices generated yet.</p>
          ) : (
            <div className="space-y-3">
              {invoices.map((inv) => (
                <div key={inv.id} className="group flex flex-col gap-3 rounded-2xl border border-white/5 bg-black/20 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between transition-all hover:bg-black/40 hover:border-indigo-500/30">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white">{inv.number}</span>
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-400 uppercase tracking-widest">
                        {inv.status}
                      </span>
                    </div>
                    <p className="text-sm text-slate-400">
                      Amount due: <span className="font-semibold text-white">${inv.amount.toFixed(2)}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => window.print()}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-4 text-sm font-medium text-white shadow-lg transition hover:bg-white/[0.05] hover:border-white/10 focus:outline-none"
                  >
                    <Download className="h-4 w-4 text-slate-400" />
                    Print PDF
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
