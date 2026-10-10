"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, Clock, FastForward, ListChecks, Play, Pause, Plus, Square, TimerReset } from "lucide-react";
import { toast } from "sonner";

import { AppEmptyState, AppMetricCard, AppPageHeader, AppPageShell, AppWorkflowRail } from "@/components/app-page-shell";
import { ManualTimeDialog } from "@/components/manual-time-dialog";
import { isUnavailableScheduledBlock } from "@/lib/scheduled-block-guards";

type Project = { id: string; name: string };
type Action = { id: string; name: string; hourlyRate?: number | null };
type ActiveTimer = {
  id: string;
  scheduledBlockId?: string | null;
  taskId: string;
  projectId?: string | null;
  projectName?: string | null;
  action?: string | null;
  tags?: string[];
  startedAt: string;
  isPaused: boolean;
  pausedAt: string | null;
  accumulatedSeconds: number;
};
type ScheduledBlock = {
  id: string;
  title: string;
  projectId: string | null;
  taskId: string | null;
  actionId: string | null;
  notes: string | null;
  tags: string[];
  startsAt: string;
  endsAt: string;
  status: "planned" | "in_progress" | "completed" | "skipped" | "canceled";
  createdAt?: string;
};
type StopTimerResponse = {
  error?: string;
  durationSeconds?: number;
  adjustedForDailyLimit?: boolean;
  message?: string;
};
type OnboardingProgress = {
  completedSteps: string[];
  skippedAt: string | null;
  completedAt: string | null;
};
type SetupStep = {
  id: string;
  label: string;
  description: string;
  done: boolean;
  href?: string;
  action?: "schedule" | "track" | "log";
  cta: string;
};

function fmt(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function timeRange(block: ScheduledBlock) {
  const start = new Date(block.startsAt);
  const end = new Date(block.endsAt);
  return `${start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - ${end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function toLocalInput(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export function TimerDashboard() {
  const [now, setNow] = useState(() => Date.now());
  const [activeTimers, setActiveTimers] = useState<ActiveTimer[]>([]);
  const [blocks, setBlocks] = useState<ScheduledBlock[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [taskId, setTaskId] = useState("General work");
  const [projectId, setProjectId] = useState("");
  const [actionId, setActionId] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<ScheduledBlock | null>(null);
  const [planningOpen, setPlanningOpen] = useState(false);
  const [planTitle, setPlanTitle] = useState("Focused work block");
  const [planStart, setPlanStart] = useState(() => toLocalInput(new Date(Date.now() + 30 * 60 * 1000)));
  const [planEnd, setPlanEnd] = useState(() => toLocalInput(new Date(Date.now() + 90 * 60 * 1000)));
  const [onboarding, setOnboarding] = useState<OnboardingProgress>({ completedSteps: [], skippedAt: null, completedAt: null });
  const [startingTimer, setStartingTimer] = useState(false);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [timersLoading, setTimersLoading] = useState(true);
  const [timersError, setTimersError] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleError, setScheduleError] = useState(false);
  const [choicesLoading, setChoicesLoading] = useState(true);
  const [choicesError, setChoicesError] = useState(false);
  const refreshSequence = useRef(0);
  const loading = timersLoading || scheduleLoading || choicesLoading;
  const loadError = timersError || scheduleError || choicesError;

  function showPlanningForm() {
    setPlanningOpen(true);
    window.requestAnimationFrame(() => {
      const input = document.getElementById("dashboard-schedule-title");
      input?.scrollIntoView({ block: "center" });
      input?.focus({ preventScroll: true });
    });
  }

  const projectNameById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const focusedTimer = activeTimers[0] ?? null;
  const persistedSteps = useMemo(() => new Set(onboarding.completedSteps), [onboarding.completedSteps]);
  const setupSteps: SetupStep[] = [
    {
      id: "workspace",
      label: "Confirm workspace basics",
      description: "Name, timezone, currency, and who can approve or export.",
      done: persistedSteps.has("workspace"),
      href: "/settings",
      cta: "Open settings",
    },
    {
      id: "project",
      label: "Create the first project",
      description: "Group your time by project. You can also track work without one.",
      done: projects.length > 0 || persistedSteps.has("project"),
      href: "/projects",
      cta: "Create project",
    },
    {
      id: "schedule",
      label: "Schedule a work block",
      description: "Set aside time for your next task.",
      done: blocks.length > 0 || persistedSteps.has("schedule"),
      action: "schedule",
      cta: "Schedule work",
    },
    {
      id: "track",
      label: "Try the live timer",
      description: "Start tracking. You can run more than one timer.",
      done: activeTimers.length > 0 || persistedSteps.has("track"),
      action: "track",
      cta: "Run timer",
    },
    {
      id: "log",
      label: "Log completed work",
      description: "Add work that already happened without a timer.",
      done: persistedSteps.has("log"),
      action: "log",
      cta: "Log work",
    },
    {
      id: "review",
      label: "Review the record",
      description: "Activity is where you correct time before approvals or billing.",
      done: persistedSteps.has("review"),
      href: "/activity",
      cta: "Open Activity",
    },
    {
      id: "output",
      label: "Export or invoice",
      description: "Download time records or invoice approved work.",
      done: persistedSteps.has("output"),
      href: "/exports",
      cta: "Open Exports",
    },
  ];
  const setupDoneCount = setupSteps.filter((step) => step.done).length;
  const allSetupStepsDone = setupDoneCount === setupSteps.length;
  const setupComplete = Boolean(onboarding.completedAt);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const isCurrent = () => sequence === refreshSequence.current;
    setTimersLoading(true);
    setScheduleLoading(true);
    setChoicesLoading(true);

    // Consume each source independently so optional data cannot hide live controls.
    await Promise.all([
      (async () => {
        try {
          const response = await fetch("/api/timer/active");
          if (!response.ok) throw new Error("Timers unavailable");
          const data = await response.json();
          if (!Array.isArray(data.activeEntries)) throw new Error("Timers unavailable");
          const timers = (data.activeEntries as ActiveTimer[]).sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
          if (isCurrent()) {
            setActiveTimers(timers);
            setTimersError(false);
          }
        } catch {
          if (isCurrent()) setTimersError(true);
        } finally {
          if (isCurrent()) setTimersLoading(false);
        }
      })(),
      (async () => {
        try {
          const response = await fetch("/api/schedule?status=planned");
          if (!response.ok) throw new Error("Schedule unavailable");
          const data = await response.json();
          if (!Array.isArray(data.blocks)) throw new Error("Schedule unavailable");
          const nowMs = Date.now();
          const scheduled = (data.blocks as ScheduledBlock[])
            .filter((block) => block.status === "planned" && new Date(block.endsAt).getTime() >= nowMs)
            .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
          const recentCutoff = nowMs - 5 * 60 * 1000;
          const recentlyCreated = scheduled
            .filter((block) => block.createdAt && new Date(block.createdAt).getTime() >= recentCutoff)
            .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
          const visible = [...recentlyCreated, ...scheduled].filter((block, index, list) => list.findIndex((item) => item.id === block.id) === index).slice(0, 5);
          if (isCurrent()) {
            setBlocks(visible);
            setScheduleError(false);
          }
        } catch {
          if (isCurrent()) setScheduleError(true);
        } finally {
          if (isCurrent()) setScheduleLoading(false);
        }
      })(),
      (async () => {
        try {
          const [projectsRes, actionsRes] = await Promise.all([fetch("/api/projects"), fetch("/api/user/actions")]);
          if (!projectsRes.ok || !actionsRes.ok) throw new Error("Choices unavailable");
          const [projectData, actionData] = await Promise.all([projectsRes.json(), actionsRes.json()]);
          if (!Array.isArray(projectData.projects) || !Array.isArray(actionData.actions)) throw new Error("Choices unavailable");
          if (isCurrent()) {
            setProjects(projectData.projects);
            setActions(actionData.actions);
            setChoicesError(false);
          }
        } catch {
          if (isCurrent()) setChoicesError(true);
        } finally {
          if (isCurrent()) setChoicesLoading(false);
        }
      })(),
    ]);
  }, []);

  async function refreshOnboarding() {
    const response = await fetch("/api/onboarding").catch(() => null);
    if (!response?.ok) return;
    const data = await response.json() as { onboarding?: OnboardingProgress };
    if (data.onboarding) setOnboarding(data.onboarding);
  }

  async function updateOnboarding(payload: Record<string, unknown>) {
    try {
      const response = await fetch("/api/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json() as { onboarding?: OnboardingProgress; error?: string };
      if (!response.ok) {
        toast.error("Could not update setup progress", { description: data.error });
        return;
      }
      if (data.onboarding) setOnboarding(data.onboarding);
    } catch {
      toast.error("Could not save setup progress", { description: "Check your connection and try again." });
    }
  }

  async function completeSetupStep(step: string) {
    if (persistedSteps.has(step)) return;
    await updateOnboarding({ step, skipped: false });
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      Promise.all([
        refresh(),
        refreshOnboarding(),
      ]).catch(() => toast.error("Unable to load timer workspace"));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  useEffect(() => {
    const onTimeSaved = () => {
      refresh().catch(() => null);
    };
    window.addEventListener("sowledger:time-saved", onTimeSaved);
    window.addEventListener("sowledger:calendar-updated", onTimeSaved);
    return () => {
      window.removeEventListener("sowledger:time-saved", onTimeSaved);
      window.removeEventListener("sowledger:calendar-updated", onTimeSaved);
    };
  }, [refresh]);

  async function startTimer(block?: ScheduledBlock) {
    if (startingTimer) return;
    if (block && isUnavailableScheduledBlock(block)) {
      toast.error("Unavailable calendar blocks cannot become timers.");
      return;
    }

    const payload = block ? {
      taskId: block.taskId || block.title,
      projectId: block.projectId || undefined,
      actionId: block.actionId || undefined,
      description: block.notes || block.title,
      tags: block.tags,
      scheduledBlockId: block.id,
    } : {
      taskId: taskId.trim(),
      projectId: projectId || undefined,
      actionId: actionId || undefined,
      description: notes || undefined,
      tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    };

    if (!payload.taskId) {
      toast.error("Add a task or work label before starting.");
      return;
    }

    setStartingTimer(true);
    try {
      const response = await fetch("/api/timer/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error("Could not start timer", { description: data.error });
        return;
      }
      toast.success("Timer started");
      window.dispatchEvent(new Event("sowledger:time-saved"));
      await completeSetupStep("track");
      await refresh();
    } catch {
      toast.error("Could not start timer", { description: "Check your connection and try again." });
    } finally {
      setStartingTimer(false);
    }
  }

  async function stopTimer(entryId: string) {
    try {
      const response = await fetch("/api/timer/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId }),
      });
      const data = await response.json() as StopTimerResponse;
      if (!response.ok) {
        toast.error("Could not stop timer", { description: data.error });
        return;
      }
      if (data.adjustedForDailyLimit) {
        toast.warning("Timer stopped with an adjustment", {
          description: data.message ?? `Logged ${fmt(data.durationSeconds ?? 0)} without exceeding the 24-hour day limit.`,
        });
      } else {
        toast.success("Time logged", { description: fmt(data.durationSeconds ?? 0) });
      }
      // Activity may have mounted while this request was still saving.
      window.dispatchEvent(new Event("sowledger:time-saved"));
      await refresh();
    } catch {
      toast.error("Could not stop timer", { description: "Check your connection and try again." });
    }
  }

  async function pauseTimer(entryId: string) {
    try {
      const response = await fetch("/api/timer/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId }),
      });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        toast.error("Could not pause timer", { description: data.error });
        return;
      }
      await refresh();
    } catch {
      toast.error("Could not pause timer", { description: "Check your connection and try again." });
    }
  }

  async function resumeTimer(entryId: string) {
    try {
      const response = await fetch("/api/timer/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId }),
      });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        toast.error("Could not resume timer", { description: data.error });
        return;
      }
      await refresh();
    } catch {
      toast.error("Could not resume timer", { description: "Check your connection and try again." });
    }
  }

  async function updateBlock(block: ScheduledBlock, updates: Partial<ScheduledBlock>) {
    try {
      const response = await fetch("/api/schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockId: block.id, ...updates }),
      });
      if (!response.ok) {
        const data = await response.json();
        toast.error("Could not update scheduled work", { description: data.error });
        return false;
      }
      await refresh();
      return true;
    } catch {
      toast.error("Could not update scheduled work", { description: "Check your connection and try again." });
      return false;
    }
  }

  async function rescheduleTomorrow(block: ScheduledBlock) {
    const start = new Date(block.startsAt);
    const end = new Date(block.endsAt);
    start.setDate(start.getDate() + 1);
    end.setDate(end.getDate() + 1);
    const updated = await updateBlock(block, { startsAt: start.toISOString(), endsAt: end.toISOString() } as Partial<ScheduledBlock>);
    if (updated) toast.success("Moved to tomorrow");
  }

  async function createPlan() {
    if (creatingPlan) return;

    const startsAt = new Date(planStart);
    const endsAt = new Date(planEnd);
    if (!planTitle.trim() || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      toast.error("Enter a valid scheduled work block.");
      return;
    }

    setCreatingPlan(true);
    try {
      const response = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: planTitle.trim(),
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          projectId: projectId || undefined,
          actionId: actionId || undefined,
          taskId: taskId.trim() || undefined,
          notes: notes || undefined,
          tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error("Could not schedule work", { description: data.error });
        return;
      }
      const createdBlock = data.block as ScheduledBlock | undefined;
      if (createdBlock) {
        setBlocks((current) => [createdBlock, ...current.filter((block) => block.id !== createdBlock.id)].slice(0, 5));
      }
      toast.success("Work scheduled");
      setPlanningOpen(false);
      await completeSetupStep("schedule");
      await refresh();
    } catch {
      toast.error("Could not schedule work", { description: "Check your connection and try again." });
    } finally {
      setCreatingPlan(false);
    }
  }

  async function handleManualSaved() {
    await completeSetupStep("log");
    await refresh();
  }

  let focusedElapsed = 0;
  if (focusedTimer && focusedTimer.startedAt) {
    const startTs = new Date(focusedTimer.startedAt).getTime();
    const totalElapsed = Math.floor((now - startTs) / 1000);
    const pausedSince = focusedTimer.isPaused && focusedTimer.pausedAt ? Math.floor((now - new Date(focusedTimer.pausedAt).getTime()) / 1000) : 0;
    focusedElapsed = Math.max(0, totalElapsed - (focusedTimer.accumulatedSeconds || 0) - pausedSince);
  }
  const setupPercent = setupComplete || allSetupStepsDone ? 100 : Math.round((setupDoneCount / setupSteps.length) * 100);

  return (
    <AppPageShell contentClassName="space-y-5">
      <AppPageHeader
        className="p-4 sm:p-6"
        title="Your time today"
        description="Track work as you go, or add time you have already completed."
        icon={Clock}
        metadata={loading || loadError ? [] : [
          {
            label: activeTimers.length === 1 ? "1 active timer" : `${activeTimers.length} active timers`,
            tone: activeTimers.length > 0 ? "emerald" : "slate",
            icon: Clock,
          },
          {
            label: blocks.length === 1 ? "1 upcoming block" : `${blocks.length} upcoming blocks`,
            tone: blocks.length > 0 ? "cyan" : "slate",
            icon: CalendarClock,
          },
        ]}
        secondaryAction={
          <button
            onClick={() => { setSelectedBlock(null); setManualOpen(true); }}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-cyan-300 hover:text-cyan-700"
          >
            Log completed work
          </button>
        }
        primaryAction={
          <button
            onClick={showPlanningForm}
            aria-expanded={planningOpen}
            aria-controls="dashboard-schedule-form"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
          >
            <Plus className="mr-2 h-4 w-4" />
            Schedule work
          </button>
        }
      />

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="space-y-1">
            {timersError && <p>Could not refresh your timers. Previously loaded timers may be out of date; you can still try to pause or stop them.</p>}
            {scheduleError && <p>Could not load your scheduled work. Retry to see your upcoming tasks.</p>}
            {choicesError && <p>Could not load projects or work types. Retry to choose them for new work.</p>}
            {!timersError && (scheduleError || choicesError) && <p>Your timer controls are still available.</p>}
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading} className="shrink-0 font-semibold underline">{loading ? "Retrying..." : "Retry dashboard"}</button>
        </div>
      )}


      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <div className="min-w-0 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-500">Focused timer</p>
              <h2 className="mt-1 break-words text-2xl font-semibold text-slate-950">{focusedTimer ? focusedTimer.taskId : timersLoading ? "Loading timers..." : timersError ? "Timers unavailable" : "Ready when you are"}</h2>
              <p className="mt-1 text-sm text-slate-500">{focusedTimer ? "Pause for a break or stop to save this time." : "Choose a task and start tracking."}</p>
            </div>
            {activeTimers.length > 0 && (
              <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700">
                {activeTimers.length} active
              </span>
            )}
          </div>

          <div className="mt-5 rounded-[24px] border border-cyan-100 bg-cyan-50/70 p-4 sm:p-5">
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(180px,220px)] md:items-end">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-cyan-800">
                  {focusedTimer?.isPaused ? "Elapsed (Paused)" : "Elapsed"}
                </p>
                <div className={`mt-2 max-w-full overflow-hidden font-mono text-5xl font-semibold tabular-nums ${focusedTimer?.isPaused ? "text-slate-400" : "text-slate-950"}`}>
                  {!focusedTimer && (timersLoading || timersError) ? "--:--:--" : fmt(focusedElapsed)}
                </div>
                <p className="mt-3 truncate text-sm text-slate-600">{focusedTimer?.projectName || (projectId ? projectNameById.get(projectId) : "No project")}{focusedTimer?.action ? ` · ${focusedTimer.action}` : ""}</p>
              </div>
              {focusedTimer ? (
                <div className="grid gap-2">
                  {focusedTimer.isPaused ? (
                    <button
                      onClick={() => resumeTimer(focusedTimer.id)}
                      className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-teal-600 px-5 text-sm font-bold text-white transition hover:bg-teal-500"
                    >
                      <Play className="mr-2 h-4 w-4 fill-white" />
                      Resume timer
                    </button>
                  ) : (
                    <button
                      onClick={() => pauseTimer(focusedTimer.id)}
                      className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-amber-500 px-5 text-sm font-bold text-white transition hover:bg-amber-400"
                    >
                      <Pause className="mr-2 h-4 w-4 fill-white" />
                      Pause timer
                    </button>
                  )}
                  <button
                    onClick={() => stopTimer(focusedTimer.id)}
                    className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-rose-500 px-5 text-sm font-bold text-white transition hover:bg-rose-400"
                  >
                    <Square className="mr-2 h-4 w-4 fill-white" />
                    Stop focused timer
                  </button>
                  <button
                    onClick={() => startTimer()}
                    disabled={startingTimer || timersLoading || timersError}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-cyan-200 bg-white px-5 text-sm font-bold text-slate-800 transition hover:border-cyan-300 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Play className="mr-2 h-4 w-4 fill-current" />
                    Start another timer
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => startTimer()}
                  disabled={startingTimer || timersLoading || timersError}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-slate-950 px-5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Play className="mr-2 h-4 w-4 fill-current" />
                  Start timer
                </button>
              )}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <label className="min-w-0 text-sm font-semibold text-slate-700">
              Work label
              <input value={taskId} onChange={(e) => setTaskId(e.target.value)} placeholder="What are you working on?" className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-950 outline-none transition focus:border-cyan-500 focus:bg-white" />
            </label>
            <label className="min-w-0 text-sm font-semibold text-slate-700">
              Project
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={choicesLoading || choicesError} className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-950 outline-none transition focus:border-cyan-500 focus:bg-white disabled:opacity-60">
                <option value="">No project</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <label className="min-w-0 text-sm font-semibold text-slate-700">
              Work type
              <select value={actionId} onChange={(e) => setActionId(e.target.value)} disabled={choicesLoading || choicesError} className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-950 outline-none transition focus:border-cyan-500 focus:bg-white disabled:opacity-60">
                <option value="">No work type rate</option>
                {actions.map((action) => <option key={action.id} value={action.id}>{action.name}{action.hourlyRate ? ` ($${action.hourlyRate}/hr)` : ""}</option>)}
              </select>
            </label>
            <label className="min-w-0 text-sm font-semibold text-slate-700 md:col-span-2">
              Notes
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-950 outline-none transition focus:border-cyan-500 focus:bg-white" />
            </label>
            <label className="min-w-0 text-sm font-semibold text-slate-700">
              Tags
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="design, research" className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-950 outline-none transition focus:border-cyan-500 focus:bg-white" />
            </label>
          </div>

          {planningOpen && (
            <div id="dashboard-schedule-form" className="mt-5 scroll-mt-4 rounded-[24px] border border-cyan-100 bg-cyan-50/60 p-4">
              <div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-semibold">Schedule work</h3><button type="button" onClick={() => setPlanningOpen(false)} className="text-sm font-semibold text-slate-600">Close schedule form</button></div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
                <label className="min-w-0 text-sm font-semibold text-slate-700">
                  Title
                  <input id="dashboard-schedule-title" value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-cyan-100 bg-white px-3 text-sm outline-none focus:border-cyan-500" />
                </label>
                <label className="min-w-0 text-sm font-semibold text-slate-700">
                  Start
                  <input type="datetime-local" value={planStart} onChange={(e) => setPlanStart(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-cyan-100 bg-white px-3 text-sm outline-none focus:border-cyan-500" />
                </label>
                <label className="min-w-0 text-sm font-semibold text-slate-700">
                  End
                  <input type="datetime-local" value={planEnd} onChange={(e) => setPlanEnd(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-cyan-100 bg-white px-3 text-sm outline-none focus:border-cyan-500" />
                </label>
                <button onClick={createPlan} disabled={creatingPlan} className="min-h-11 rounded-xl bg-cyan-600 px-4 text-sm font-bold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60">Save scheduled work</button>
              </div>
            </div>
          )}
        </div>

        <aside className="min-w-0 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-500">Upcoming work</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">Up next</h2>
              <p className="mt-1 text-sm text-slate-500">Start a timer or log time for your next planned task.</p>
            </div>
            <button
              onClick={showPlanningForm}
              className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-slate-800"
            >
              <Plus className="mr-2 h-4 w-4" />
              Schedule work
            </button>
          </div>
          <div className="mt-5 space-y-3">
            {scheduleLoading ? <p className="text-sm text-slate-500" role="status">Loading scheduled work...</p> : scheduleError ? <p className="text-sm text-slate-600">Schedule unavailable. Use Retry dashboard above to reload it.</p> : blocks.length === 0 ? (
              <AppEmptyState
                icon={ListChecks}
                title="Nothing scheduled yet"
                description="Schedule a task here, or open Calendar to plan your week."
                className="rounded-[24px] p-6"
                action={
                  <button
                    onClick={showPlanningForm}
                    className="inline-flex min-h-10 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-slate-800"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Schedule work
                  </button>
                }
              />
            ) : blocks.map((block) => (
              <article key={block.id} className={`rounded-2xl border p-4 ${isUnavailableScheduledBlock(block) ? "border-slate-200 bg-slate-100" : "border-slate-200 bg-slate-50"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-slate-950">{block.title}</p>
                    <p className="mt-1 text-sm text-slate-500">{timeRange(block)}{block.projectId ? ` · ${projectNameById.get(block.projectId) ?? "Project"}` : ""}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-500">{isUnavailableScheduledBlock(block) ? "blocked" : "scheduled"}</span>
                </div>
                {isUnavailableScheduledBlock(block) ? (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold leading-5 text-slate-600">
                    Unavailable time cannot be started or logged as completed work.
                  </div>
                ) : (
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
                    <button onClick={() => startTimer(block)} disabled={startingTimer || timersLoading || timersError} className="min-h-10 rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold leading-4 text-white disabled:cursor-not-allowed disabled:opacity-60">Start timer</button>
                    <button onClick={() => { setSelectedBlock(block); setManualOpen(true); }} className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold leading-4 text-slate-700">Log completed work</button>
                    <button onClick={() => rescheduleTomorrow(block)} className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold leading-4 text-slate-700">Tomorrow</button>
                    <button onClick={() => updateBlock(block, { status: "skipped" })} className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold leading-4 text-slate-700">Skip</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-500">Active timers</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">All active timers</h2>
            <p className="mt-1 text-sm text-slate-500">Manage every timer, including paused sessions.</p>
          </div>
          <TimerReset className="h-5 w-5 shrink-0 text-slate-400" />
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {activeTimers.length === 0 && timersLoading ? <p className="text-sm text-slate-500" role="status">Loading timers...</p> : activeTimers.length === 0 && timersError ? <p className="text-sm text-slate-600">Timer list unavailable. Use Retry dashboard above to reload it.</p> : activeTimers.length === 0 ? (
            <AppEmptyState
              icon={Clock}
              title="No live timers"
              description="Start a timer above or choose a scheduled task."
              className="rounded-[24px] p-6 lg:col-span-2"
            />
          ) : activeTimers.map((timer, index) => {
            let elapsed = 0;
            if (timer.startedAt) {
              const startTimestamp = new Date(timer.startedAt).getTime();
              const totalElapsed = Math.floor((now - startTimestamp) / 1000);
              const pausedSince = timer.isPaused && timer.pausedAt ? Math.floor((now - new Date(timer.pausedAt).getTime()) / 1000) : 0;
              elapsed = Math.max(0, totalElapsed - (timer.accumulatedSeconds || 0) - pausedSince);
            }
            const timerProjectLabel = timer.projectName || "No project";
            return (
              <article key={timer.id} className={`flex min-w-0 flex-col gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${index === 0 ? "border-cyan-200 bg-cyan-50" : "border-slate-200 bg-slate-50"}`}>
                <div className="min-w-0">
                  <div className={`font-mono text-2xl font-semibold tabular-nums ${timer.isPaused ? "text-slate-400" : "text-slate-950"}`}>{fmt(elapsed)}</div>
                  <p className="mt-1 break-words text-sm font-semibold text-slate-800">{timer.taskId}</p>
                  <p className="text-xs text-slate-500">{timerProjectLabel}{timer.action ? ` · ${timer.action}` : ""} {timer.isPaused && "· Paused"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {index !== 0 && <FastForward className="h-4 w-4 text-slate-400" />}
                  {timer.isPaused ? (
                    <button
                      onClick={() => resumeTimer(timer.id)}
                      className="inline-flex min-h-10 items-center justify-center rounded-2xl bg-teal-600 px-4 text-sm font-bold text-white transition hover:bg-teal-500"
                    >
                      Resume
                    </button>
                  ) : (
                    <button
                      onClick={() => pauseTimer(timer.id)}
                      className="inline-flex min-h-10 items-center justify-center rounded-2xl bg-amber-500 px-4 text-sm font-bold text-white transition hover:bg-amber-400"
                    >
                      Pause
                    </button>
                  )}
                  <button
                    onClick={() => stopTimer(timer.id)}
                    aria-label={`Stop timer for ${timer.taskId} in ${timerProjectLabel}`}
                    className="inline-flex min-h-10 items-center justify-center rounded-2xl bg-rose-500 px-4 text-sm font-bold text-white transition hover:bg-rose-400"
                  >
                    <Square className="mr-2 h-3 w-3 fill-white" />
                    Stop
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <details className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">Workspace setup and shortcuts · {setupDoneCount} of {setupSteps.length} complete</summary>
        <div className="mt-4 space-y-4">
      <AppWorkflowRail current="track" />

      <section className="grid gap-4 md:grid-cols-3" aria-label="Dashboard counts">
        <AppMetricCard
          label="Live timers"
          value={timersLoading || timersError ? "—" : activeTimers.length}
          detail={timersError ? "Timer count is unavailable. Retry above." : focusedTimer ? "A timer is active or paused." : "Start tracking from the timer above."}
          accent={activeTimers.length > 0 ? "emerald" : "slate"}
          icon={Clock}
        />
        <AppMetricCard
          label="Upcoming work"
          value={scheduleLoading || scheduleError ? "—" : blocks.length}
          detail={scheduleError ? "Schedule count is unavailable. Retry above." : blocks.length > 0 ? "Your next scheduled tasks." : "No upcoming work loaded."}
          accent={blocks.length > 0 ? "cyan" : "slate"}
          icon={ListChecks}
        />
        <AppMetricCard
          label="Setup progress"
          value={`${setupPercent}%`}
          detail={`${setupDoneCount} of ${setupSteps.length} checklist items complete.`}
          accent={setupComplete || allSetupStepsDone ? "emerald" : "amber"}
          icon={CheckCircle2}
        />
      </section>

      {!setupComplete && (
        <section className="rounded-[28px] border border-cyan-100 bg-white p-4 shadow-sm sm:p-5" aria-label="Setup checklist">
          {onboarding.skippedAt ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase text-cyan-700">Setup hidden</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">Continue setup when you are ready.</h2>
                <p className="mt-1 text-sm text-slate-500">Your progress is saved. You can keep tracking time in the meantime.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => updateOnboarding({ skipped: false, completed: false })}
                  className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-slate-800"
                >
                  Resume setup
                </button>
                {allSetupStepsDone && (
                  <button
                    onClick={() => updateOnboarding({ completed: true })}
                    className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-4 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100"
                  >
                    Finish setup
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase text-cyan-700">Setup checklist</p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-950">Set up your workspace at your own pace.</h2>
                  <p className="mt-1 max-w-2xl text-sm text-slate-500">A few steps to try planning, tracking, and billing your work.</p>
                </div>
                <div className="w-full shrink-0 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:w-72">
                  <div className="flex items-center justify-between text-sm font-bold text-slate-700">
                    <span>{setupDoneCount} of {setupSteps.length} complete</span>
                    <span>{setupPercent}%</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                    <div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${setupPercent}%` }} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => updateOnboarding({ skipped: true })}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-cyan-200 hover:text-cyan-700"
                    >
                      Skip for now
                    </button>
                    {allSetupStepsDone && (
                      <button
                        onClick={() => updateOnboarding({ completed: true })}
                        className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-slate-800"
                      >
                        Finish setup
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {setupSteps.map((step) => {
                  const content = (
                    <>
                      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${step.done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                        <CheckCircle2 className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold">{step.label}</span>
                        <span className="mt-1 block text-xs font-medium leading-5 text-slate-500">{step.description}</span>
                        {!step.done && (
                          <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-cyan-700">
                            {step.cta}
                            <ArrowRight className="h-3 w-3" />
                          </span>
                        )}
                      </span>
                    </>
                  );
                  const className = `flex min-h-24 items-start gap-3 rounded-2xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${step.done ? "border-emerald-100 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-slate-50 text-slate-800 hover:border-cyan-200 hover:bg-cyan-50"}`;
                  if (step.href) {
                    return <Link key={step.id} href={step.href} onClick={() => completeSetupStep(step.id)} className={className}>{content}</Link>;
                  }
                  return <button key={step.id} onClick={() => {
                    if (step.action === "schedule") showPlanningForm();
                    if (step.action === "track") void startTimer();
                    if (step.action === "log") { setSelectedBlock(null); setManualOpen(true); }
                  }} disabled={step.id === "track" && (startingTimer || timersLoading || timersError)} className={className}>{content}</button>;
                })}
              </div>
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
                <Link href="/people" onClick={() => completeSetupStep("invite")} className="rounded-full border border-slate-200 px-3 py-1.5 font-bold hover:border-cyan-200 hover:text-cyan-700">Optional: invite teammate</Link>
                <Link href="/settings/developers" onClick={() => completeSetupStep("integrate")} className="rounded-full border border-slate-200 px-3 py-1.5 font-bold hover:border-cyan-200 hover:text-cyan-700">Optional: create API key</Link>
                <Link href="/support" className="rounded-full border border-slate-200 px-3 py-1.5 font-bold hover:border-cyan-200 hover:text-cyan-700">Read support guide</Link>
              </div>
            </div>
          )}
        </section>
      )}

        </div>
      </details>


      <ManualTimeDialog open={manualOpen} onOpenChange={setManualOpen} scheduledBlock={selectedBlock} onSaved={handleManualSaved} defaultTaskId={taskId} defaultProjectId={projectId} defaultDescription={notes} />
    </AppPageShell>
  );
}
