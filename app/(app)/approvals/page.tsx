"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Clock, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";

import {
  AppEmptyState,
  AppMetricCard,
  AppPageHeader,
  AppPageShell,
  AppWorkflowRail,
} from "@/components/app-page-shell";

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
  const [pendingEntryIds, setPendingEntryIds] = useState<Set<string>>(new Set());
  const pendingEntryIdsRef = useRef<Set<string>>(new Set());
  const submittedCount = entries.filter((entry) => entry.status === "submitted").length;
  const approvedOutputCount = entries.filter((entry) => entry.status === "approved" || entry.status === "invoiced").length;

  function setEntryPending(entryId: string, pending: boolean) {
    if (pending) pendingEntryIdsRef.current.add(entryId);
    else pendingEntryIdsRef.current.delete(entryId);
    setPendingEntryIds(new Set(pendingEntryIdsRef.current));
  }

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
    if (pendingEntryIdsRef.current.has(entryId)) return;
    setEntryPending(entryId, true);
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
    } finally {
      setEntryPending(entryId, false);
    }
  }

  async function handleReject(entryId: string) {
    if (pendingEntryIdsRef.current.has(entryId)) return;
    setEntryPending(entryId, true);
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
    } finally {
      setEntryPending(entryId, false);
    }
  }

  if (loading && entries.length === 0) {
    return (
      <AppPageShell contentClassName="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-t-2 border-cyan-500" />
          <p>Loading approvals...</p>
        </div>
      </AppPageShell>
    );
  }

  if (error) {
    return (
      <AppPageShell width="standard">
        <AppPageHeader
          eyebrow="Approve"
          title="Timesheet Approvals"
          description="Managers and owners review submitted time before invoicing. Restricted access is shown clearly so members can continue reviewing their own activity."
          icon={Check}
          metadata={[{ label: "Restricted", tone: "amber", icon: X }]}
        />
        <AppWorkflowRail current="approve" />
        <AppEmptyState
          icon={X}
          title="Approvals are restricted"
          description={`${error} Managers and owners can approve time. Members can still review their own entries in Activity.`}
          action={(
            <a href="/activity" className="rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800">
              Review Activity
            </a>
          )}
        />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell>
      <AppPageHeader
        eyebrow="Approve"
        title="Timesheet Approvals"
        description="Managers and owners review submitted time before invoicing. If you cannot approve, the page explains the role requirement instead of failing silently."
        icon={Check}
        metadata={[
          { label: statusFilter === "pending" ? "Pending review" : "All history", tone: "cyan", icon: Clock },
          { label: `${entries.length} visible`, tone: "slate", icon: Check },
        ]}
        primaryAction={(
          <div className="inline-flex w-full rounded-full bg-slate-100 p-1 text-sm font-bold shadow-inner sm:w-auto">
            <button
              onClick={() => setStatusFilter("pending")}
              className={`flex-1 rounded-full px-4 py-2 transition sm:flex-none ${statusFilter === "pending" ? "bg-slate-950 text-white shadow-sm" : "text-slate-500 hover:text-slate-950"}`}
            >
              Pending review
            </button>
            <button
              onClick={() => setStatusFilter("all")}
              className={`flex-1 rounded-full px-4 py-2 transition sm:flex-none ${statusFilter === "all" ? "bg-slate-950 text-white shadow-sm" : "text-slate-500 hover:text-slate-950"}`}
            >
              All history
            </button>
          </div>
        )}
      />

      <AppWorkflowRail current="approve" />

      <section className="grid gap-4 sm:grid-cols-3">
        <AppMetricCard label="Visible entries" value={entries.length} detail="Loaded for the selected approval filter." accent="slate" icon={Clock} />
        <AppMetricCard label="Pending approval" value={submittedCount} detail="Submitted time ready for manager action." accent="amber" icon={Clock} />
        <AppMetricCard label="Approved output" value={approvedOutputCount} detail="Approved or invoiced entries in this view." accent="emerald" icon={Check} />
      </section>

        <section className="grid gap-4">
          {entries.length === 0 ? (
            <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
              <AppEmptyState
                icon={Check}
                title="All caught up!"
                description={`There are no ${statusFilter === "pending" ? "pending " : ""}time entries to display. Review activity if time still needs to be submitted.`}
                action={statusFilter === "pending" ? (
                  <button onClick={() => setStatusFilter("all")} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800">
                    View all history
                  </button>
                ) : (
                  <a href="/activity" className="rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800">
                    Review Activity
                  </a>
                )}
              />
            </motion.div>
          ) : (
            <AnimatePresence>
              {entries.map((entry) => {
                const entryPending = pendingEntryIds.has(entry.id);
                return (
                <motion.article
                  key={entry.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className={`flex flex-col justify-between gap-4 rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm transition hover:border-cyan-200 sm:flex-row sm:items-center sm:p-6 ${entry.status === "approved" || entry.status === "invoiced" ? "opacity-70" : ""}`}
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

                  <div className="flex flex-wrap items-center gap-4 sm:justify-end">
                    <div className="min-w-24 sm:text-right">
                      <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Duration</span>
                      <p className="text-xl font-bold text-slate-950">
                        {entry.durationSeconds ? (entry.durationSeconds / 3600).toFixed(2) : "0.00"}
                        <span className="ml-1 text-sm font-normal text-slate-500">hrs</span>
                      </p>
                    </div>
                    {entry.status === "submitted" && (
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleReject(entry.id)} disabled={entryPending} title={entryPending ? "Approval action pending" : "Send time back"} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-rose-200 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50">
                          <X className="h-5 w-5" />
                        </button>
                        <button onClick={() => handleApprove(entry.id)} disabled={entryPending || !entry.durationSeconds} title={entryPending ? "Approval action pending" : "Approve time"} className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
                          <Check className="h-5 w-5" />
                        </button>
                      </div>
                    )}
                  </div>
                </motion.article>
                );
              })}
            </AnimatePresence>
          )}
        </section>
    </AppPageShell>
  );
}
