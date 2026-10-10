"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Clock3, Lock, Pencil, LayoutList, Play, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  AppEmptyState,
  AppPageHeader,
  AppPageShell,
  AppWorkflowRail,
} from "@/components/app-page-shell";
import { ManualTimeDialog } from "@/components/manual-time-dialog";

type Entry = {
  id: string;
  taskId: string;
  projectId: string | null;
  projectName: string | null;
  goalName: string | null;
  action: string | null;
  tags: string[];
  description: string | null;
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number | null;
  status: "draft" | "submitted" | "approved" | "invoiced";
  rejectionReason?: string | null;
  source: "web" | "calendar" | "manual";
};

type Project = { id: string; name: string };
type GroupedEntries = { key: string; label: string; totalSeconds: number; entries: Entry[] };
const PAGE_SIZE = 25;

function formatDurationCompact(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return [h > 0 ? `${h}h` : null, m > 0 || h > 0 ? `${m}m` : null].filter(Boolean).join(" ") || "0m";
}

function formatDurationClock(seconds: number | null) {
  if (seconds == null) return "Running";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function statusPillClass(status: Entry["status"]) {
  switch (status) {
    case "approved":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "invoiced":
      return "border-indigo-200 bg-indigo-50 text-indigo-700";
    case "submitted":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

export default function ActivityPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingStart, setSubmittingStart] = useState(false);
  const [taskId, setTaskId] = useState("General work");
  const [projectId, setProjectId] = useState("");
  const [description, setDescription] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [projectsError, setProjectsError] = useState(false);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [submittingIds, setSubmittingIds] = useState<string[]>([]);
  const requestId = useRef(0);

  const fetchEntries = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      if (fromDate && toDate && toDate < fromDate) throw new Error("Invalid date range");
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (statusFilter) params.set("status", statusFilter);
      if (fromDate) params.set("from", new Date(`${fromDate}T00:00:00`).toISOString());
      if (toDate) params.set("to", new Date(`${toDate}T23:59:59.999`).toISOString());
      const res = await fetch(`/api/timer/list?${params}`);
      if (!res.ok) throw new Error("Activity unavailable");
      const data = await res.json();
      if (currentRequest === requestId.current) {
        if (page > 0 && !data.entries?.length) { setPage((value) => Math.max(0, value - 1)); return; }
        setEntries(data.entries ?? []);
        setTotal(data.total ?? data.entries?.length ?? 0);
        setHasMore(Boolean(data.hasMore));
        setLoadError(false);
      }
    } catch {
      if (currentRequest === requestId.current) setLoadError(true);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [fromDate, page, statusFilter, toDate]);

  const fetchProjects = useCallback(async () => {
    try {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Projects unavailable");
      const data = await response.json();
      setProjects(data.projects ?? []);
      setProjectsError(false);
    } catch { setProjectsError(true); }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchEntries();
  }, [fetchEntries]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    const onTimeSaved = () => {
      fetchEntries().catch(() => null);
    };
    window.addEventListener("sowledger:time-saved", onTimeSaved);
    return () => window.removeEventListener("sowledger:time-saved", onTimeSaved);
  }, [fetchEntries]);

  const groupedEntries = useMemo<GroupedEntries[]>(() => {
    const groups = new Map<string, GroupedEntries>();
    for (const entry of entries) {
      const started = new Date(entry.startedAt);
      const key = `${started.getFullYear()}-${started.getMonth()}-${started.getDate()}`;
      const label = started.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      if (!groups.has(key)) groups.set(key, { key, label, totalSeconds: 0, entries: [] });
      const target = groups.get(key);
      if (!target) continue;
      target.entries.push(entry);
      target.totalSeconds += entry.durationSeconds ?? 0;
    }
    return [...groups.values()].sort((a, b) => new Date(b.entries[0].startedAt).getTime() - new Date(a.entries[0].startedAt).getTime());
  }, [entries]);

  const visibleTotalSeconds = useMemo(() => entries.reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0), [entries]);
  const manualCount = entries.filter((entry) => entry.source === "manual").length;
  const runningCount = entries.filter((entry) => !entry.stoppedAt).length;
  const eligibleEntries = entries.filter((entry) => entry.stoppedAt && entry.status === "draft");

  async function submitForApproval(entryIds: string[]) {
    if (!entryIds.length || submittingIds.length) return;
    setSubmittingIds(entryIds);
    try {
      const response = await fetch("/api/timer/submit", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryIds }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error("Could not submit time. Refresh Activity and try again.");
      toast.success(`${data.submitted} ${data.submitted === 1 ? "entry" : "entries"} submitted for approval`);
      await fetchEntries();
    } catch {
      toast.error("Could not submit time", { description: "Refresh Activity and try again. If this continues, ask your workspace manager for help." });
    } finally { setSubmittingIds([]); }
  }

  async function startTimerNow() {
    if (!taskId.trim()) {
      toast.error("Work label is required to start a timer.");
      return;
    }
    setSubmittingStart(true);
    try {
      const response = await fetch("/api/timer/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: taskId.trim(), projectId: projectId || undefined, description: description || undefined }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to start timer.");
      toast.success("Timer started");
      await fetchEntries();
    } catch (error) {
      toast.error("Could not start timer", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setSubmittingStart(false);
    }
  }

  function openManualLog() {
    setEditingEntry(null);
    setManualOpen(true);
  }

  function openCorrection(entry: Entry) {
    setEditingEntry(entry);
    setManualOpen(true);
  }

  function correctionLockReason(entry: Entry) {
    if (!entry.stoppedAt) return "Running timers lock until stopped";
    if (entry.status === "approved") return "Approved entries are locked";
    if (entry.status === "invoiced") return "Invoiced entries are locked";
    return null;
  }

  return (
    <>
      <AppPageShell>
        <AppPageHeader
          title="Activity"
          description="Review your time, make corrections, and send completed work for approval."
          icon={LayoutList}
          metadata={loading || loadError ? [] : [
            { label: "Log and review", tone: "cyan", icon: Clock3 },
            { label: `${groupedEntries.length} day${groupedEntries.length === 1 ? "" : "s"}`, tone: "slate", icon: CalendarDays },
          ]}
          primaryAction={(
            <button
              onClick={openManualLog}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 sm:w-auto"
            >
              <Plus className="h-4 w-4" />
              Log completed work
            </button>
          )}
        />

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Activity filters">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm font-semibold text-slate-700">From date<input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(0); }} className="mt-1 h-11 w-full min-w-0 rounded-xl border border-slate-200 px-3 font-normal" /></label>
            <label className="text-sm font-semibold text-slate-700">To date<input type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(0); }} className="mt-1 h-11 w-full min-w-0 rounded-xl border border-slate-200 px-3 font-normal" /></label>
            <label className="text-sm font-semibold text-slate-700">Status<select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(0); }} className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal"><option value="">All statuses</option><option value="draft">Draft</option><option value="rejected">Sent back</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="invoiced">Invoiced</option></select></label>
            <div className="flex items-end"><button type="button" onClick={() => { setFromDate(""); setToDate(""); setStatusFilter(""); setPage(0); }} className="h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600">Clear filters</button></div>
          </div>
        </section>

        <details className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">Start a timer from Activity</summary>
          {projectsError && <p className="mt-3 text-sm text-amber-800" role="alert">Could not load projects. <button type="button" onClick={() => void fetchProjects()} className="font-semibold underline">Retry projects</button></p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Start live work</h2>
              <p className="mt-1 text-sm text-slate-500">Start tracking a task. It will appear below.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(160px,1.2fr)_minmax(0,1.6fr)_auto]">
            <input
              aria-label="Work label"
              value={taskId}
              onChange={(event) => setTaskId(event.target.value)}
              placeholder="What are you working on?"
              className="h-12 min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-cyan-500 focus:bg-white"
            />
            <select
              aria-label="Project"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="h-12 min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white"
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
            <input
              aria-label="Optional note"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional note"
              className="h-12 min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-cyan-500 focus:bg-white"
            />
            <button
              type="button"
              onClick={startTimerNow}
              disabled={submittingStart}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-5 text-sm font-bold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
            >
              <Play className="h-4 w-4 fill-white" />
              {submittingStart ? "Starting..." : "Start timer"}
            </button>
          </div>
        </details>

        {!loading && !loadError && <section className="flex flex-wrap gap-x-6 gap-y-2 px-1 text-sm text-slate-600" aria-label="Activity summary">
          <span><strong className="text-slate-900">{entries.length}</strong> of {total} matching entries</span>
          <span><strong className="text-slate-900">{formatDurationCompact(visibleTotalSeconds)}</strong> completed on this page</span>
          <span>{manualCount} manual{runningCount ? ` · ${runningCount} running` : ""}</span>
        </section>}

        {loadError ? (
          <section role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p>{fromDate && toDate && toDate < fromDate ? "The end date must be on or after the start date." : "Could not load your activity. Check your connection and try again."}</p>
            <button type="button" onClick={() => void fetchEntries()} disabled={loading} className="mt-3 font-semibold underline">{loading ? "Retrying..." : "Retry activity"}</button>
          </section>
        ) : loading ? (
          <section className="rounded-[32px] border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
            Loading activity...
          </section>
        ) : entries.length === 0 ? (
          <AppEmptyState
            icon={Clock3}
            title={fromDate || toDate || statusFilter ? "No entries match these filters" : "No time entries yet"}
            description={fromDate || toDate || statusFilter ? "Try a different date range or status, or clear the filters." : "Start a timer or log completed work to begin."}
            action={(
              <button
                onClick={openManualLog}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                Log completed work
              </button>
            )}
          />
        ) : (
          <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
            {eligibleEntries.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4"><p className="text-sm text-slate-600">{eligibleEntries.length} completed {eligibleEntries.length === 1 ? "entry is" : "entries are"} ready to submit on this page.</p><button type="button" disabled={submittingIds.length > 0} onClick={() => void submitForApproval(eligibleEntries.map((entry) => entry.id))} className="rounded-xl bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Submit page for approval</button></div>}
            <div className="divide-y divide-slate-100">
              {groupedEntries.map((group) => (
                <section key={group.key}>
                  <header className="flex items-center justify-between gap-4 bg-slate-50 px-5 py-3">
                    <div className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-700">
                      <CalendarDays className="h-4 w-4 shrink-0 text-cyan-700" />
                      <span className="truncate">{group.label}</span>
                    </div>
                    <div className="shrink-0 text-sm font-bold text-slate-600">{formatDurationCompact(group.totalSeconds)}</div>
                  </header>
                  <div className="divide-y divide-slate-100">
                    {group.entries.map((entry) => {
                      const started = new Date(entry.startedAt);
                      const stopped = entry.stoppedAt ? new Date(entry.stoppedAt) : null;
                      const timeRange = `${started.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - ${stopped ? stopped.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Running"}`;
                      const title = entry.description || entry.action || entry.taskId || "Work session";
                      return (
                        <article key={entry.id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,2.2fr)_minmax(150px,180px)_minmax(100px,120px)_minmax(170px,200px)] md:items-center">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-950">{title}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                              <span className="max-w-full truncate rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">{entry.projectName || "No project"}</span>
                              {entry.goalName ? <span className="max-w-full truncate rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">{entry.goalName}</span> : null}
                              {entry.tags.slice(0, 2).map((tag) => <span key={`${entry.id}-${tag}`} className="max-w-full truncate rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-cyan-700">#{tag}</span>)}
                            </div>
                            {entry.rejectionReason && (
                              <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                                <span className="font-bold">Sent back:</span> {entry.rejectionReason}
                              </p>
                            )}
                          </div>
                          <div className="font-mono text-sm text-slate-500">{timeRange}</div>
                          <div className="font-mono text-sm font-bold text-slate-950">{formatDurationClock(entry.durationSeconds)}</div>
                          <div className="flex flex-wrap items-center gap-2 md:justify-end">
                            <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-bold capitalize ${statusPillClass(entry.status)}`}>{entry.status === "draft" && entry.rejectionReason ? "Sent back" : entry.status}</span>
                            <span className="text-xs font-semibold text-slate-400">{entry.source === "web" ? "Timer" : entry.source === "calendar" ? "Calendar" : "Manual"}</span>
                            {correctionLockReason(entry) ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-500" title={correctionLockReason(entry) ?? undefined}>
                                <Lock className="h-3 w-3" />
                                Locked
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openCorrection(entry)}
                                className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-bold text-cyan-700 transition hover:border-cyan-300 hover:bg-cyan-100"
                                aria-label={`Correct time entry ${title}`}
                              >
                                <Pencil className="h-3 w-3" />
                                Correct
                              </button>
                            )}
                            {entry.stoppedAt && entry.status === "draft" && <button type="button" disabled={submittingIds.length > 0} onClick={() => void submitForApproval([entry.id])} className="rounded-full bg-cyan-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" aria-label={`Submit ${title} for approval`}>{submittingIds.includes(entry.id) ? "Submitting..." : entry.rejectionReason ? "Resubmit for approval" : "Submit for approval"}</button>}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
            <nav aria-label="Activity pages" className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 text-sm">
              <button type="button" disabled={page === 0 || loading} onClick={() => setPage((value) => value - 1)} className="rounded-xl border border-slate-200 px-3 py-2 font-semibold disabled:opacity-40">Previous page</button>
              <span className="text-center text-slate-500">Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
              <button type="button" disabled={!hasMore || loading} onClick={() => setPage((value) => value + 1)} className="rounded-xl border border-slate-200 px-3 py-2 font-semibold disabled:opacity-40">Next page</button>
            </nav>
          </section>
        )}
        <details className="rounded-2xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">More ways to work with your time</summary><div className="mt-3"><AppWorkflowRail current="log" /></div></details>
      </AppPageShell>
      <ManualTimeDialog
        open={manualOpen}
        onOpenChange={(open) => {
          setManualOpen(open);
          if (!open) setEditingEntry(null);
        }}
        onSaved={fetchEntries}
        editEntry={editingEntry}
        defaultTaskId={taskId}
        defaultProjectId={projectId}
        defaultDescription={description}
      />
    </>
  );
}
