"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/client/local-db";
import { isAdminEmail } from "@/lib/admin";
import { ProfileMenu } from "@/components/profile-menu";

type CurrencyPayload = { payload?: { rates?: Record<string, number> } };
type SessionState = { email: string; role: string; workspaceId: string } | null;

type Project = { id: string; name: string };
type Goal = { id: string; name: string };

export function TimerDashboard() {
  const [taskId, setTaskId] = useState("TASK-1");
  const [workspaceSlug, setWorkspaceSlug] = useState("default-workspace");
  const [email, setEmail] = useState("user@example.com");
  const [entryId, setEntryId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pomodoroMinutes] = useState(25);
  const [status, setStatus] = useState("Ready");
  const [rates, setRates] = useState<Record<string, number>>({});
  const [session, setSession] = useState<SessionState>(null);
  const [timezone, setTimezone] = useState("UTC");
  const [preferredTags, setPreferredTags] = useState("focus,client-a");
  const [projectId, setProjectId] = useState("");
  const [goalId, setGoalId] = useState("");
  const [tags, setTags] = useState("focus");
  const [projects, setProjects] = useState<Project[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [workspaceTags, setWorkspaceTags] = useState<string[]>([]);

  const isRunning = Boolean(entryId && startedAt);
  const pomodoroRemaining = useMemo(() => Math.max(0, pomodoroMinutes * 60 - elapsed), [elapsed, pomodoroMinutes]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (startedAt) setElapsed(Math.floor((Date.now() - startedAt.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && isRunning) setStatus("Idle detected — review whether to discard or reassign this time block.");
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [isRunning]);

  // Load session on mount so the profile menu is populated immediately.
  useEffect(() => {
    refreshSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshSession() {
    const response = await fetch("/api/auth/me");
    const data = await response.json();
    setSession(response.ok ? data.session : null);
  }

  async function loadProjectsAndGoals() {
    const [projectResponse, goalResponse, tagResponse] = await Promise.all([fetch("/api/projects"), fetch("/api/goals"), fetch("/api/tags")]);
    const projectData = await projectResponse.json();
    const goalData = await goalResponse.json();
    const tagData = await tagResponse.json();

    if (projectResponse.ok) setProjects(projectData.projects ?? []);
    if (goalResponse.ok) setGoals(goalData.goals ?? []);
    if (tagResponse.ok) setWorkspaceTags(tagData.tags ?? []);
  }

  async function loadSettings() {
    const response = await fetch("/api/user/settings");
    const data = await response.json();
    if (response.ok) {
      setTimezone(data.user.timezone ?? "UTC");
      setPreferredTags((data.user.preferredTags ?? []).join(","));
    }
  }

  async function saveSettings() {
    const response = await fetch("/api/user/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone, preferredTags: preferredTags.split(",").map((item) => item.trim()).filter(Boolean) }),
    });
    const data = await response.json();
    setStatus(response.ok ? `Settings saved (${data.user.timezone})` : `Settings failed: ${data.error}`);
  }

  async function sendLoginLink() {
    const response = await fetch("/api/auth/request-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, workspaceSlug }),
    });
    const data = await response.json();
    setStatus(response.ok ? `Magic link created (${data.delivery}).` : `Login failed: ${data.error}`);
  }

  async function createProject() {
    const name = window.prompt("Project name");
    if (!name) return;
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, billingModel: "hourly" }),
    });
    const data = await response.json();
    setStatus(response.ok ? `Project created: ${data.project.name}` : `Project create failed: ${data.error}`);
    await loadProjectsAndGoals();
  }

  async function updateProject() {
    if (!projectId) return;
    const name = window.prompt("New project name");
    if (!name) return;
    const response = await fetch("/api/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, name }),
    });
    const data = await response.json();
    setStatus(response.ok ? `Project updated: ${data.project.name}` : `Project update failed: ${data.error}`);
    await loadProjectsAndGoals();
  }

  async function deleteProject() {
    if (!projectId) return;
    const response = await fetch(`/api/projects?projectId=${encodeURIComponent(projectId)}`, { method: "DELETE" });
    const data = await response.json();
    setStatus(response.ok ? `Project removed: ${data.deletedProjectId}` : `Project delete failed: ${data.error}`);
    setProjectId("");
    await loadProjectsAndGoals();
  }

  async function createGoal() {
    const name = window.prompt("Goal name");
    if (!name) return;
    const response = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, projectId: projectId || undefined }),
    });
    const data = await response.json();
    setStatus(response.ok ? `Goal created: ${data.goal.name}` : `Goal create failed: ${data.error}`);
    await loadProjectsAndGoals();
  }

  async function updateGoal() {
    if (!goalId) return;
    const name = window.prompt("New goal name");
    if (!name) return;
    const response = await fetch("/api/goals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goalId, name }),
    });
    const data = await response.json();
    setStatus(response.ok ? `Goal updated: ${data.goal.name}` : `Goal update failed: ${data.error}`);
    await loadProjectsAndGoals();
  }

  async function deleteGoal() {
    if (!goalId) return;
    const response = await fetch(`/api/goals?goalId=${encodeURIComponent(goalId)}`, { method: "DELETE" });
    const data = await response.json();
    setStatus(response.ok ? `Goal removed: ${data.deletedGoalId}` : `Goal delete failed: ${data.error}`);
    setGoalId("");
    await loadProjectsAndGoals();
  }

  async function renameTag() {
    const fromTag = window.prompt("Rename from tag", workspaceTags[0] ?? "focus");
    const toTag = window.prompt("Rename to tag", "updated-tag");
    if (!fromTag || !toTag) return;

    const response = await fetch("/api/tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromTag, toTag }),
    });
    const data = await response.json();
    setStatus(response.ok ? `Tag renamed ${data.fromTag} -> ${data.toTag}` : `Tag rename failed: ${data.error}`);
    await loadProjectsAndGoals();
  }

  async function deleteTag() {
    const tag = window.prompt("Tag to delete", workspaceTags[0] ?? "focus");
    if (!tag) return;
    const response = await fetch(`/api/tags?tag=${encodeURIComponent(tag)}`, { method: "DELETE" });
    const data = await response.json();
    setStatus(response.ok ? `Tag deleted: ${data.removedTag}` : `Tag delete failed: ${data.error}`);
    await loadProjectsAndGoals();
  }

  async function startTimer() {
    const started = new Date();
    const response = await fetch("/api/timer/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        description: "Focus block",
        projectId: projectId || undefined,
        goalId: goalId || undefined,
        tags: tags.split(",").map((item) => item.trim()).filter(Boolean),
      }),
    });

    const data = await response.json();
    if (!response.ok) return setStatus(`Start failed: ${data.error}`);

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

    setStatus("Timer started and persisted to IndexedDB for crash-safe local-first sync.");
  }

  async function stopTimer() {
    if (!entryId) return;

    const response = await fetch("/api/timer/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId }),
    });

    const data = await response.json();
    if (!response.ok) return setStatus(`Stop failed: ${data.error}`);

    await db.draftTimers.delete(entryId);
    setEntryId(null);
    setStartedAt(null);
    setElapsed(0);
    setStatus(`Stopped. Duration ${data.durationSeconds} seconds.`);
  }

  async function loadRates() {
    const response = await fetch("/api/currency/rates?base=USD&symbols=EUR,GBP,CAD,JPY");
    const data = (await response.json()) as CurrencyPayload;
    setRates(data.payload?.rates ?? {});
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 rounded-xl border border-slate-800 bg-slate-950 p-6 text-slate-100">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Timely Workforce Intelligence</h1>
          <p className="text-sm text-slate-400">Compliance-first time tracking with full auditability.</p>
        </div>
        {session && (
          <ProfileMenu
            email={session.email}
            isAdmin={isAdminEmail(session.email)}
          />
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">Workspace Slug<input className="rounded bg-slate-900 p-2" value={workspaceSlug} onChange={(e) => setWorkspaceSlug(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-sm">Email Login<input className="rounded bg-slate-900 p-2" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-sm">Task ID<input className="rounded bg-slate-900 p-2" value={taskId} onChange={(e) => setTaskId(e.target.value)} /></label>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">Timezone<input className="rounded bg-slate-900 p-2" value={timezone} onChange={(e) => setTimezone(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-sm">Preferred Tags<input className="rounded bg-slate-900 p-2" value={preferredTags} onChange={(e) => setPreferredTags(e.target.value)} /></label>
        <div className="flex items-end gap-2">
          <button className="rounded bg-cyan-600 px-3 py-2 text-sm font-medium" onClick={sendLoginLink}>Send Magic Link</button>
          <button className="rounded bg-slate-700 px-3 py-2 text-sm" onClick={refreshSession}>Session</button>
          <button className="rounded bg-emerald-700 px-3 py-2 text-sm" onClick={saveSettings}>Save Settings</button>
          <button className="rounded bg-slate-700 px-3 py-2 text-sm" onClick={loadSettings}>Load Settings</button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">Project
          <select className="rounded bg-slate-900 p-2" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">None</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">Goal
          <select className="rounded bg-slate-900 p-2" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            <option value="">None</option>
            {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">Entry Tags<input className="rounded bg-slate-900 p-2" value={tags} onChange={(e) => setTags(e.target.value)} /></label>
        <div className="flex items-end gap-2">
          <button className="rounded bg-violet-700 px-3 py-2 text-sm" onClick={loadProjectsAndGoals}>Load Data</button>
          <button className="rounded bg-violet-600 px-3 py-2 text-sm" onClick={createProject}>+Proj</button>
          <button className="rounded bg-violet-500 px-3 py-2 text-sm" onClick={updateProject}>Edit</button>
          <button className="rounded bg-rose-700 px-3 py-2 text-sm" onClick={deleteProject}>Del</button>
          <button className="rounded bg-sky-600 px-3 py-2 text-sm" onClick={createGoal}>+Goal</button>
          <button className="rounded bg-sky-500 px-3 py-2 text-sm" onClick={updateGoal}>Edit</button>
          <button className="rounded bg-rose-700 px-3 py-2 text-sm" onClick={deleteGoal}>Del</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="rounded bg-amber-700 px-3 py-2" onClick={renameTag}>Rename Tag</button>
        <button className="rounded bg-rose-700 px-3 py-2" onClick={deleteTag}>Delete Tag</button>
        <button className="rounded bg-emerald-600 px-3 py-2" disabled={isRunning} onClick={startTimer}>Start</button>
        <button className="rounded bg-rose-600 px-3 py-2" disabled={!isRunning} onClick={stopTimer}>Stop</button>
        <button className="rounded bg-indigo-600 px-3 py-2" onClick={loadRates}>Load FX</button>
      </div>

      <div className="grid gap-2 rounded border border-slate-800 bg-slate-900 p-3 text-sm md:grid-cols-2">
        <div>Timer: {isRunning ? "Running" : "Stopped"}</div>
        <div>Elapsed: {elapsed}s</div>
        <div>Pomodoro remaining: {pomodoroRemaining}s</div>
        <div>Workspace Tags: {workspaceTags.join(", ") || "(none)"}</div>
      </div>

      <pre className="overflow-auto rounded bg-slate-900 p-3 text-xs">{JSON.stringify({ session, status, rates, projectId, goalId, tags }, null, 2)}</pre>
    </div>
  );
}
