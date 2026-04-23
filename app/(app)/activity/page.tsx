"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock3, LayoutList, Play, Plus } from "lucide-react";
import { toast } from "sonner";

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

type Project = {
  id: string;
  name: string;
};

type GroupedEntries = {
  key: string;
  label: string;
  totalSeconds: number;
  entries: Entry[];
};

function getDateTimeParts(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` };
}

function formatDurationCompact(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h > 0 ? `${h}h` : null, m > 0 || h > 0 ? `${m}m` : null, `${s}s`].filter(Boolean).join(" ");
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
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "invoiced":
      return "border-violet-500/30 bg-violet-500/10 text-violet-300";
    case "submitted":
      return "border-cyan-500/30 bg-cyan-500/10 text-cyan-300";
    default:
      return "border-slate-700 bg-slate-800/80 text-slate-300";
  }
}

export default function ActivityPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingStart, setSubmittingStart] = useState(false);
  const [submittingManual, setSubmittingManual] = useState(false);

  // Quick entry state
  const [taskId, setTaskId] = useState("TASK-1");
  const [projectId, setProjectId] = useState("");
  const [description, setDescription] = useState("");

  // Manual block state
  const [showManualForm, setShowManualForm] = useState(false);
  const [startedAtDate, setStartedAtDate] = useState("");
  const [startedAtTime, setStartedAtTime] = useState("");
  const [stoppedAtDate, setStoppedAtDate] = useState("");
  const [stoppedAtTime, setStoppedAtTime] = useState("");

  const [projects, setProjects] = useState<Project[]>([]);

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
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const startParts = getDateTimeParts(oneHourAgo);
    const stopParts = getDateTimeParts(now);
    setStartedAtDate(startParts.date);
    setStartedAtTime(startParts.time);
    setStoppedAtDate(stopParts.date);
    setStoppedAtTime(stopParts.time);

    fetchEntries();
    fetch("/api/projects")
      .then((res) => res.json())
      .then((data) => {
        if (data.projects) setProjects(data.projects);
      })
      .catch(() => null);
  }, []);

  const groupedEntries = useMemo<GroupedEntries[]>(() => {
    const groups = new Map<string, GroupedEntries>();

    for (const entry of entries) {
      const started = new Date(entry.startedAt);
      const key = `${started.getFullYear()}-${started.getMonth()}-${started.getDate()}`;
      const label = started.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label,
          totalSeconds: 0,
          entries: [],
        });
      }

      const target = groups.get(key);
      if (!target) continue;
      target.entries.push(entry);
      if (entry.durationSeconds) target.totalSeconds += entry.durationSeconds;
    }

    return [...groups.values()].sort((a, b) => {
      const firstA = new Date(a.entries[0].startedAt).getTime();
      const firstB = new Date(b.entries[0].startedAt).getTime();
      return firstB - firstA;
    });
  }, [entries]);

  const visibleTotalSeconds = useMemo(
    () => entries.reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0),
    [entries]
  );

  const rangeLabel = useMemo(() => {
    if (entries.length === 0) return "No entries yet";
    const newest = new Date(entries[0].startedAt);
    const oldest = new Date(entries[entries.length - 1].startedAt);
    const formatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
    return `${formatter.format(oldest)} - ${formatter.format(newest)}`;
  }, [entries]);

  const startTimerNow = async () => {
    if (!taskId.trim()) {
      toast.error("Task reference is required to start a timer.");
      return;
    }
    setSubmittingStart(true);
    try {
      const response = await fetch("/api/timer/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: taskId.trim(),
          projectId: projectId || undefined,
          description: description || undefined,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Unable to start timer.");
      }
      toast.success("Timer started");
      await fetchEntries();
    } catch (error) {
      toast.error("Could not start timer", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setSubmittingStart(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskId.trim()) {
      toast.error("Task reference is required.");
      return;
    }
    if (!startedAtDate || !startedAtTime || !stoppedAtDate || !stoppedAtTime) {
      toast.error("Start and end date/time are required.");
      return;
    }

    const startObj = new Date(`${startedAtDate}T${startedAtTime}`);
    const stopObj = new Date(`${stoppedAtDate}T${stoppedAtTime}`);
    if (Number.isNaN(startObj.getTime()) || Number.isNaN(stopObj.getTime())) {
      toast.error("Please enter valid start and end timestamps.");
      return;
    }
    if (stopObj <= startObj) {
      toast.error("End time must be after start time.");
      return;
    }

    setSubmittingManual(true);
    try {
      const res = await fetch("/api/timer/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: taskId.trim(),
          projectId: projectId || undefined,
          description: description || undefined,
          startedAt: startObj.toISOString(),
          stoppedAt: stopObj.toISOString(),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Unable to save manual entry.");

      toast.success("Manual block logged");
      setShowManualForm(false);
      await fetchEntries();
    } catch (err) {
      toast.error("Could not save manual entry", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSubmittingManual(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-8">
      <div className="rounded-2xl border border-white/10 bg-slate-900/55 p-5 shadow-2xl backdrop-blur">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-white">
              <LayoutList className="h-5 w-5 text-cyan-400" />
              Activity Timeline
            </h1>
            <p className="mt-1 text-sm text-slate-400">Quick-add entries and review your work by day.</p>
          </div>
          <div className="text-sm text-slate-300">
            <span className="text-slate-500">Visible period:</span> {rangeLabel}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[2fr_1.2fr_1.6fr_auto_auto]">
          <input
            value={taskId}
            onChange={(event) => setTaskId(event.target.value)}
            placeholder="What are you working on? (Task ID)"
            className="h-11 rounded-xl border border-slate-700 bg-slate-950/70 px-4 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
          />
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="h-11 rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-sm text-slate-100 focus:border-cyan-500 focus:outline-none"
          >
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional note"
            className="h-11 rounded-xl border border-slate-700 bg-slate-950/70 px-4 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={startTimerNow}
            disabled={submittingStart}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Play className="h-4 w-4" />
            {submittingStart ? "Starting..." : "Start"}
          </button>
          <button
            type="button"
            onClick={() => setShowManualForm((value) => !value)}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm font-semibold text-slate-100 transition hover:border-cyan-500/40 hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            {showManualForm ? "Hide" : "Log"}
          </button>
        </div>

        {showManualForm && (
          <form onSubmit={handleManualSubmit} className="mt-4 grid gap-3 rounded-xl border border-slate-700/80 bg-slate-950/60 p-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1">
              <label htmlFor="startedAtDate" className="text-xs font-medium text-slate-400">
                Start Date
              </label>
              <input
                id="startedAtDate"
                type="date"
                value={startedAtDate}
                onChange={(event) => setStartedAtDate(event.target.value)}
                required
                className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 dark:[color-scheme:dark]"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="startedAtTime" className="text-xs font-medium text-slate-400">
                Start Time
              </label>
              <input
                id="startedAtTime"
                type="time"
                value={startedAtTime}
                onChange={(event) => setStartedAtTime(event.target.value)}
                required
                className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 dark:[color-scheme:dark]"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="stoppedAtDate" className="text-xs font-medium text-slate-400">
                End Date
              </label>
              <input
                id="stoppedAtDate"
                type="date"
                value={stoppedAtDate}
                onChange={(event) => setStoppedAtDate(event.target.value)}
                required
                className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 dark:[color-scheme:dark]"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="stoppedAtTime" className="text-xs font-medium text-slate-400">
                End Time
              </label>
              <input
                id="stoppedAtTime"
                type="time"
                value={stoppedAtTime}
                onChange={(event) => setStoppedAtTime(event.target.value)}
                required
                className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 dark:[color-scheme:dark]"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={submittingManual}
                className="h-10 w-full rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submittingManual ? "Saving..." : "Save Block"}
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/40 px-5 py-3 text-sm">
        <div>
          <p className="text-slate-500">Visible entries</p>
          <p className="text-lg font-semibold text-slate-100">{entries.length}</p>
        </div>
        <div className="text-right">
          <p className="text-slate-500">Total tracked</p>
          <p className="font-mono text-lg font-semibold text-cyan-300">{formatDurationClock(visibleTotalSeconds)}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 shadow-2xl backdrop-blur-md">
        {loading ? (
          <div className="p-10 text-center text-slate-500">Loading activity...</div>
        ) : entries.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Clock3 className="mx-auto mb-3 h-8 w-8 text-slate-500" />
            No time entries yet. Start a timer or log a manual block above.
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {groupedEntries.map((group) => (
              <section key={group.key}>
                <header className="flex items-center justify-between bg-slate-900/75 px-5 py-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                    <CalendarDays className="h-4 w-4 text-slate-500" />
                    {group.label}
                  </div>
                  <div className="text-sm font-semibold text-slate-300">{formatDurationCompact(group.totalSeconds)}</div>
                </header>
                <div className="divide-y divide-slate-800/80">
                  {group.entries.map((entry) => {
                    const started = new Date(entry.startedAt);
                    const stopped = entry.stoppedAt ? new Date(entry.stoppedAt) : null;
                    const timeRange = `${started.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - ${
                      stopped ? stopped.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Running"
                    }`;
                    const title = entry.description || entry.action || entry.taskId || "Work session";

                    return (
                      <article key={entry.id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,2.2fr)_180px_120px_200px] md:items-center">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-100">{title}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                            <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-slate-300">
                              {entry.projectName || "No Project"}
                            </span>
                            {entry.goalName ? (
                              <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-slate-300">
                                {entry.goalName}
                              </span>
                            ) : null}
                            {entry.tags.slice(0, 2).map((tag) => (
                              <span key={`${entry.id}-${tag}`} className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-0.5 text-cyan-300">
                                #{tag}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="font-mono text-sm text-slate-300">{timeRange}</div>

                        <div className="font-mono text-sm font-semibold text-slate-100">{formatDurationClock(entry.durationSeconds)}</div>

                        <div className="flex items-center gap-2 md:justify-end">
                          <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${statusPillClass(entry.status)}`}>
                            {entry.status}
                          </span>
                          <span className="text-xs uppercase tracking-wide text-slate-500">{entry.source}</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
