"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/client/local-db";
import { isAdminEmail } from "@/lib/admin";
import { ProfileMenu } from "@/components/profile-menu";

type CurrencyPayload = { payload?: { rates?: Record<string, number> } };
type SessionState = { email: string; role: string; workspaceId: string } | null;
type Project = { id: string; name: string };
type Goal = { id: string; name: string };
type Action = { id: string; name: string; hourlyRate?: number };

/** Format seconds as HH:MM:SS */
function fmt(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** SVG ring showing pomodoro progress (0–1) */
function PomodoroRing({ progress, isRunning }: { progress: number; isRunning: boolean }) {
  const r = 88;
  const circ = 2 * Math.PI * r;
  const dash = circ * (1 - progress);
  return (
    <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full -rotate-90">
      {/* Track */}
      <circle cx="100" cy="100" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
      {/* Progress */}
      <circle
        cx="100" cy="100" r={r} fill="none"
        stroke={isRunning ? "url(#ringGrad)" : "rgba(100,116,139,0.4)"}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={dash}
        style={{ transition: "stroke-dashoffset 0.5s ease" }}
      />
      <defs>
        <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#06b6d4" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function TimerDashboard() {
  const [taskId, setTaskId] = useState("TASK-1");
  const [workspaceSlug] = useState("default-workspace");
  const [entryId, setEntryId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pomodoroMinutes] = useState(25);
  const [status, setStatus] = useState<string | null>(null);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [session, setSession] = useState<SessionState>(null);
  const [projectId, setProjectId] = useState("");
  const [goalId, setGoalId] = useState("");
  const [actionId, setActionId] = useState("");
  const [tags, setTags] = useState("focus");
  const [projects, setProjects] = useState<Project[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [workspaceTags, setWorkspaceTags] = useState<string[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newGoalName, setNewGoalName] = useState("");

  const isRunning = Boolean(entryId && startedAt);
  const pomodoroTotal = pomodoroMinutes * 60;
  const pomodoroRemaining = useMemo(() => Math.max(0, pomodoroTotal - elapsed), [elapsed, pomodoroTotal]);
  const pomodoroProgress = Math.min(1, elapsed / pomodoroTotal);
  const pomodoroDone = elapsed >= pomodoroTotal;

  async function refreshSession() {
    const response = await fetch("/api/auth/me");
    const data = await response.json();
    if (response.ok) {
      setSession(data.session);
    } else {
      setSession(null);
    }
  }

  async function loadProjectsAndGoals() {
    const [pr, gr, tr, ar] = await Promise.all([fetch("/api/projects"), fetch("/api/goals"), fetch("/api/tags"), fetch("/api/user/actions")]);
    const pd = await pr.json();
    const gd = await gr.json();
    const td = await tr.json();
    const ad = await ar.json();
    if (pr.ok) setProjects(pd.projects ?? []);
    if (gr.ok) setGoals(gd.goals ?? []);
    if (tr.ok) setWorkspaceTags(td.tags ?? []);
    if (ar.ok) setActions(ad.actions ?? []);
  }

  // Tick
  useEffect(() => {
    const interval = setInterval(() => {
      if (startedAt) setElapsed(Math.floor((Date.now() - startedAt.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  // Idle detection
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && isRunning) setStatus("Idle detected — review whether to discard or reassign this time block.");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [isRunning]);

  // Load on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshSession();
    loadProjectsAndGoals();
  }, []); // intentionally empty — only runs once on mount

  // Auto-dismiss status after 6s
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 6000);
    return () => clearTimeout(t);
  }, [status]);


  async function createProject() {
    if (!newProjectName.trim()) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newProjectName.trim(), billingModel: "hourly" }),
    });
    const data = await res.json();
    setStatus(res.ok ? `Project "${data.project.name}" created` : `Error: ${data.error}`);
    if (res.ok) { setNewProjectName(""); await loadProjectsAndGoals(); }
  }

  async function deleteProject() {
    if (!projectId) return;
    const res = await fetch(`/api/projects?projectId=${encodeURIComponent(projectId)}`, { method: "DELETE" });
    const data = await res.json();
    setStatus(res.ok ? "Project removed" : `Error: ${data.error}`);
    if (res.ok) { setProjectId(""); await loadProjectsAndGoals(); }
  }

  async function createGoal() {
    if (!newGoalName.trim()) return;
    const res = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newGoalName.trim(), projectId: projectId || undefined }),
    });
    const data = await res.json();
    setStatus(res.ok ? `Goal "${data.goal.name}" created` : `Error: ${data.error}`);
    if (res.ok) { setNewGoalName(""); await loadProjectsAndGoals(); }
  }

  async function deleteGoal() {
    if (!goalId) return;
    const res = await fetch(`/api/goals?goalId=${encodeURIComponent(goalId)}`, { method: "DELETE" });
    const data = await res.json();
    setStatus(res.ok ? "Goal removed" : `Error: ${data.error}`);
    if (res.ok) { setGoalId(""); await loadProjectsAndGoals(); }
  }

  async function startTimer() {
    const started = new Date();
    const res = await fetch("/api/timer/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        description: "Focus block",
        projectId: projectId || undefined,
        goalId: goalId || undefined,
        actionId: actionId || undefined,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      }),
    });
    const data = await res.json();
    if (!res.ok) return setStatus(`Start failed: ${data.error}`);
    setEntryId(data.entry.id);
    setStartedAt(started);
    setElapsed(0);
    await db.draftTimers.put({
      id: data.entry.id,
      taskId,
      workspaceId: data.entry.workspaceId,
      startedAt: started.toISOString(),
      pomodoroMinutes,
      lastSeenAt: new Date().toISOString(),
    });
    setStatus("Timer running — session persisted locally.");
  }

  async function stopTimer() {
    if (!entryId) return;
    const res = await fetch("/api/timer/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId }),
    });
    const data = await res.json();
    if (!res.ok) return setStatus(`Stop failed: ${data.error}`);
    await db.draftTimers.delete(entryId);
    setEntryId(null);
    setStartedAt(null);
    setElapsed(0);
    setStatus(`Session logged — ${data.durationSeconds}s recorded.`);
  }

  async function loadRates() {
    const res = await fetch("/api/currency/rates?base=USD&symbols=EUR,GBP,CAD,JPY");
    const data = (await res.json()) as CurrencyPayload;
    setRates(data.payload?.rates ?? {});
    setStatus("FX rates updated.");
  }

  const selectedProject = projects.find((p) => p.id === projectId);
  const selectedGoal = goals.find((g) => g.id === goalId);
  const selectedAction = actions.find((a) => a.id === actionId);
  const activeTags = tags.split(",").map((t) => t.trim()).filter(Boolean);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* ─── Top Nav ─── */}
      <nav className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/5 px-5 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-violet-600 shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-white">
              <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 6a.75.75 0 0 0-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 0 0 0-1.5h-3.75V6Z" clipRule="evenodd" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-white">Timed</span>
          {session && (
            <span className="hidden rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-slate-400 sm:inline">
              {workspaceSlug}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {isRunning && (
            <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Tracking
            </span>
          )}
          {session && (
            <ProfileMenu email={session.email} isAdmin={isAdminEmail(session.email)} />
          )}
        </div>
      </nav>

      {/* ─── Timer Hero ─── */}
      <div className="relative overflow-hidden rounded-2xl border border-white/8 bg-white/5 backdrop-blur-xl">
        {/* Glow when running */}
        {isRunning && (
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-cyan-500/5 to-transparent" />
        )}
        {pomodoroDone && isRunning && (
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-violet-500/10 to-transparent" />
        )}

        <div className="flex flex-col items-center gap-6 px-6 py-10 sm:py-14">
          {/* Ring + time */}
          <div className="relative flex h-52 w-52 items-center justify-center sm:h-60 sm:w-60">
            <PomodoroRing progress={pomodoroProgress} isRunning={isRunning} />
            <div className="z-10 flex flex-col items-center">
              <span className={`font-mono text-5xl font-bold tabular-nums tracking-tight sm:text-6xl ${isRunning ? "text-white" : "text-slate-400"}`}>
                {fmt(elapsed)}
              </span>
              <span className="mt-1 text-xs font-medium text-slate-500">
                {isRunning
                  ? (pomodoroDone ? "🍅 Pomodoro complete!" : `${fmt(pomodoroRemaining)} remaining`)
                  : "Stopped"}
              </span>
            </div>
          </div>

          {/* Context summary */}
          <div className="flex flex-wrap justify-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
              {taskId}
            </span>
            {selectedProject && (
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-300">
                {selectedProject.name}
              </span>
            )}
            {selectedGoal && (
              <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-300">
                {selectedGoal.name}
              </span>
            )}
            {selectedAction && (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                {selectedAction.name} {selectedAction.hourlyRate !== undefined && `($${selectedAction.hourlyRate}/hr)`}
              </span>
            )}
            {activeTags.map((tag) => (
              <span key={tag} className="rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1 text-xs text-slate-400">
                #{tag}
              </span>
            ))}
          </div>

          {/* Start / Stop */}
          <div className="flex gap-3">
            {!isRunning ? (
              <button
                onClick={startTimer}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-600 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 transition hover:from-cyan-400 hover:to-cyan-500 active:scale-95"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.84Z" />
                </svg>
                Start Session
              </button>
            ) : (
              <button
                onClick={stopTimer}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-rose-500/25 transition hover:from-rose-400 hover:to-rose-500 active:scale-95"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M5.75 3a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75V3.75A.75.75 0 0 0 7.25 3h-1.5ZM12.75 3a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75V3.75a.75.75 0 0 0-.75-.75h-1.5Z" />
                </svg>
                Stop
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── Session Context ─── */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Task + Tags */}
        <div className="rounded-2xl border border-white/8 bg-white/5 p-5 backdrop-blur-xl">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-500">Session Context</h2>
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Task ID</label>
              <input
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                className="w-full rounded-lg border border-white/8 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                placeholder="TASK-1"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Tags</label>
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="w-full rounded-lg border border-white/8 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                placeholder="focus, deep-work"
              />
              {workspaceTags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {workspaceTags.map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        const cur = tags.split(",").map((x) => x.trim()).filter(Boolean);
                        const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
                        setTags(next.join(", "));
                      }}
                      className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                        activeTags.includes(t)
                          ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-300"
                          : "border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-slate-300"
                      }`}
                    >
                      #{t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Project + Goal */}
        <div className="rounded-2xl border border-white/8 bg-white/5 p-5 backdrop-blur-xl">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-500">Project & Goal</h2>
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Project</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-lg border border-white/8 bg-slate-900 px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              >
                <option value="">— No project —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Goal</label>
              <select
                value={goalId}
                onChange={(e) => setGoalId(e.target.value)}
                className="w-full rounded-lg border border-white/8 bg-slate-900 px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              >
                <option value="">— No goal —</option>
                {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Action</label>
              <select
                value={actionId}
                onChange={(e) => setActionId(e.target.value)}
                className="w-full rounded-lg border border-white/8 bg-slate-900 px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              >
                <option value="">— No action —</option>
                {actions.map((a) => <option key={a.id} value={a.id}>{a.name} {a.hourlyRate !== undefined ? `($${a.hourlyRate}/hr)` : ""}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Manage (collapsible) ─── */}
      <div className="rounded-2xl border border-white/8 bg-white/5 backdrop-blur-xl">
        <button
          onClick={() => setShowConfig((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Manage Projects, Goals & FX</span>
          <svg
            xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
            className={`h-4 w-4 text-slate-500 transition-transform ${showConfig ? "rotate-180" : ""}`}
          >
            <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
          </svg>
        </button>

        {showConfig && (
          <div className="border-t border-white/8 px-5 pb-5 pt-4">
            <div className="grid gap-6 sm:grid-cols-3">
              {/* New Project */}
              <div>
                <p className="mb-2 text-xs font-medium text-slate-400">New Project</p>
                <div className="flex gap-2">
                  <input
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && createProject()}
                    placeholder="Project name"
                    className="min-w-0 flex-1 rounded-lg border border-white/8 bg-white/5 px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-cyan-500/50 focus:outline-none"
                  />
                  <button
                    onClick={createProject}
                    className="rounded-lg bg-cyan-600/80 px-3 py-2 text-xs font-medium text-white hover:bg-cyan-600"
                  >
                    Add
                  </button>
                </div>
                {projectId && (
                  <button
                    onClick={deleteProject}
                    className="mt-2 text-xs text-rose-400/70 hover:text-rose-400"
                  >
                    Delete selected project
                  </button>
                )}
              </div>

              {/* New Goal */}
              <div>
                <p className="mb-2 text-xs font-medium text-slate-400">New Goal</p>
                <div className="flex gap-2">
                  <input
                    value={newGoalName}
                    onChange={(e) => setNewGoalName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && createGoal()}
                    placeholder="Goal name"
                    className="min-w-0 flex-1 rounded-lg border border-white/8 bg-white/5 px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-cyan-500/50 focus:outline-none"
                  />
                  <button
                    onClick={createGoal}
                    className="rounded-lg bg-violet-600/80 px-3 py-2 text-xs font-medium text-white hover:bg-violet-600"
                  >
                    Add
                  </button>
                </div>
                {goalId && (
                  <button
                    onClick={deleteGoal}
                    className="mt-2 text-xs text-rose-400/70 hover:text-rose-400"
                  >
                    Delete selected goal
                  </button>
                )}
              </div>

              {/* FX Rates */}
              <div>
                <p className="mb-2 text-xs font-medium text-slate-400">Exchange Rates (USD base)</p>
                {Object.keys(rates).length === 0 ? (
                  <button
                    onClick={loadRates}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400 hover:bg-white/10 hover:text-white"
                  >
                    Load FX rates
                  </button>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(rates).map(([currency, rate]) => (
                      <span key={currency} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300">
                        {currency} <span className="text-slate-500">{Number(rate).toFixed(4)}</span>
                      </span>
                    ))}
                    <button onClick={loadRates} className="text-xs text-slate-600 hover:text-slate-400">↻</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Status Toast ─── */}
      {status && (
        <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-slate-900/80 px-4 py-3 text-sm text-slate-300 shadow-lg backdrop-blur-xl">
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-cyan-400" />
          {status}
          <button onClick={() => setStatus(null)} className="ml-auto text-slate-600 hover:text-slate-400">✕</button>
        </div>
      )}
    </div>
  );
}
