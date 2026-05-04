"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, Clock, FastForward, ListChecks, Play, Plus, Square, TimerReset } from "lucide-react";
import { toast } from "sonner";

import { ManualTimeDialog } from "@/components/manual-time-dialog";

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
  const setupComplete = setupDoneCount === setupSteps.length || Boolean(onboarding.completedAt);

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
    window.addEventListener("billabled:time-saved", onTimeSaved);
    return () => window.removeEventListener("billabled:time-saved", onTimeSaved);
  }, []);

  async function startTimer(block?: ScheduledBlock) {
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
      return;
    }
    await refresh();
  }

  async function rescheduleTomorrow(block: ScheduledBlock) {
    const start = new Date(block.startsAt);
    const end = new Date(block.endsAt);
    start.setDate(start.getDate() + 1);
    end.setDate(end.getDate() + 1);
    await updateBlock(block, { startsAt: start.toISOString(), endsAt: end.toISOString() } as Partial<ScheduledBlock>);
    toast.success("Moved to tomorrow");
  }

  async function createPlan() {
    const startsAt = new Date(planStart);
    const endsAt = new Date(planEnd);
    if (!planTitle.trim() || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      toast.error("Enter a valid scheduled work block.");
      return;
    }
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
  }

  async function handleManualSaved() {
    await completeSetupStep("log");
    await refresh();
  }

  const focusedElapsed = focusedTimer ? Math.max(0, Math.floor((now - new Date(focusedTimer.startedAt).getTime()) / 1000)) : 0;

  return (
    <div className="min-h-screen bg-[#f6f3ee] p-4 text-slate-950 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 rounded-[32px] border border-slate-200 bg-white px-6 py-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-700">Today’s command center</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Run today’s work from one place.</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">Dashboard is for today: start timers, see what is scheduled next, and log completed work that happened without a timer.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setSelectedBlock(null); setManualOpen(true); }} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-cyan-300 hover:text-cyan-700">Log completed work</button>
            <button onClick={() => setPlanningOpen((value) => !value)} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"><Plus className="mr-2 inline h-4 w-4" />Schedule work</button>
          </div>
        </header>

        {!setupComplete && (
          <section className="rounded-[32px] border border-cyan-100 bg-white p-5 shadow-sm">
            {onboarding.skippedAt ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-700">Setup hidden</p>
                  <h2 className="mt-1 text-2xl font-semibold">Resume setup when you want a guided path.</h2>
                  <p className="mt-2 text-sm text-slate-500">The app still works. Setup progress stays tied to this user and workspace.</p>
                </div>
                <button onClick={() => updateOnboarding({ skipped: false, completed: false })} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800">Resume setup</button>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-700">First login setup</p>
                    <h2 className="mt-1 text-2xl font-semibold">Get from blank workspace to billable proof.</h2>
                    <p className="mt-2 max-w-2xl text-sm text-slate-500">This is the durable path: workspace settings, project, scheduled work, time record, review, then export or invoice. Skip it now and resume later.</p>
                  </div>
                  <div className="min-w-[220px] rounded-3xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between text-sm font-bold text-slate-700">
                      <span>{setupDoneCount} of {setupSteps.length} complete</span>
                      <span>{Math.round((setupDoneCount / setupSteps.length) * 100)}%</span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                      <div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${(setupDoneCount / setupSteps.length) * 100}%` }} />
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => updateOnboarding({ skipped: true })} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-cyan-200 hover:text-cyan-700">Skip for now</button>
                      {setupDoneCount === setupSteps.length && (
                        <button onClick={() => updateOnboarding({ completed: true })} className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-slate-800">Finish setup</button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {setupSteps.map((step) => {
                    const content = (
                      <>
                        <div className={`mt-0.5 rounded-full p-1 ${step.done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                          <CheckCircle2 className="h-4 w-4" />
                        </div>
                        <span className="min-w-0 flex-1">
                          <span className="block font-bold">{step.label}</span>
                          <span className="mt-1 block text-xs font-medium leading-5 text-slate-500">{step.description}</span>
                          {!step.done && <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-cyan-700">{step.cta}<ArrowRight className="h-3 w-3" /></span>}
                        </span>
                      </>
                    );
                    const className = `flex items-start gap-3 rounded-3xl border p-4 text-left text-sm transition ${step.done ? "border-emerald-100 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-slate-50 text-slate-800 hover:border-cyan-200 hover:bg-cyan-50"}`;
                    if (step.href) {
                      return <Link key={step.id} href={step.href} onClick={() => completeSetupStep(step.id)} className={className}>{content}</Link>;
                    }
                    return <button key={step.id} onClick={step.action} className={className}>{content}</button>;
                  })}
                </div>
                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
                  <Link href="/people" onClick={() => completeSetupStep("invite")} className="rounded-full border border-slate-200 px-3 py-1.5 font-bold hover:border-cyan-200 hover:text-cyan-700">Optional: invite teammate</Link>
                  <Link href="/settings/developers" onClick={() => completeSetupStep("integrate")} className="rounded-full border border-slate-200 px-3 py-1.5 font-bold hover:border-cyan-200 hover:text-cyan-700">Optional: create API key</Link>
                  <Link href="/support" className="rounded-full border border-slate-200 px-3 py-1.5 font-bold hover:border-cyan-200 hover:text-cyan-700">Read support guide</Link>
                </div>
              </div>
            )}
          </section>
        )}

        <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-500">Focused timer</p>
                <h2 className="mt-1 text-xl font-semibold">{focusedTimer ? focusedTimer.taskId : "Ready when you are"}</h2>
              </div>
              {activeTimers.length > 0 && <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700">{activeTimers.length} running</span>}
            </div>

            <div className="mt-8 rounded-[28px] bg-slate-950 p-6 text-white shadow-inner">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm text-slate-400">Elapsed</p>
                  <div className="mt-2 font-mono text-6xl font-semibold tracking-tight sm:text-7xl">{fmt(focusedElapsed)}</div>
                  <p className="mt-3 text-sm text-slate-400">{focusedTimer?.projectName || (projectId ? projectNameById.get(projectId) : "Pick a project or start unassigned")}</p>
                </div>
                {focusedTimer ? (
                  <div className="flex flex-col gap-2 sm:min-w-48">
                    <button onClick={() => stopTimer(focusedTimer.id)} className="inline-flex items-center justify-center rounded-2xl bg-rose-500 px-5 py-4 text-sm font-bold text-white transition hover:bg-rose-400"><Square className="mr-2 h-4 w-4 fill-white" />Stop focused timer</button>
                    <button onClick={() => startTimer()} className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-bold text-white transition hover:bg-white/15"><Play className="mr-2 h-4 w-4 fill-white" />Start another timer</button>
                  </div>
                ) : (
                  <button onClick={() => startTimer()} className="inline-flex items-center justify-center rounded-2xl bg-cyan-400 px-5 py-4 text-sm font-bold text-slate-950 transition hover:bg-cyan-300"><Play className="mr-2 h-4 w-4 fill-slate-950" />Start timer</button>
                )}
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-[1.2fr_1fr_1fr]">
              <input value={taskId} onChange={(e) => setTaskId(e.target.value)} placeholder="What are you working on?" className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" />
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-cyan-500 focus:bg-white">
                <option value="">No project</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
              <select value={actionId} onChange={(e) => setActionId(e.target.value)} className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-cyan-500 focus:bg-white">
                <option value="">No work type rate</option>
                {actions.map((action) => <option key={action.id} value={action.id}>{action.name}{action.hourlyRate ? ` ($${action.hourlyRate}/hr)` : ""}</option>)}
              </select>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-cyan-500 focus:bg-white md:col-span-2" />
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags: design, research" className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" />
            </div>

            {planningOpen && (
              <div className="mt-5 rounded-[24px] border border-cyan-100 bg-cyan-50/60 p-4">
                <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_1fr_auto] md:items-end">
                  <label className="text-sm font-semibold text-slate-700">Title<input value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-cyan-100 bg-white px-3 text-sm outline-none" /></label>
                  <label className="text-sm font-semibold text-slate-700">Start<input type="datetime-local" value={planStart} onChange={(e) => setPlanStart(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-cyan-100 bg-white px-3 text-sm outline-none" /></label>
                  <label className="text-sm font-semibold text-slate-700">End<input type="datetime-local" value={planEnd} onChange={(e) => setPlanEnd(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-cyan-100 bg-white px-3 text-sm outline-none" /></label>
                  <button onClick={createPlan} className="h-11 rounded-xl bg-cyan-600 px-4 text-sm font-bold text-white transition hover:bg-cyan-500">Save scheduled work</button>
                </div>
              </div>
            )}

            {activeTimers.length > 1 && (
              <div className="mt-5 rounded-[24px] border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-700">Concurrent stack</p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-950">More timers are already running</h3>
                    <p className="mt-1 text-sm text-slate-600">The focused timer above is only one of {activeTimers.length}. The others are listed here so they are visible without scrolling.</p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-amber-700">{activeTimers.length} live</span>
                </div>
                <div className="mt-4 space-y-2">
                  {activeTimers.slice(1).map((timer) => {
                    const elapsed = Math.max(0, Math.floor((now - new Date(timer.startedAt).getTime()) / 1000));
                    return (
                      <div key={timer.id} className="flex items-center justify-between gap-3 rounded-2xl border border-amber-100 bg-white px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-950">{timer.taskId}</p>
                          <p className="mt-1 text-xs text-slate-500">{timer.projectName || "No project"}{timer.action ? ` · ${timer.action}` : ""}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-sm font-semibold text-slate-950">{fmt(elapsed)}</span>
                          <button onClick={() => stopTimer(timer.id)} className="rounded-xl bg-rose-500 px-3 py-2 text-xs font-bold text-white transition hover:bg-rose-400">Stop</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-500">Up next</p>
                <h2 className="mt-1 text-xl font-semibold">Today and upcoming</h2>
              </div>
              <CalendarClock className="h-5 w-5 text-cyan-700" />
            </div>
            <div className="mt-5 space-y-3">
              {blocks.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                  <ListChecks className="mx-auto h-8 w-8 text-slate-400" />
                  <p className="mt-3 text-sm font-semibold text-slate-700">No scheduled work queued.</p>
                  <p className="mt-1 text-sm text-slate-500">Schedule the next block from here or use Calendar for a fuller week view.</p>
                </div>
              ) : blocks.map((block) => (
                <article key={block.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-950">{block.title}</p>
                      <p className="mt-1 text-sm text-slate-500">{timeRange(block)}{block.projectId ? ` · ${projectNameById.get(block.projectId) ?? "Project"}` : ""}</p>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-500">scheduled</span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <button onClick={() => startTimer(block)} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white">Start timer</button>
                    <button onClick={() => { setSelectedBlock(block); setManualOpen(true); }} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">Log completed</button>
                    <button onClick={() => rescheduleTomorrow(block)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">Tomorrow</button>
                    <button onClick={() => updateBlock(block, { status: "skipped" })} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">Skip</button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-500">Concurrent stack</p>
              <h2 className="mt-1 text-xl font-semibold">All running timers</h2>
            </div>
            <TimerReset className="h-5 w-5 text-slate-400" />
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {activeTimers.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center lg:col-span-2">
                <Clock className="mx-auto h-8 w-8 text-slate-400" />
                <p className="mt-3 text-sm font-semibold text-slate-700">No live timers.</p>
                <p className="mt-1 text-sm text-slate-500">Start a timer from the focus panel or from scheduled work in the Up next list.</p>
              </div>
            ) : activeTimers.map((timer, index) => {
              const elapsed = Math.max(0, Math.floor((now - new Date(timer.startedAt).getTime()) / 1000));
              return (
                <article key={timer.id} className={`flex items-center justify-between gap-4 rounded-3xl border p-4 ${index === 0 ? "border-cyan-200 bg-cyan-50" : "border-slate-200 bg-slate-50"}`}>
                  <div>
                    <div className="font-mono text-2xl font-semibold text-slate-950">{fmt(elapsed)}</div>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{timer.taskId}</p>
                    <p className="text-xs text-slate-500">{timer.projectName || "No project"}{timer.action ? ` · ${timer.action}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {index !== 0 && <FastForward className="h-4 w-4 text-slate-400" />}
                    <button onClick={() => stopTimer(timer.id)} className="rounded-2xl bg-rose-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-rose-400"><Square className="mr-2 inline h-3 w-3 fill-white" />Stop</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      <ManualTimeDialog open={manualOpen} onOpenChange={setManualOpen} scheduledBlock={selectedBlock} onSaved={handleManualSaved} defaultTaskId={taskId} defaultProjectId={projectId} defaultDescription={notes} />
    </div>
  );
}
