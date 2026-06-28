"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, Clock, FastForward, ListChecks, Play, Plus, Square, TimerReset } from "lucide-react";
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
  action?: () => void;
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
      description: "Owners/managers can create one; members can track unassigned work until a project exists.",
      done: projects.length > 0 || persistedSteps.has("project"),
      href: "/projects",
      cta: "Create project",
    },
    {
      id: "schedule",
      label: "Schedule a work block",
      description: "Dashboard is today; Calendar is for future planning.",
      done: blocks.length > 0 || persistedSteps.has("schedule"),
      action: () => setPlanningOpen(true),
      cta: "Schedule work",
    },
    {
      id: "track",
      label: "Try the live timer",
      description: "Run live work now. More timers can run in the stack.",
      done: activeTimers.length > 0 || persistedSteps.has("track"),
      action: () => startTimer(),
      cta: "Run timer",
    },
    {
      id: "log",
      label: "Log completed work",
      description: "Add work that already happened without a timer.",
      done: persistedSteps.has("log"),
      action: () => { setSelectedBlock(null); setManualOpen(true); },
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
      description: "Get proof out as CSV/JSON or turn approved entries into invoices.",
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

  async function refresh() {
    const [activeRes, scheduleRes, projectsRes, actionsRes] = await Promise.all([
      fetch("/api/timer/active").catch(() => null),
      fetch("/api/schedule?status=planned").catch(() => null),
      fetch("/api/projects").catch(() => null),
      fetch("/api/user/actions").catch(() => null),
    ]);
    if (activeRes?.ok) {
      const data = await activeRes.json();
      const timers = (data.activeEntries ?? []) as ActiveTimer[];
      timers.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      setActiveTimers(timers);
    }
    if (scheduleRes?.ok) {
      const data = await scheduleRes.json();
      const nowMs = Date.now();
      const scheduled = ((data.blocks ?? []) as ScheduledBlock[])
        .filter((block) => block.status === "planned" && new Date(block.endsAt).getTime() >= nowMs)
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
      const recentCutoff = nowMs - 5 * 60 * 1000;
      const recentlyCreated = scheduled
        .filter((block) => block.createdAt && new Date(block.createdAt).getTime() >= recentCutoff)
        .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
      const visible = [...recentlyCreated, ...scheduled].filter((block, index, list) => list.findIndex((item) => item.id === block.id) === index).slice(0, 5);
      setBlocks(visible);
    }
    if (projectsRes?.ok) setProjects((await projectsRes.json()).projects ?? []);
    if (actionsRes?.ok) setActions((await actionsRes.json()).actions ?? []);
  }

  async function refreshOnboarding() {
    const response = await fetch("/api/onboarding").catch(() => null);
    if (!response?.ok) return;
    const data = await response.json() as { onboarding?: OnboardingProgress };
    if (data.onboarding) setOnboarding(data.onboarding);
  }

  async function updateOnboarding(payload: Record<string, unknown>) {
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
  }, []);

  useEffect(() => {
    const onTimeSaved = () => {
      refresh().catch(() => null);
    };
    window.addEventListener("sowledger:time-saved", onTimeSaved);
    return () => window.removeEventListener("sowledger:time-saved", onTimeSaved);
  }, []);

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
      await completeSetupStep("track");
      await refresh();
    } finally {
      setStartingTimer(false);
    }
  }

  async function stopTimer(entryId: string) {
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
    await refresh();
  }

  async function updateBlock(block: ScheduledBlock, updates: Partial<ScheduledBlock>) {
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
    } finally {
      setCreatingPlan(false);
    }
  }

  async function handleManualSaved() {
    await completeSetupStep("log");
    await refresh();
  }

  const focusedElapsed = focusedTimer ? Math.max(0, Math.floor((now - new Date(focusedTimer.startedAt).getTime()) / 1000)) : 0;
  const setupPercent = setupComplete || allSetupStepsDone ? 100 : Math.round((setupDoneCount / setupSteps.length) * 100);

  return (
    <AppPageShell contentClassName="space-y-5">
      <AppPageHeader
        eyebrow="Dashboard"
        title="Today’s command center"
        description="Plan the next block, run live timers, log completed work, and keep today’s billable record moving toward review."
        icon={Clock}
        metadata={[
          {
            label: activeTimers.length === 1 ? "1 active timer" : `${activeTimers.length} active timers`,
            tone: activeTimers.length > 0 ? "emerald" : "slate",
            icon: Clock,
          },
          {
            label: blocks.length === 1 ? "1 queued block" : `${blocks.length} queued blocks`,
            tone: blocks.length > 0 ? "cyan" : "slate",
            icon: CalendarClock,
          },
          {
            label: setupComplete ? "Setup complete" : allSetupStepsDone ? "Ready to finish setup" : `${setupDoneCount}/${setupSteps.length} setup`,
            tone: setupComplete || allSetupStepsDone ? "emerald" : "amber",
            icon: CheckCircle2,
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
            onClick={() => setPlanningOpen((value) => !value)}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
          >
            <Plus className="mr-2 h-4 w-4" />
            Schedule work
          </button>
        }
      />

      <AppWorkflowRail current="track" />

      <section className="grid gap-4 md:grid-cols-3" aria-label="Dashboard counts">
        <AppMetricCard
          label="Live timers"
          value={activeTimers.length}
          detail={focusedTimer ? "Focused timer is running now." : "Ready to start from the focus panel."}
          accent={activeTimers.length > 0 ? "emerald" : "slate"}
          icon={Clock}
        />
        <AppMetricCard
          label="Planning queue"
          value={blocks.length}
          detail={blocks.length > 0 ? "Scheduled blocks are ready for action." : "No queued blocks for the visible window."}
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
                <h2 className="mt-1 text-lg font-semibold text-slate-950">Resume setup when you want a guided path.</h2>
                <p className="mt-1 text-sm text-slate-500">The app still works. Setup progress stays tied to this user and workspace.</p>
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
                  <h2 className="mt-1 text-lg font-semibold text-slate-950">Get from blank workspace to billable proof.</h2>
                  <p className="mt-1 max-w-2xl text-sm text-slate-500">Workspace, project, scheduled work, timer, manual log, review, then export or invoice.</p>
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
                  return <button key={step.id} onClick={step.action} disabled={step.id === "track" && startingTimer} className={className}>{content}</button>;
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

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <div className="min-w-0 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-500">Focused timer</p>
              <h2 className="mt-1 break-words text-2xl font-semibold text-slate-950">{focusedTimer ? focusedTimer.taskId : "Ready when you are"}</h2>
              <p className="mt-1 text-sm text-slate-500">Primary surface for live work and today’s timer context.</p>
            </div>
            {activeTimers.length > 0 && (
              <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700">
                {activeTimers.length} running
              </span>
            )}
          </div>

          <div className="mt-5 rounded-[24px] border border-cyan-100 bg-cyan-50/70 p-4 sm:p-5">
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(180px,220px)] md:items-end">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-cyan-800">Elapsed</p>
                <div className="mt-2 max-w-full overflow-hidden font-mono text-5xl font-semibold tabular-nums text-slate-950">{fmt(focusedElapsed)}</div>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div className="min-w-0 rounded-2xl border border-cyan-100 bg-white/80 px-3 py-2">
                    <dt className="font-semibold text-slate-500">Project</dt>
                    <dd className="mt-1 truncate font-bold text-slate-900">{focusedTimer?.projectName || (projectId ? projectNameById.get(projectId) : "Unassigned")}</dd>
                  </div>
                  <div className="min-w-0 rounded-2xl border border-cyan-100 bg-white/80 px-3 py-2">
                    <dt className="font-semibold text-slate-500">Work type</dt>
                    <dd className="mt-1 truncate font-bold text-slate-900">{focusedTimer?.action || (actionId ? actions.find((action) => action.id === actionId)?.name ?? "No rate selected" : "No rate selected")}</dd>
                  </div>
                </dl>
              </div>
              {focusedTimer ? (
                <div className="grid gap-2">
                  <button
                    onClick={() => stopTimer(focusedTimer.id)}
                    className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-rose-500 px-5 text-sm font-bold text-white transition hover:bg-rose-400"
                  >
                    <Square className="mr-2 h-4 w-4 fill-white" />
                    Stop focused timer
                  </button>
                  <button
                    onClick={() => startTimer()}
                    disabled={startingTimer}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-cyan-200 bg-white px-5 text-sm font-bold text-slate-800 transition hover:border-cyan-300 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Play className="mr-2 h-4 w-4 fill-current" />
                    Start another timer
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => startTimer()}
                  disabled={startingTimer}
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
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-950 outline-none transition focus:border-cyan-500 focus:bg-white">
                <option value="">No project</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <label className="min-w-0 text-sm font-semibold text-slate-700">
              Work type
              <select value={actionId} onChange={(e) => setActionId(e.target.value)} className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-950 outline-none transition focus:border-cyan-500 focus:bg-white">
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
            <div className="mt-5 rounded-[24px] border border-cyan-100 bg-cyan-50/60 p-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
                <label className="min-w-0 text-sm font-semibold text-slate-700">
                  Title
                  <input value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-cyan-100 bg-white px-3 text-sm outline-none focus:border-cyan-500" />
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
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-500">Planning queue</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">Up next</h2>
              <p className="mt-1 text-sm text-slate-500">Scheduled work that can become a timer or completed log.</p>
            </div>
            <CalendarClock className="h-5 w-5 shrink-0 text-cyan-700" />
          </div>
          <div className="mt-5 space-y-3">
            {blocks.length === 0 ? (
              <AppEmptyState
                icon={ListChecks}
                title="No scheduled work queued"
                description="Schedule the next block from here or use Calendar for a fuller week view."
                className="rounded-[24px] p-6"
                action={
                  <button
                    onClick={() => setPlanningOpen(true)}
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
                    Unavailable, OOO, and external-calendar blocks protect planning time and cannot be started or logged as completed work.
                  </div>
                ) : (
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
                    <button onClick={() => startTimer(block)} disabled={startingTimer} className="min-h-10 rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold leading-4 text-white disabled:cursor-not-allowed disabled:opacity-60">Start timer</button>
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
            <p className="text-sm font-semibold text-slate-500">Concurrent timer stack</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">All running timers</h2>
            <p className="mt-1 text-sm text-slate-500">Secondary view for overlaps so live work does not disappear behind the focused timer.</p>
          </div>
          <TimerReset className="h-5 w-5 shrink-0 text-slate-400" />
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {activeTimers.length === 0 ? (
            <AppEmptyState
              icon={Clock}
              title="No live timers"
              description="Start a timer from the focus panel or from scheduled work in the planning queue."
              className="rounded-[24px] p-6 lg:col-span-2"
            />
          ) : activeTimers.map((timer, index) => {
            const elapsed = Math.max(0, Math.floor((now - new Date(timer.startedAt).getTime()) / 1000));
            const timerProjectLabel = timer.projectName || "No project";
            return (
              <article key={timer.id} className={`flex min-w-0 flex-col gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${index === 0 ? "border-cyan-200 bg-cyan-50" : "border-slate-200 bg-slate-50"}`}>
                <div className="min-w-0">
                  <div className="font-mono text-2xl font-semibold tabular-nums text-slate-950">{fmt(elapsed)}</div>
                  <p className="mt-1 break-words text-sm font-semibold text-slate-800">{timer.taskId}</p>
                  <p className="text-xs text-slate-500">{timerProjectLabel}{timer.action ? ` · ${timer.action}` : ""}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {index !== 0 && <FastForward className="h-4 w-4 text-slate-400" />}
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

      <ManualTimeDialog open={manualOpen} onOpenChange={setManualOpen} scheduledBlock={selectedBlock} onSaved={handleManualSaved} defaultTaskId={taskId} defaultProjectId={projectId} defaultDescription={notes} />
    </AppPageShell>
  );
}
