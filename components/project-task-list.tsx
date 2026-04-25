"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Circle, Plus, Trash2 } from "lucide-react";

import type { ProjectTask } from "@/lib/store";

type PersonOption = {
  id: string;
  linkedUserId?: string | null;
  displayName?: string | null;
  email?: string | null;
  title?: string | null;
  organizationId: string;
  status?: "active" | "archived";
};

type TaskDraft = {
  title: string;
  description: string;
  status: ProjectTask["status"];
  assigneeId: string;
  dueDate: string;
  estimatedHours: string;
};

const STATUS_OPTIONS: Array<{ value: ProjectTask["status"]; label: string }> = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "review", label: "Review" },
  { value: "done", label: "Done" },
];

export function ProjectTaskList({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAssigneeId, setNewAssigneeId] = useState("");
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, TaskDraft>>({});

  useEffect(() => {
    async function load() {
      try {
        const [tasksResponse, peopleResponse] = await Promise.all([
          fetch(`/api/tasks?projectId=${projectId}`),
          fetch("/api/people"),
        ]);
        const tasksData = await tasksResponse.json();
        const peopleData = await peopleResponse.json();
        if (tasksResponse.ok) setTasks(tasksData.tasks || []);
        if (peopleResponse.ok) setPeople((peopleData.people || []).filter((person: PersonOption & { status?: string }) => person.status !== "archived"));
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [projectId]);

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((left, right) => left.position - right.position);
  }, [tasks]);

  function personLabel(person: PersonOption) {
    return person.displayName || person.email || "Unnamed person";
  }

  function getAssigneeLabel(task: ProjectTask) {
    const match = people.find((person) => person.id === task.assigneeId || person.linkedUserId === task.assigneeId);
    return match ? personLabel(match) : "Unassigned";
  }

  function openTask(task: ProjectTask) {
    setExpandedTaskId(task.id);
    setDrafts((current) => ({
      ...current,
      [task.id]: {
        title: task.title,
        description: task.description || "",
        status: task.status,
        assigneeId: task.assigneeId || "",
        dueDate: task.dueDate ? String(task.dueDate).slice(0, 10) : "",
        estimatedHours: task.estimatedHours ? String(task.estimatedHours) : "",
      },
    }));
  }

  async function createTask() {
    if (!newTitle.trim()) return;
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        title: newTitle.trim(),
        assigneeId: newAssigneeId || undefined,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      toast.error("Could not create task", { description: data.error });
      return;
    }
    setTasks((current) => [data.task, ...current]);
    setNewTitle("");
    setNewAssigneeId("");
    setAdding(false);
    toast.success("Task created");
  }

  async function saveTask(taskId: string) {
    const draft = drafts[taskId];
    if (!draft) return;

    const response = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        status: draft.status,
        assigneeId: draft.assigneeId || null,
        dueDate: draft.dueDate || null,
        estimatedHours: draft.estimatedHours ? Number.parseFloat(draft.estimatedHours) : null,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      toast.error("Could not save task", { description: data.error });
      return;
    }
    setTasks((current) => current.map((task) => (task.id === taskId ? data.task : task)));
    toast.success("Task updated");
  }

  async function deleteTask(taskId: string) {
    const response = await fetch(`/api/tasks?taskId=${taskId}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) {
      toast.error("Could not delete task", { description: data.error });
      return;
    }
    setTasks((current) => current.filter((task) => task.id !== taskId));
    if (expandedTaskId === taskId) setExpandedTaskId(null);
    toast.success("Task deleted");
  }

  if (loading) {
    return <div className="p-8 text-slate-500 animate-pulse">Loading tasks...</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-[28px] border border-slate-200 bg-slate-50 p-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Task list</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-950">Track work with explicit assignees and optional details</h2>
          <p className="mt-1 text-sm text-slate-500">Use this view when you need a denser operational list than kanban, especially for assignment and due-date cleanup.</p>
        </div>
        <button
          type="button"
          onClick={() => setAdding((current) => !current)}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          New task
        </button>
      </div>

      {adding && (
        <div className="rounded-[28px] border border-cyan-200 bg-cyan-50 p-5 shadow-sm">
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr_auto]">
            <input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="Write the next task item"
              className="h-12 rounded-2xl border border-cyan-200 bg-white px-4 text-sm outline-none focus:border-cyan-500"
            />
            <select
              value={newAssigneeId}
              onChange={(event) => setNewAssigneeId(event.target.value)}
              className="h-12 rounded-2xl border border-cyan-200 bg-white px-3 text-sm outline-none focus:border-cyan-500"
            >
              <option value="">Unassigned</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {personLabel(person)}
                </option>
              ))}
            </select>
            <button onClick={createTask} className="h-12 rounded-2xl bg-cyan-600 px-4 text-sm font-bold text-white transition hover:bg-cyan-500">
              Add task
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {sortedTasks.length === 0 ? (
          <div className="rounded-[32px] border border-dashed border-slate-300 bg-white p-16 text-center shadow-sm">
            <Circle className="mx-auto mb-4 h-14 w-14 text-slate-300" />
            <h3 className="text-xl font-semibold text-slate-950">No tasks yet</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">Create the first task and start assigning real owners from the people workspace.</p>
          </div>
        ) : (
          sortedTasks.map((task) => {
            const expanded = expandedTaskId === task.id;
            const draft = drafts[task.id];
            return (
              <article key={task.id} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <button type="button" onClick={() => openTask(task)} className="text-left">
                    <div className="flex items-center gap-3">
                      {task.status === "done" ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-slate-300" />}
                      <div>
                        <h3 className="text-base font-semibold text-slate-950">{task.title}</h3>
                        <p className="mt-1 text-sm text-slate-500">{getAssigneeLabel(task)} • {task.estimatedHours ? `${task.estimatedHours}h` : "No estimate"} • {task.dueDate ? `Due ${String(task.dueDate).slice(0, 10)}` : "No due date"}</p>
                      </div>
                    </div>
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{task.status.replace("_", " ")}</span>
                    <button onClick={() => deleteTask(task.id)} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 transition hover:border-rose-200 hover:text-rose-600">
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  </div>
                </div>

                {expanded && draft && (
                  <div className="mt-5 grid gap-4 border-t border-slate-100 pt-5 lg:grid-cols-2">
                    <label className="text-sm font-semibold text-slate-700">
                      Title
                      <input
                        value={draft.title}
                        onChange={(event) => setDrafts((current) => ({ ...current, [task.id]: { ...draft, title: event.target.value } }))}
                        className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-cyan-500"
                      />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Assignee
                      <select
                        value={draft.assigneeId}
                        onChange={(event) => setDrafts((current) => ({ ...current, [task.id]: { ...draft, assigneeId: event.target.value } }))}
                        className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500"
                      >
                        <option value="">Unassigned</option>
                        {people.map((person) => (
                          <option key={person.id} value={person.id}>
                            {personLabel(person)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Status
                      <select
                        value={draft.status}
                        onChange={(event) => setDrafts((current) => ({ ...current, [task.id]: { ...draft, status: event.target.value as ProjectTask["status"] } }))}
                        className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500"
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Due date
                      <input
                        type="date"
                        value={draft.dueDate}
                        onChange={(event) => setDrafts((current) => ({ ...current, [task.id]: { ...draft, dueDate: event.target.value } }))}
                        className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-cyan-500"
                      />
                    </label>
                    <label className="text-sm font-semibold text-slate-700">
                      Estimated hours
                      <input
                        type="number"
                        min="0"
                        step="0.25"
                        value={draft.estimatedHours}
                        onChange={(event) => setDrafts((current) => ({ ...current, [task.id]: { ...draft, estimatedHours: event.target.value } }))}
                        className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-cyan-500"
                      />
                    </label>
                    <label className="text-sm font-semibold text-slate-700 lg:col-span-2">
                      Description
                      <textarea
                        rows={4}
                        value={draft.description}
                        onChange={(event) => setDrafts((current) => ({ ...current, [task.id]: { ...draft, description: event.target.value } }))}
                        className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cyan-500"
                      />
                    </label>
                    <div className="lg:col-span-2 flex justify-end">
                      <button onClick={() => saveTask(task.id)} className="rounded-2xl bg-cyan-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-cyan-500">
                        Save task
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
