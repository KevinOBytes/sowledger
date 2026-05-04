"use client";

import { useEffect, useState } from "react";
import { Check, Clock, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";

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
      setError(null);
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
        if (statusFilter === "pending") setEntries((prev) => prev.filter((entry) => entry.id !== entryId));
        else setEntries((prev) => prev.map((entry) => entry.id === entryId ? { ...entry, status: "approved" } : entry));
        toast.success("Time approved");
      } else {
        const data = await res.json();
        toast.error("Could not approve time", { description: data.error });
      }
    } catch {
      toast.error("Could not approve time");
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
        if (statusFilter === "pending") setEntries((prev) => prev.filter((entry) => entry.id !== entryId));
        else setEntries((prev) => prev.map((entry) => entry.id === entryId ? { ...entry, status: "rejected" } : entry));
        toast.success("Time sent back");
      } else {
        const data = await res.json();
        toast.error("Could not send time back", { description: data.error });
      }
    } catch {
      toast.error("Could not send time back");
    }
  }

  if (loading && entries.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f6f3ee] p-8 text-slate-500">
        <div className="flex flex-col items-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-t-2 border-cyan-500" />
          <p>Loading approvals...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f6f3ee] p-8">
        <div className="max-w-md rounded-[32px] border border-amber-200 bg-white p-8 text-center shadow-sm">
          <X className="mx-auto mb-3 h-9 w-9 text-amber-600" />
          <p className="text-lg font-semibold text-slate-950">Approvals are restricted</p>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
          <p className="mt-4 text-xs text-slate-400">Managers and owners can approve time. Members can still review their own entries in Activity.</p>
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
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Approve</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Timesheet Approvals</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-500">Managers and owners review submitted time before invoicing. If you cannot approve, the page explains the role requirement instead of failing silently.</p>
            </div>
            <div className="inline-flex rounded-full bg-slate-100 p-1 text-sm font-bold">
              <button
                onClick={() => setStatusFilter("pending")}
                className={`rounded-full px-4 py-2 transition ${statusFilter === "pending" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"}`}
              >
                Pending review
              </button>
              <button
                onClick={() => setStatusFilter("all")}
                className={`rounded-full px-4 py-2 transition ${statusFilter === "all" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"}`}
              >
                All history
              </button>
            </div>
          </div>
        </header>

        <section className="grid gap-4">
          {entries.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center rounded-[32px] border border-slate-200 bg-white p-12 text-center shadow-sm"
            >
              <Check className="mb-4 h-12 w-12 text-emerald-600" />
              <p className="text-lg font-semibold text-slate-800">All caught up!</p>
              <p className="mt-1 text-sm text-slate-500">There are no {statusFilter === "pending" ? "pending " : ""}time entries to display.</p>
            </motion.div>
          ) : (
            <AnimatePresence>
              {entries.map((entry) => (
                <motion.article
                  key={entry.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className={`flex flex-col justify-between gap-4 rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm transition hover:border-cyan-200 sm:flex-row sm:items-center ${entry.status === "approved" || entry.status === "invoiced" ? "opacity-70" : ""}`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-950">{entry.userEmail}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${entry.status === "approved" || entry.status === "invoiced" ? "bg-emerald-50 text-emerald-700" : entry.status === "draft" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
                        {entry.status === "draft" ? "sent back" : entry.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      <span className="font-semibold text-cyan-700">{entry.projectName}</span> - {entry.description || "No description provided"}
                    </p>
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                      <Clock className="h-3.5 w-3.5" />
                      {new Date(entry.startedAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </div>
                  </div>

                  <div className="flex items-center gap-5 sm:justify-end">
                    <div className="text-right">
                      <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Duration</span>
                      <p className="text-xl font-bold text-slate-950">
                        {entry.durationSeconds ? (entry.durationSeconds / 3600).toFixed(2) : "0.00"}
                        <span className="ml-1 text-sm font-normal text-slate-500">hrs</span>
                      </p>
                    </div>
                    {entry.status === "submitted" && (
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleReject(entry.id)} title="Send time back" className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-rose-200 hover:text-rose-700">
                          <X className="h-5 w-5" />
                        </button>
                        <button onClick={() => handleApprove(entry.id)} disabled={!entry.durationSeconds} title="Approve time" className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-50">
                          <Check className="h-5 w-5" />
                        </button>
                      </div>
                    )}
                  </div>
                </motion.article>
              ))}
            </AnimatePresence>
          )}
        </section>
      </div>
    </main>
  );
}
