"use client";

import { useEffect, useState } from "react";
import { Check, Clock, X } from "lucide-react";

type PendingEntry = {
  id: string;
  userEmail: string;
  projectName: string;
  description: string;
  startedAt: string;
  durationSeconds: number | null;
  status: string;
};

export default function ApprovalsPage() {
  const [entries, setEntries] = useState<PendingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"pending" | "all">("pending");

  useEffect(() => {
    let active = true;
    async function fetchEntries() {
      setLoading(true);
      try {
        const res = await fetch(`/api/approvals?status=${statusFilter}`);
        if (!active) return;
        if (res.ok) {
          const data = await res.json();
          setEntries(data.entries || []);
        } else {
          const err = await res.json();
          setError(err.error || "Failed to load approvals.");
        }
      } catch {
        if (!active) return;
        setError("Network error fetching approvals.");
      } finally {
        if (active) setLoading(false);
      }
    }
    fetchEntries();
    return () => { active = false; };
  }, [statusFilter]);

  async function handleApprove(entryId: string) {
    try {
      const res = await fetch("/api/timer/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId }),
      });
      if (res.ok) {
        if (statusFilter === "pending") {
           setEntries((prev) => prev.filter((e) => e.id !== entryId));
        } else {
           setEntries((prev) => prev.map((e) => e.id === entryId ? { ...e, status: "approved" } : e));
        }
      } else {
        const data = await res.json();
        alert(`Error: ${data.error}`);
      }
    } catch {
      alert("Failed to approve entry.");
    }
  }

  async function handleReject(entryId: string) {
    try {
      const res = await fetch("/api/timer/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId }),
      });
      if (res.ok) {
        if (statusFilter === "pending") {
           setEntries((prev) => prev.filter((e) => e.id !== entryId));
        } else {
           setEntries((prev) => prev.map((e) => e.id === entryId ? { ...e, status: "rejected" } : e));
        }
      } else {
        const data = await res.json();
        alert(`Error: ${data.error}`);
      }
    } catch {
      alert("Failed to reject entry.");
    }
  }

  if (loading && entries.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-slate-400">
        <div className="flex flex-col items-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-t-2 border-cyan-500"></div>
          <p>Loading timesheets...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-6 text-center text-rose-400 shadow-xl">
          <X className="mx-auto mb-2 h-8 w-8 text-rose-500 opacity-50" />
          <p className="font-semibold">Access Denied</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col p-4 sm:p-8 max-w-7xl mx-auto w-full">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Timesheet Approvals</h1>
          <p className="text-slate-400">Review and authorize pending time entries across your workspace.</p>
        </div>

        <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 p-1.5 rounded-xl text-sm">
           <button 
             onClick={() => setStatusFilter("pending")}
             className={`px-4 py-1.5 rounded-lg font-medium transition ${statusFilter === "pending" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"}`}
           >
             Pending Review
           </button>
           <button 
             onClick={() => setStatusFilter("all")}
             className={`px-4 py-1.5 rounded-lg font-medium transition ${statusFilter === "all" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"}`}
           >
             All History
           </button>
        </div>
      </div>

      <div className="grid gap-4">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/50 p-12 text-slate-500">
            <Check className="mb-4 h-12 w-12 text-emerald-500/50" />
            <p className="text-lg font-medium text-slate-400">All caught up!</p>
            <p className="mt-1 text-sm text-slate-500">There are no {statusFilter === "pending" ? "pending " : ""}timesheets to display.</p>
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className={`group flex flex-col justify-between gap-4 rounded-xl border border-white/5 bg-slate-900/80 p-5 shadow-sm transition hover:border-cyan-500/30 sm:flex-row sm:items-center ${entry.status === "approved" || entry.status === "invoiced" ? "opacity-60 grayscale hover:grayscale-0" : ""}`}
            >
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white">{entry.userEmail}</span>
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold tracking-wide uppercase ${
                    entry.status === 'approved' || entry.status === 'invoiced' ? 'bg-emerald-500/20 text-emerald-400' : 
                    entry.status === 'draft' ? 'bg-rose-500/20 text-rose-400' :
                    'bg-amber-500/20 text-amber-400'
                  }`}>
                    {entry.status === 'draft' ? 'rejected' : entry.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-400">
                  <span className="text-cyan-400 font-medium">{entry.projectName}</span> &bull; {entry.description || "No description provided"}
                </p>
                <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                  <Clock className="h-3.5 w-3.5" />
                  {new Date(entry.startedAt).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="flex flex-col items-end shrink-0">
                  <span className="text-xs font-medium text-slate-500 tracking-widest uppercase">Duration</span>
                  <span className="text-xl font-bold text-white">
                    {entry.durationSeconds ? (entry.durationSeconds / 3600).toFixed(2) : "0.00"}
                    <span className="ml-1 text-sm font-normal text-slate-400">hrs</span>
                  </span>
                </div>
                
                {entry.status === "submitted" && (
                   <div className="flex flex-col sm:flex-row items-center gap-2 shrink-0">
                     <button
                       onClick={() => handleReject(entry.id)}
                       title="Reject & Re-open Entry"
                       className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 font-medium text-slate-400 shadow-lg transition hover:bg-rose-500/20 hover:text-rose-400 focus:outline-none"
                     >
                       <X className="h-5 w-5" />
                     </button>
                     <button
                       onClick={() => handleApprove(entry.id)}
                       disabled={!entry.durationSeconds}
                       className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 font-medium text-white shadow-lg transition hover:bg-emerald-500 hover:scale-105 focus:outline-none disabled:opacity-50"
                       title="Approve Entry"
                     >
                       <Check className="h-5 w-5" />
                     </button>
                   </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
