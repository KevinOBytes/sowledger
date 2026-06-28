"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock3, Lock, Pencil, LayoutList, Play, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  AppEmptyState,
  AppMetricCard,
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
  source: "web" | "calendar" | "manual";
};

type Project = { id: string; name: string };
type GroupedEntries = { key: string; label: string; totalSeconds: number; entries: Entry[] };

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

  const fetchEntries = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/timer/list?limit=100");
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries ?? []);
      }
    } catch {
      toast.error("Failed to load activity feed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntries();
    fetch("/api/projects")
      .then((res) => res.json())
      .then((data) => setProjects(data.projects ?? []))
      .catch(() => null);
  }, []);

  useEffect(() => {
    const onTimeSaved = () => {
      fetchEntries().catch(() => null);
    };
    window.addEventListener("sowledger:time-saved", onTimeSaved);
    return () => window.removeEventListener("sowledger:time-saved", onTimeSaved);
  }, []);

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
          eyebrow="Correct logged time"
          title="Activity"
          description="Review timers and completed work by day. Use this page for corrections before approval, invoicing, analytics, or export."
          icon={LayoutList}
          metadata={[
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

        <AppWorkflowRail current="review" />

        <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Start live work</h2>
              <p className="mt-1 text-sm text-slate-500">Capture new work now, then reconcile it in this activity trail.</p>
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
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <AppMetricCard label="Visible entries" value={entries.length} detail="Loaded from the current activity feed." accent="slate" icon={LayoutList} />
          <AppMetricCard label="Completed without timer" value={manualCount} detail="Manual entries visible in this review set." accent="cyan" icon={Plus} />
          <AppMetricCard
            label="Total tracked"
            value={<span className="font-mono">{formatDurationClock(visibleTotalSeconds)}</span>}
            detail={runningCount > 0 ? `${runningCount} running` : "Completed duration in the current feed."}
            accent={runningCount > 0 ? "emerald" : "cyan"}
            icon={Clock3}
          />
        </section>

        {loading ? (
          <section className="rounded-[32px] border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
            Loading activity...
          </section>
        ) : entries.length === 0 ? (
          <AppEmptyState
            icon={Clock3}
            title="No time entries yet."
            description="Start a timer or log completed work to build your activity trail before review and approval."
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
                          </div>
                          <div className="font-mono text-sm text-slate-500">{timeRange}</div>
                          <div className="font-mono text-sm font-bold text-slate-950">{formatDurationClock(entry.durationSeconds)}</div>
                          <div className="flex flex-wrap items-center gap-2 md:justify-end">
                            <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-bold capitalize ${statusPillClass(entry.status)}`}>{entry.status}</span>
                            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{entry.source}</span>
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
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </section>
        )}
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
