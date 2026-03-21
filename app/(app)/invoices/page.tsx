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

      <div className="mb-12 grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Billable Pipeline */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
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
                  className={`cursor-pointer rounded-lg border p-4 transition ${
                    selectedEntries.has(b.id)
                      ? "border-cyan-500 bg-cyan-950/20"
                      : "border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-800"
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
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
            <FileText className="h-5 w-5 text-indigo-400" />
            Issued Invoices
          </h2>
          {invoices.length === 0 ? (
            <p className="text-sm text-slate-500">No invoices generated yet.</p>
          ) : (
            <div className="space-y-3">
              {invoices.map((inv) => (
                <div key={inv.id} className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/50 p-4 sm:flex-row sm:items-center sm:justify-between">
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
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm font-medium text-white transition hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
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
