"use client";

import { useEffect, useMemo, useState } from "react";

type SessionState = { email: string; role: string; workspaceId: string } | null;
type Project = { id: string; name: string };
type Goal = { id: string; name: string };
type Entry = {
  id: string;
  taskId: string;
  description?: string;
  projectId?: string;
  goalId?: string;
  tags: string[];
  billable: boolean;
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number | null;
};

function formatDuration(seconds: number) {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600).toString().padStart(2, "0");
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

export function TimerDashboard() {
  const [session, setSession] = useState<SessionState>(null);
  const [email, setEmail] = useState("user@example.com");
  const [workspaceSlug, setWorkspaceSlug] = useState("default-workspace");
  const [taskId, setTaskId] = useState("TASK-1");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [goalId, setGoalId] = useState("");
  const [tags, setTags] = useState("focus");
  const [billable, setBillable] = useState(false);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState("Ready");

  const [projects, setProjects] = useState<Project[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [workspaceTags, setWorkspaceTags] = useState<string[]>([]);
  const [entriesByDay, setEntriesByDay] = useState<Record<string, Entry[]>>({});

  const isRunning = Boolean(entryId && startedAt);
  const totalWeekSeconds = useMemo(() => {
    return Object.values(entriesByDay).flat().reduce((acc, entry) => acc + (entry.durationSeconds ?? 0), 0);
  }, [entriesByDay]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (startedAt) setElapsed(Math.floor((Date.now() - startedAt.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  async function requestMagicLink() {
    const response = await fetch("/api/auth/request-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, workspaceSlug }),
    });
    const data = await response.json();
    setStatus(response.ok ? `Login link issued (${data.delivery})` : `Login failed: ${data.error}`);
  }

  async function refreshSession() {
    const response = await fetch("/api/auth/me");
    const data = await response.json();
    setSession(response.ok ? data.session : null);
  }

  async function loadMetadata() {
    const [projectResponse, goalResponse, tagResponse, listResponse] = await Promise.all([
      fetch("/api/projects"),
      fetch("/api/goals"),
      fetch("/api/tags"),
      fetch("/api/timer/list"),
    ]);

    const projectData = await projectResponse.json();
    const goalData = await goalResponse.json();
    const tagData = await tagResponse.json();
    const listData = await listResponse.json();

    if (projectResponse.ok) setProjects(projectData.projects ?? []);
    if (goalResponse.ok) setGoals(goalData.goals ?? []);
    if (tagResponse.ok) setWorkspaceTags(tagData.tags ?? []);
    if (listResponse.ok) setEntriesByDay(listData.grouped ?? {});
  }

  async function startTimer() {
    const response = await fetch("/api/timer/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        description,
        projectId: projectId || undefined,
        goalId: goalId || undefined,
        tags: tags.split(",").map((x) => x.trim()).filter(Boolean),
        billable,
      }),
    });

    const data = await response.json();
    if (!response.ok) return setStatus(`Start failed: ${data.error}`);

    setEntryId(data.entry.id);
    setStartedAt(new Date());
    setElapsed(0);
    setStatus("Timer running");
    await loadMetadata();
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

    setEntryId(null);
    setStartedAt(null);
    setElapsed(0);
    setStatus(`Stopped at ${data.durationSeconds}s`);
    await loadMetadata();
  }

  async function mutate(type: "project" | "goal" | "tag", mode: "create" | "rename" | "delete") {
    if (type === "project" && mode === "create") {
      const name = window.prompt("Project name");
      if (!name) return;
      await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    }
    if (type === "project" && mode === "rename") {
      if (!projectId) return;
      const name = window.prompt("New project name");
      if (!name) return;
      await fetch("/api/projects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, name }) });
    }
    if (type === "project" && mode === "delete") {
      if (!projectId) return;
      await fetch(`/api/projects?projectId=${encodeURIComponent(projectId)}`, { method: "DELETE" });
      setProjectId("");
    }

    if (type === "goal" && mode === "create") {
      const name = window.prompt("Goal name");
      if (!name) return;
      await fetch("/api/goals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, projectId: projectId || undefined }) });
    }
    if (type === "goal" && mode === "rename") {
      if (!goalId) return;
      const name = window.prompt("New goal name");
      if (!name) return;
      await fetch("/api/goals", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goalId, name }) });
    }
    if (type === "goal" && mode === "delete") {
      if (!goalId) return;
      await fetch(`/api/goals?goalId=${encodeURIComponent(goalId)}`, { method: "DELETE" });
      setGoalId("");
    }

    if (type === "tag" && mode === "rename") {
      const fromTag = window.prompt("Tag to rename", workspaceTags[0] ?? "focus");
      const toTag = window.prompt("Rename to", "updated-tag");
      if (!fromTag || !toTag) return;
      await fetch("/api/tags", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fromTag, toTag }) });
    }
    if (type === "tag" && mode === "delete") {
      const tag = window.prompt("Tag to remove", workspaceTags[0] ?? "focus");
      if (!tag) return;
      await fetch(`/api/tags?tag=${encodeURIComponent(tag)}`, { method: "DELETE" });
    }

    await loadMetadata();
  }

  const orderedDays = Object.keys(entriesByDay).sort((a, b) => (a < b ? 1 : -1));

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded bg-sky-600 px-2 py-1 text-white">T</div>
          <div className="text-xl font-semibold">timely</div>
          <div className="ml-4 text-sm text-slate-500">{session?.workspaceId ?? "No workspace"}</div>
        </div>
        <div className="flex gap-2">
          <input className="rounded border px-2 py-1" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="rounded border px-2 py-1" value={workspaceSlug} onChange={(e) => setWorkspaceSlug(e.target.value)} />
          <button className="rounded bg-sky-600 px-3 py-1 text-white" onClick={requestMagicLink}>Login Link</button>
          <button className="rounded border px-3 py-1" onClick={refreshSession}>Session</button>
        </div>
      </header>

      <div className="grid grid-cols-[240px_1fr]">
        <aside className="min-h-[calc(100vh-64px)] border-r bg-white p-4">
          <div className="mb-4 text-xs uppercase text-slate-400">Track</div>
          <ul className="space-y-2 text-sm">
            <li className="rounded bg-slate-100 px-3 py-2 font-medium">Time Tracker</li>
            <li className="px-3 py-2">Calendar</li>
          </ul>
          <div className="mt-6 text-xs uppercase text-slate-400">Manage</div>
          <ul className="space-y-2 text-sm">
            <li className="px-3 py-2">Projects</li>
            <li className="px-3 py-2">Goals</li>
            <li className="px-3 py-2">Tags</li>
          </ul>
        </aside>

        <main className="p-6">
          <section className="rounded border bg-white p-4 shadow-sm">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2">
              <input className="rounded border px-3 py-2" placeholder="What are you working on?" value={description} onChange={(e) => setDescription(e.target.value)} />
              <input className="rounded border px-3 py-2" placeholder="Task ID" value={taskId} onChange={(e) => setTaskId(e.target.value)} />
              <select className="rounded border px-3 py-2" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Project</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
              <select className="rounded border px-3 py-2" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                <option value="">Goal</option>
                {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.name}</option>)}
              </select>
              <button className="rounded bg-sky-600 px-5 py-2 text-white" onClick={isRunning ? stopTimer : startTimer}>{isRunning ? "STOP" : "START"}</button>
            </div>
            <div className="mt-2 flex items-center gap-3 text-sm text-slate-600">
              <input className="rounded border px-2 py-1" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags (comma separated)" />
              <label className="flex items-center gap-2"><input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} />Billable</label>
              <span className="font-mono text-lg">{formatDuration(elapsed)}</span>
              <span className="ml-auto">Week total: {formatDuration(totalWeekSeconds)}</span>
            </div>
          </section>

          <section className="mt-4 rounded border bg-white p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              <button className="rounded border px-2 py-1 text-xs" onClick={() => mutate("project", "create")}>+ Project</button>
              <button className="rounded border px-2 py-1 text-xs" onClick={() => mutate("project", "rename")}>Rename Project</button>
              <button className="rounded border px-2 py-1 text-xs" onClick={() => mutate("project", "delete")}>Delete Project</button>
              <button className="rounded border px-2 py-1 text-xs" onClick={() => mutate("goal", "create")}>+ Goal</button>
              <button className="rounded border px-2 py-1 text-xs" onClick={() => mutate("goal", "rename")}>Rename Goal</button>
              <button className="rounded border px-2 py-1 text-xs" onClick={() => mutate("goal", "delete")}>Delete Goal</button>
              <button className="rounded border px-2 py-1 text-xs" onClick={() => mutate("tag", "rename")}>Rename Tag</button>
              <button className="rounded border px-2 py-1 text-xs" onClick={() => mutate("tag", "delete")}>Delete Tag</button>
              <button className="rounded border px-2 py-1 text-xs" onClick={loadMetadata}>Refresh Data</button>
            </div>

            {orderedDays.length === 0 ? (
              <div className="rounded border border-dashed p-8 text-center text-slate-500">No entries yet. Start a timer to create your first time row.</div>
            ) : (
              <div className="space-y-4">
                {orderedDays.map((day) => {
                  const rows = entriesByDay[day] ?? [];
                  const dayTotal = rows.reduce((acc, row) => acc + (row.durationSeconds ?? 0), 0);
                  return (
                    <div key={day} className="rounded border">
                      <div className="flex items-center justify-between bg-slate-50 px-4 py-2">
                        <div className="font-medium">{day}</div>
                        <div className="font-mono">{formatDuration(dayTotal)}</div>
                      </div>
                      <div className="divide-y">
                        {rows.map((row) => (
                          <div key={row.id} className="grid grid-cols-[2fr_1fr_1fr_120px] items-center gap-2 px-4 py-3 text-sm">
                            <div>
                              <div className="font-medium">{row.description || row.taskId}</div>
                              <div className="text-xs text-slate-500">{row.taskId} • {row.tags.join(", ") || "no tags"}</div>
                            </div>
                            <div>{projects.find((p) => p.id === row.projectId)?.name ?? "—"}</div>
                            <div>{goals.find((g) => g.id === row.goalId)?.name ?? "—"}</div>
                            <div className="text-right font-mono">{formatDuration(row.durationSeconds ?? 0)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <div className="mt-3 text-xs text-slate-500">Status: {status} • Workspace tags: {workspaceTags.join(", ") || "none"}</div>
        </main>
      </div>
    </div>
  );
}
