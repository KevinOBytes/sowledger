"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/client/local-db";
import { isAdminEmail } from "@/lib/admin";
import { ProfileMenu } from "@/components/profile-menu";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Play, Square, Plus, ChevronDown, Check, Activity, Clock, Settings2, Folder, Target, Briefcase } from "lucide-react";

type CurrencyPayload = { payload?: { rates?: Record<string, number> } };
type SessionState = { email: string; role: string; workspaceId: string; sub?: string } | null;
type Project = { id: string; name: string };
type Goal = { id: string; name: string };
type Action = { id: string; name: string; hourlyRate?: number };

type ActiveTimer = {
  id: string;
  taskId: string;
  projectId?: string;
  goalId?: string;
  actionId?: string;
  tags?: string[];
  startedAt: string;
};

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
  const r = 90;
  const circ = 2 * Math.PI * r;
  const dash = circ * (1 - progress);
  return (
    <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full -rotate-90">
      <circle cx="100" cy="100" r={r} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="4" />
      <motion.circle
        cx="100" cy="100" r={r} fill="none"
        stroke={isRunning ? "url(#ringGrad)" : "rgba(100,116,139,0.3)"}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={circ}
        animate={{ strokeDashoffset: dash }}
        transition={{ duration: 0.5, ease: "linear" }}
      />
      <defs>
        <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#06b6d4" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function TimerDashboard() {
  const [workspaceSlug] = useState("default-workspace");
  const [session, setSession] = useState<SessionState>(null);
  
  // Timer State
  const [activeTimers, setActiveTimers] = useState<ActiveTimer[]>([]);
  const [now, setNow] = useState(Date.now());
  const [pomodoroMinutes, setPomodoroMinutes] = useState(0);
  const [rates, setRates] = useState<Record<string, number>>({});
  
  // Builder Context states
  const [taskId, setTaskId] = useState("TASK-1");
  const [projectId, setProjectId] = useState("");
  const [goalId, setGoalId] = useState("");
  const [actionId, setActionId] = useState("");
  const [tags, setTags] = useState("focus");
  
  // Data lists
  const [projects, setProjects] = useState<Project[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [workspaceTags, setWorkspaceTags] = useState<string[]>([]);
  
  // UI states
  const [showConfig, setShowConfig] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newGoalName, setNewGoalName] = useState("");
  const projectNameById = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project.name])), [projects]);
  const goalNameById = useMemo(() => Object.fromEntries(goals.map((goal) => [goal.id, goal.name])), [goals]);

  const pomodoroTotal = pomodoroMinutes * 60;
  
  // Tick
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  async function refreshSession() {
    try {
      const response = await fetch("/api/auth/me");
      const data = await response.json();
      if (response.ok) setSession(data.session);
      else setSession(null);
    } catch {
      setSession(null);
    }
  }

  async function fetchActiveTimers() {
    try {
      const res = await fetch("/api/timer/active");
      if (res.ok) {
        const data = await res.json() as { activeEntries: ActiveTimer[] };
        const timers = (data.activeEntries || []).map((entry) => ({
          ...entry,
          tags: Array.isArray(entry.tags) ? entry.tags : []
        }));
        
        // Sort descending by start time to show most recent first
        timers.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
        setActiveTimers(timers);
      }
    } catch {
      console.error("Failed to fetch active timers");
      // Fallback: sync from IndexedDB
      const localTimers = await db.draftTimers.getAll();
      setActiveTimers(localTimers.map((t) => ({
        id: t.id,
        taskId: t.taskId,
        startedAt: t.startedAt
      })));
    }
  }

  async function loadProjectsAndGoals() {
    try {
      const [pr, gr, tr, ar] = await Promise.all([
        fetch("/api/projects").catch(() => null), 
        fetch("/api/goals").catch(() => null), 
        fetch("/api/tags").catch(() => null), 
        fetch("/api/user/actions").catch(() => null)
      ]);
      if (pr?.ok) setProjects((await pr.json()).projects ?? []);
      if (gr?.ok) setGoals((await gr.json()).goals ?? []);
      if (tr?.ok) setWorkspaceTags((await tr.json()).tags ?? []);
      if (ar?.ok) setActions((await ar.json()).actions ?? []);
    } catch (err) {
      console.error("Failed to load context data:", err);
    }
  }

  // Load on mount
  useEffect(() => {
    refreshSession();
    loadProjectsAndGoals();
    fetchActiveTimers();
  }, []);

  async function createProject() {
    if (!newProjectName.trim()) return;
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProjectName.trim(), billingModel: "hourly" }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Project created", { description: data.project.name });
        setNewProjectName("");
        await loadProjectsAndGoals();
      } else throw new Error(data.error);
    } catch (err) {
      toast.error("Failed to create project", { description: (err as Error).message });
    }
  }

  async function deleteProject() {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects?projectId=${encodeURIComponent(projectId)}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Project removed");
        setProjectId("");
        await loadProjectsAndGoals();
      } else {
        const data = await res.json();
        throw new Error(data.error);
      }
    } catch (err) {
      toast.error("Failed to remove project", { description: (err as Error).message });
    }
  }

  async function createGoal() {
    if (!newGoalName.trim()) return;
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newGoalName.trim(), projectId: projectId || undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Goal created", { description: data.goal.name });
        setNewGoalName("");
        await loadProjectsAndGoals();
      } else throw new Error(data.error);
    } catch (err) {
      toast.error("Failed to create goal", { description: (err as Error).message });
    }
  }

  async function deleteGoal() {
    if (!goalId) return;
    try {
      const res = await fetch(`/api/goals?goalId=${encodeURIComponent(goalId)}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Goal removed");
        setGoalId("");
        await loadProjectsAndGoals();
      } else {
        const data = await res.json();
        throw new Error(data.error);
      }
    } catch (err) {
      toast.error("Failed to remove goal", { description: (err as Error).message });
    }
  }

  async function startTimer() {
    try {
      const tArray = tags.split(",").map((t) => t.trim()).filter(Boolean);
      const res = await fetch("/api/timer/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          description: "Focus block",
          projectId: projectId || undefined,
          goalId: goalId || undefined,
          actionId: actionId || undefined,
          tags: tArray,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start timer");
      
      const newTimer: ActiveTimer = {
        id: data.entry.id,
        taskId,
        projectId: projectId || undefined,
        goalId: goalId || undefined,
        actionId: actionId || undefined,
        tags: tArray,
        startedAt: data.entry.startedAt
      };
      
      setActiveTimers(prev => [newTimer, ...prev]);
      
      await db.draftTimers.put({
        id: data.entry.id,
        taskId,
        workspaceId: data.entry.workspaceId,
        startedAt: newTimer.startedAt,
        pomodoroMinutes,
        lastSeenAt: new Date().toISOString(),
      });
      
      toast.success("Timer Started", { 
        description: `Running ${taskId} concurrently.`,
        icon: <Play className="h-4 w-4 text-cyan-400" />
      });
    } catch (err) {
      toast.error("Could not start session", { description: (err as Error).message });
    }
  }

  async function stopTimer(entryId: string, silent = false) {
    try {
      const res = await fetch("/api/timer/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId }),
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || "Failed to stop timer");
      
      await db.draftTimers.delete(entryId);
      setActiveTimers(prev => prev.filter(t => t.id !== entryId));
      
      if (!silent) {
        toast.success("Session Logged", { 
          description: `${data.durationSeconds}s recorded successfully.`,
          icon: <Check className="h-4 w-4 text-emerald-400" />
        });
      }
    } catch (err) {
      toast.error("Could not stop session", { description: (err as Error).message });
    }
  }

  async function loadRates() {
    try {
      const res = await fetch("/api/currency/rates?base=USD&symbols=EUR,GBP,CAD,JPY");
      const data = (await res.json()) as CurrencyPayload;
      setRates(data.payload?.rates ?? {});
      toast.success("FX Rates Updated");
    } catch {
      toast.error("Failed to fetch FX rates");
    }
  }

  const activeTags = tags.split(",").map((t) => t.trim()).filter(Boolean);
  const heroTimer = activeTimers[0] || null;
  const secondaryTimers = activeTimers.slice(1);

  // Compute hero states
  const heroElapsed = heroTimer ? Math.max(0, Math.floor((now - new Date(heroTimer.startedAt).getTime()) / 1000)) : 0;
  const isPomodoro = pomodoroTotal > 0;
  const heroPomodoroRemaining = isPomodoro ? Math.max(0, pomodoroTotal - heroElapsed) : 0;
  const heroPomodoroProgress = isPomodoro ? Math.min(1, heroElapsed / pomodoroTotal) : (heroElapsed % 3600) / 3600; // Loops every hour for unlimited
  const heroPomodoroDone = isPomodoro ? heroElapsed >= pomodoroTotal : false;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* ─── Top Nav ─── */}
      <nav className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/[0.02] px-5 py-3 backdrop-blur-3xl shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-violet-600 shadow-lg shadow-cyan-500/20">
            <Activity className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-semibold tracking-wide text-white">Billabled</span>
          {session && (
            <span className="hidden rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-400 sm:inline">
              {workspaceSlug}
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          <AnimatePresence>
            {activeTimers.length > 0 && (
              <motion.span 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400 shadow-inner"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping shadow-lg shadow-emerald-400 absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                {activeTimers.length} Live
              </motion.span>
            )}
          </AnimatePresence>
          {session && <ProfileMenu email={session.email} isAdmin={isAdminEmail(session.email)} />}
        </div>
      </nav>

      {/* ─── Multiple Timer Stack ─── */}
      <AnimatePresence>
        {secondaryTimers.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-col gap-2"
          >
            {secondaryTimers.map((timer) => {
              const elap = Math.max(0, Math.floor((now - new Date(timer.startedAt).getTime()) / 1000));
              const projectName = timer.projectId ? projectNameById[timer.projectId] : undefined;
              return (
                <motion.div 
                  key={timer.id}
                  layout
                  className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 px-5 py-3 backdrop-blur-md transition-all hover:bg-white/10"
                >
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-xl font-medium tracking-tight text-white">{fmt(elap)}</span>
                    <div className="hidden sm:flex flex-col">
                      <span className="text-sm font-semibold text-slate-200">{timer.taskId}</span>
                      {projectName && <span className="text-[10px] uppercase tracking-wider text-cyan-400/80">{projectName}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => stopTimer(timer.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white transition-colors"
                  >
                    <Square className="h-4 w-4" />
                  </button>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Hero Active Timer OR Empty Placeholder ─── */}
      <motion.div 
        layout
        className="relative overflow-hidden rounded-3xl border border-white/5 bg-white/[0.02] backdrop-blur-3xl shadow-2xl"
      >
        <AnimatePresence>
          {heroTimer && (
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-0 bg-gradient-to-b from-cyan-500/10 via-transparent to-transparent opacity-50 mix-blend-screen" 
            />
          )}
          {heroTimer && heroPomodoroDone && (
             <motion.div 
             initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
             className="pointer-events-none absolute inset-0 bg-gradient-to-b from-violet-500/10 via-transparent to-transparent opacity-50 mix-blend-screen" 
           />
          )}
        </AnimatePresence>

        <div className="flex flex-col items-center gap-8 px-6 py-12 sm:py-16">
          <div className="relative flex h-56 w-56 items-center justify-center sm:h-72 sm:w-72">
            <PomodoroRing progress={heroTimer ? heroPomodoroProgress : 0} isRunning={!!heroTimer} />
            <motion.div layout className="z-10 flex flex-col items-center">
              <span className={`font-mono text-6xl font-light tabular-nums tracking-tighter sm:text-7xl transition-colors duration-500 ${heroTimer ? "text-white" : "text-slate-500"}`}>
                {fmt(heroElapsed)}
              </span>
              <AnimatePresence mode="popLayout">
                {heroTimer ? (
                  <motion.span 
                    initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}
                    className={`mt-2 text-xs font-medium ${heroPomodoroDone && isPomodoro ? "text-violet-400" : "text-cyan-400"}`}
                  >
                    {!isPomodoro 
                      ? "⏱️ Tracking active" 
                      : heroPomodoroDone 
                        ? "🍅 Pomodoro complete!" 
                        : `${fmt(heroPomodoroRemaining)} remaining`}
                  </motion.span>
                ) : (
                  <motion.span 
                    initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}
                    className="mt-2 text-xs font-medium text-slate-500 uppercase tracking-widest"
                  >
                    Ready Setup
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>
          </div>

          <div className="flex max-w-lg flex-wrap justify-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/5 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-slate-300">
              <Briefcase className="h-3 w-3" /> {heroTimer ? heroTimer.taskId : taskId}
            </span>
            {(() => {
              const pId = heroTimer ? heroTimer.projectId : projectId;
              const projectName = pId ? projectNameById[pId] : undefined;
              return projectName ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-cyan-300">
                  <Folder className="h-3 w-3" /> {projectName}
                </span>
              ) : null;
            })()}
            {(() => {
              const gId = heroTimer ? heroTimer.goalId : goalId;
              const goalName = gId ? goalNameById[gId] : undefined;
              return goalName ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-violet-300">
                  <Target className="h-3 w-3" /> {goalName}
                </span>
              ) : null;
            })()}
          </div>

          <div className="mt-2 flex">
            {heroTimer ? (
              <motion.button
                whileHover={{ scale: 1.02, backgroundColor: "rgb(225, 29, 72)" }}
                whileTap={{ scale: 0.98 }}
                onClick={() => stopTimer(heroTimer.id)}
                className="group flex items-center gap-3 rounded-2xl bg-rose-500 px-10 py-4 text-sm font-semibold tracking-wide text-white shadow-xl shadow-rose-500/20 transition-all hover:shadow-rose-500/40 border border-rose-400/50"
              >
                <Square className="h-4 w-4 fill-white flex-shrink-0" />
                Stop Logging
              </motion.button>
            ) : (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={startTimer}
                className="group relative flex items-center gap-3 overflow-hidden rounded-2xl bg-white px-10 py-4 text-sm font-semibold tracking-wide text-slate-900 shadow-xl shadow-white/10 transition-all"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-cyan-400/20 to-violet-400/20 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                <Play className="relative h-4 w-4 fill-slate-900 group-hover:text-cyan-600 transition-colors" />
                <span className="relative">Start Session</span>
              </motion.button>
            )}
          </div>
        </div>
      </motion.div>

      {/* ─── Forms / Context ─── */}
      <motion.div layout className="grid gap-6 sm:grid-cols-2">
        <div className="group rounded-3xl border border-white/5 bg-white/[0.02] p-6 backdrop-blur-3xl shadow-2xl transition hover:bg-white/[0.03]">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-white/5 p-2"><Clock className="h-4 w-4 text-slate-400" /></div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Configure Next Timer</h2>
            </div>
          </div>
          
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="taskId" className="mb-2 block text-xs font-medium text-slate-400">Task Reference / ID</label>
                <input
                  id="taskId"
                  value={taskId}
                  onChange={(e) => setTaskId(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder-slate-600 transition focus:border-cyan-500/50 focus:bg-black/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                  placeholder="Ex: TKO-101"
                />
              </div>
              <div>
                <label htmlFor="pomodoroMinutes" className="mb-2 block text-xs font-medium text-slate-400">Target Time (Minutes) - 0 for continuous</label>
                <input
                  id="pomodoroMinutes"
                  type="number"
                  min="0"
                  max="480"
                  value={pomodoroMinutes}
                  onChange={(e) => setPomodoroMinutes(parseInt(e.target.value) || 0)}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder-slate-600 transition focus:border-cyan-500/50 focus:bg-black/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                />
              </div>
            </div>
            <div>
              <label htmlFor="tags" className="mb-2 block text-xs font-medium text-slate-400">Activity Tags</label>
              <input
                id="tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder-slate-600 transition focus:border-cyan-500/50 focus:bg-black/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                placeholder="focus, research, deep-work"
              />
              {workspaceTags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {workspaceTags.map((t) => {
                     const isActive = activeTags.includes(t);
                     return (
                      <button
                        key={t}
                        onClick={() => {
                          const cur = tags.split(",").map((x) => x.trim()).filter(Boolean);
                          const next = isActive ? cur.filter((x) => x !== t) : [...cur, t];
                          setTags(next.join(", "));
                        }}
                        className={`rounded-lg border px-3 py-1 text-[11px] font-medium tracking-wide transition-all ${
                          isActive
                            ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300 shadow-sm shadow-cyan-500/20"
                            : "border-white/5 bg-white/5 text-slate-400 hover:border-white/20 hover:text-white hover:bg-white/10"
                        }`}
                      >
                        #{t}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            {heroTimer && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={startTimer}
                className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-cyan-500/10 px-4 py-3 text-sm font-semibold tracking-wide text-cyan-400 shadow-xl shadow-cyan-500/5 transition-all hover:bg-cyan-500/20 border border-cyan-500/20"
              >
                <Plus className="relative h-4 w-4" />
                <span className="relative">Start Concurrent Timer</span>
              </motion.button>
            )}
          </div>
        </div>

        <div className="group rounded-3xl border border-white/5 bg-white/[0.02] p-6 backdrop-blur-3xl shadow-2xl transition hover:bg-white/[0.03]">
          <div className="mb-6 flex items-center gap-2">
            <div className="rounded-lg bg-white/5 p-2"><Target className="h-4 w-4 text-slate-400" /></div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Billable Assignments</h2>
          </div>
          
          <div className="space-y-4">
            <div className="relative">
              <label htmlFor="projectId" className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-slate-500">Project Workspace</label>
              <select
                id="projectId"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full appearance-none rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white transition focus:border-cyan-500/50 focus:bg-black/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              >
                <option value="" className="bg-slate-900 border-none">— Unassigned Project —</option>
                {projects.map((p) => <option className="bg-slate-900 border-none" key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <ChevronDown className="absolute bottom-3.5 right-4 h-4 w-4 text-slate-500 pointer-events-none" />
            </div>
            
            <div className="relative">
              <label htmlFor="goalId" className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-slate-500">Billing Goal</label>
              <select
                id="goalId"
                value={goalId}
                onChange={(e) => setGoalId(e.target.value)}
                className="w-full appearance-none rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white transition focus:border-cyan-500/50 focus:bg-black/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              >
                <option value="" className="bg-slate-900">— Unassigned Goal —</option>
                {goals.map((g) => <option className="bg-slate-900" key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <ChevronDown className="absolute bottom-3.5 right-4 h-4 w-4 text-slate-500 pointer-events-none" />
            </div>

            <div className="relative">
              <label htmlFor="actionId" className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-slate-500">Action Rate Card</label>
              <select
                id="actionId"
                value={actionId}
                onChange={(e) => setActionId(e.target.value)}
                className="w-full appearance-none rounded-xl border border-emerald-500/10 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-100 transition focus:border-emerald-500/50 focus:bg-emerald-500/10 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
              >
                <option value="" className="bg-slate-900">— Select Action Rate —</option>
                {actions.map((a) => <option className="bg-slate-900" key={a.id} value={a.id}>{a.name} {a.hourlyRate !== undefined ? `($${a.hourlyRate}/hr)` : ""}</option>)}
              </select>
              <ChevronDown className="absolute bottom-3.5 right-4 h-4 w-4 text-emerald-500/50 pointer-events-none" />
            </div>
          </div>
        </div>
      </motion.div>

      {/* ─── Manage Defaults (Collapsible) ─── */}
      <motion.div layout className="rounded-3xl border border-white/5 bg-white/[0.02] backdrop-blur-3xl shadow-2xl overflow-hidden">
        <button
          title="Preferences"
          onClick={() => setShowConfig((v) => !v)}
          className="group flex w-full items-center justify-between px-6 py-5 text-left transition hover:bg-white/[0.02]"
        >
          <div className="flex items-center gap-3">
            <Settings2 className="h-4 w-4 text-slate-500 group-hover:text-cyan-400 transition" />
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-400 group-hover:text-slate-200 transition">Workspace Preferences & Entities</span>
          </div>
          <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform duration-300 ${showConfig ? "rotate-180" : ""}`} />
        </button>

        <AnimatePresence>
          {showConfig && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-white/5"
            >
              <div className="grid gap-8 p-6 sm:grid-cols-3">
                {/* New Project */}
                <div>
                  <label htmlFor="newProjectName" className="mb-3 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Create New Project</label>
                  <div className="flex gap-2 relative">
                    <input
                      id="newProjectName"
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && createProject()}
                      placeholder="E.g., Website Redesign"
                      className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 pl-4 pr-10 py-2.5 text-sm text-white placeholder-slate-600 focus:border-cyan-500/50 focus:outline-none"
                    />
                    <button
                      title="Create Project"
                      onClick={createProject}
                      className="absolute right-1.5 top-1.5 bottom-1.5 w-8 flex items-center justify-center rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-900 transition"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  {projectId && (
                    <button onClick={deleteProject} className="mt-3 text-xs font-medium text-rose-500/60 hover:text-rose-400 transition">
                      Delete selected project
                    </button>
                  )}
                </div>

                {/* New Goal */}
                <div>
                  <label htmlFor="newGoalName" className="mb-3 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Create Goal</label>
                  <div className="flex gap-2 relative">
                    <input
                      id="newGoalName"
                      value={newGoalName}
                      onChange={(e) => setNewGoalName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && createGoal()}
                      placeholder="E.g., Q3 Launch"
                      className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 pl-4 pr-10 py-2.5 text-sm text-white placeholder-slate-600 focus:border-cyan-500/50 focus:outline-none"
                    />
                    <button
                      title="Create Goal"
                      onClick={createGoal}
                      className="absolute right-1.5 top-1.5 bottom-1.5 w-8 flex items-center justify-center rounded-lg bg-violet-500 hover:bg-violet-400 text-white transition"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  {goalId && (
                    <button onClick={deleteGoal} className="mt-3 text-xs font-medium text-rose-500/60 hover:text-rose-400 transition">
                      Delete selected goal
                    </button>
                  )}
                </div>

                {/* FX Rates */}
                <div>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Currency Exchange (USD base)</p>
                  {Object.keys(rates).length === 0 ? (
                    <button
                      onClick={loadRates}
                      className="w-full rounded-xl border border-dashed border-white/20 bg-transparent px-4 py-2.5 text-sm text-slate-400 hover:border-white/40 hover:text-white transition"
                    >
                      Load FX rates
                    </button>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(rates).map(([currency, rate]) => (
                        <span key={currency} className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium tracking-wide text-slate-300">
                          {currency} <span className="text-slate-500 ml-1">{Number(rate).toFixed(3)}</span>
                        </span>
                      ))}
                      <button onClick={loadRates} className="rounded-lg border border-white/5 bg-white/5 px-3 py-1.5 text-xs text-slate-400 hover:text-white transition">↻ Refresh</button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
