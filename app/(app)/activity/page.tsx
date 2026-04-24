"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock3, LayoutList, Play, Plus } from "lucide-react";
import { toast } from "sonner";

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
  const [taskId, setTaskId] = useState("TASK-1");
  const [projectId, setProjectId] = useState("");
  const [description, setDescription] = useState("");
  const [manualOpen, setManualOpen] = useState(false);

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
    window.addEventListener("billabled:time-saved", onTimeSaved);
    return () => window.removeEventListener("billabled:time-saved", onTimeSaved);
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
      toast.error("Task reference is required to start a timer.");
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

  return (
    <main className="min-h-screen bg-[#f6f3ee] p-4 text-slate-950 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Correct logged time</p>
              <h1 className="mt-2 flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                <LayoutList className="h-7 w-7 text-cyan-700" />
                Activity
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-500">Review timers and manual blocks by day. Use this page for corrections before approval, invoicing, analytics, or export.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setManualOpen(true)} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800">
                <Plus className="mr-2 inline h-4 w-4" />Log manual time
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-[2fr_1.2fr_1.6fr_auto]">
            <input value={taskId} onChange={(event) => setTaskId(event.target.value)} placeholder="What are you working on?" className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" />
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white">
              <option value="">No project</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional note" className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" />
            <button type="button" onClick={startTimerNow} disabled={submittingStart} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-5 text-sm font-bold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60">
              <Play className="h-4 w-4 fill-white" />
              {submittingStart ? "Starting..." : "Start timer"}
            </button>
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Visible entries</p>
            <p className="mt-2 text-3xl font-semibold">{entries.length}</p>
          </div>
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Manual blocks</p>
            <p className="mt-2 text-3xl font-semibold">{manualCount}</p>
          </div>
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Total tracked</p>
            <p className="mt-2 font-mono text-3xl font-semibold text-cyan-700">{formatDurationClock(visibleTotalSeconds)}</p>
            {runningCount > 0 && <p className="mt-1 text-sm text-emerald-700">{runningCount} running</p>}
          </div>
        </section>

        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="p-10 text-center text-slate-500">Loading activity...</div>
          ) : entries.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <Clock3 className="mx-auto mb-3 h-9 w-9 text-slate-400" />
              <p className="font-semibold text-slate-700">No time entries yet.</p>
              <p className="mt-1 text-sm">Start a timer or log a manual block to build your activity trail.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {groupedEntries.map((group) => (
                <section key={group.key}>
                  <header className="flex items-center justify-between bg-slate-50 px-5 py-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
                      <CalendarDays className="h-4 w-4 text-cyan-700" />
                      {group.label}
                    </div>
                    <div className="text-sm font-bold text-slate-600">{formatDurationCompact(group.totalSeconds)}</div>
                  </header>
                  <div className="divide-y divide-slate-100">
                    {group.entries.map((entry) => {
                      const started = new Date(entry.startedAt);
                      const stopped = entry.stoppedAt ? new Date(entry.stoppedAt) : null;
                      const timeRange = `${started.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - ${stopped ? stopped.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Running"}`;
                      const title = entry.description || entry.action || entry.taskId || "Work session";
                      return (
                        <article key={entry.id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,2.2fr)_180px_120px_200px] md:items-center">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-950">{title}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">{entry.projectName || "No project"}</span>
                              {entry.goalName ? <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">{entry.goalName}</span> : null}
                              {entry.tags.slice(0, 2).map((tag) => <span key={`${entry.id}-${tag}`} className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-cyan-700">#{tag}</span>)}
                            </div>
                          </div>
                          <div className="font-mono text-sm text-slate-500">{timeRange}</div>
                          <div className="font-mono text-sm font-bold text-slate-950">{formatDurationClock(entry.durationSeconds)}</div>
                          <div className="flex items-center gap-2 md:justify-end">
                            <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-bold capitalize ${statusPillClass(entry.status)}`}>{entry.status}</span>
                            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{entry.source}</span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>
      </div>
      <ManualTimeDialog open={manualOpen} onOpenChange={setManualOpen} onSaved={fetchEntries} defaultTaskId={taskId} defaultProjectId={projectId} defaultDescription={description} />
    </main>
  );
}
