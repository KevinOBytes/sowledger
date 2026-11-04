"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, Plus, Trash2 } from "lucide-react";
import { assigneeLabel, draftPatch, hasIncompleteBlocker, mergeTaskDraft, personLabel, readDeletedTask, readPeople, readSavedTask, readTasks, taskDraft, TASK_STATUSES, type TaskDraft, type TaskPerson, type TaskRecord } from "@/lib/task-client-state";

// Project-local state is intentionally discarded when the caller changes projects.
export function ProjectTaskList({ projectId }: { projectId: string }) { return <TaskList key={projectId} projectId={projectId} />; }

function TaskList({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [people, setPeople] = useState<TaskPerson[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, TaskDraft>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const alive = useRef(false); const generation = useRef(0); const lock = useRef(false);
  const alertRef = useRef<HTMLDivElement>(null);

  async function load() {
    if (lock.current) return;
    const request = ++generation.current;
    try {
      const [taskResponse, peopleResponse] = await Promise.all([fetch(`/api/tasks?projectId=${encodeURIComponent(projectId)}`), fetch("/api/people")]);
      if (!taskResponse.ok || !peopleResponse.ok) throw new Error("Load failed");
      const [taskData, peopleData] = await Promise.all([taskResponse.json(), peopleResponse.json()]);
      const nextTasks = readTasks(taskData, projectId); const nextPeople = readPeople(peopleData);
      if (!alive.current || generation.current !== request) return;
      setDrafts(current => Object.fromEntries(nextTasks.flatMap(next => {
        const before = tasks.find(task => task.id === next.id);
        return before && current[next.id] ? [[next.id, mergeTaskDraft(current[next.id], before, next, {})]] : [];
      })));
      setTasks(nextTasks); setPeople(nextPeople); setLoaded(true); setLoadState("ready");
    } catch { if (alive.current && generation.current === request) setLoadState("failed"); }
  }
  function refresh() { if (!lock.current) { setLoadState("loading"); setFeedback(null); void load(); } }
  // Initial data is fetched asynchronously; keyed lifetime and generation fence abandoned effects.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; generation.current++; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (feedback?.error) alertRef.current?.focus(); }, [feedback]);
  const disabled = pending !== null || loadState !== "ready";

  async function mutate(kind: string, action: (isCurrent: () => boolean) => Promise<void>, failure: string) {
    if (lock.current || loadState !== "ready") return;
    lock.current = true; const request = ++generation.current; setPending(kind); setFeedback(null);
    try { await action(() => alive.current && generation.current === request); }
    catch { if (alive.current && generation.current === request) setFeedback({ error: true, text: failure }); }
    finally { if (alive.current && generation.current === request) { lock.current = false; setPending(null); } }
  }
  async function createTask() {
    if (lock.current || !newTitle.trim() || newTitle.trim().length > 255) return;
    const values = { title: newTitle.trim(), assigneeId: newAssignee || null, status: "todo" as const };
    await mutate("create", async isCurrent => {
      const response = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, ...values }) });
      if (!response.ok) throw new Error("Create failed");
      const saved = readSavedTask(await response.json(), projectId, null, values);
      if (!isCurrent()) return;
      if (tasks.some(task => task.id === saved.id)) throw new Error("Duplicate response");
      setTasks(current => [saved, ...current]); setNewTitle(""); setNewAssignee(""); setAdding(false); setFeedback({ error: false, text: "Task created." });
    }, "Could not confirm task creation. Your draft is kept. Check existing tasks before retrying to avoid duplicates.");
  }
  async function saveTask(id: string) {
    if (lock.current) return;
    let values;
    try { values = draftPatch(drafts[id]); } catch (error) { setFeedback({ error: true, text: (error as Error).message }); return; }
    const task = tasks.find(task => task.id === id)!;
    if ((values.status === "review" || values.status === "done") && hasIncompleteBlocker(task, tasks)) { setFeedback({ error: true, text: "Finish the incomplete blockers shown here before moving this task to Review or Done." }); return; }
    await mutate(id, async isCurrent => {
      const response = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: id, ...values }) });
      if (!response.ok) throw new Error("Save failed");
      const saved = readSavedTask(await response.json(), projectId, id, values);
      if (!isCurrent()) return;
      setTasks(current => current.map(task => task.id === id ? saved : task)); setDrafts(current => ({ ...current, [id]: taskDraft(saved) })); setFeedback({ error: false, text: "Task saved." });
    }, "Could not confirm the task save. Your changes are kept; try Save task again.");
  }
  async function deleteTask(id: string) {
    await mutate(`delete:${id}`, async isCurrent => {
      const response = await fetch(`/api/tasks?taskId=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete failed"); readDeletedTask(await response.json(), id);
      if (!isCurrent()) return;
      setTasks(current => current.filter(task => task.id !== id && task.parentId !== id)); setExpanded(null); setFeedback({ error: false, text: "Task deleted." });
    }, "Could not confirm task deletion. The task is still shown; refresh or try again.");
  }
  function change(id: string, values: Partial<TaskDraft>) { if (!lock.current) setDrafts(current => ({ ...current, [id]: { ...current[id], ...values } })); }
  const field = "mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-cyan-500 disabled:opacity-60";
  const button = "rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold disabled:opacity-50";
  return <section className="min-w-0 space-y-4 text-slate-700" aria-label="Project tasks">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-5">
      <div><h2 className="text-xl font-semibold text-slate-950">Tasks</h2><p className="text-sm text-slate-500">Add work and set a due date.</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={disabled} onClick={refresh} className={button}>Refresh tasks</button><button type="button" disabled={disabled} onClick={() => setAdding(!adding)} className={`${button} inline-flex items-center gap-2 bg-cyan-600 text-white`}><Plus className="h-4 w-4"/>New task</button></div>
    </header>
    {loadState === "loading" && <p role="status">Loading tasks…</p>}
    {loadState === "failed" && <div role="alert" className="rounded-2xl border border-rose-200 bg-white p-4"><p>Could not load tasks and assignees. {loaded ? "Previously loaded tasks are still shown; refresh before making changes." : "Try loading again before making changes."}</p><button type="button" onClick={refresh} className={`${button} mt-2`}>Retry loading tasks</button></div>}
    {feedback && <div ref={alertRef} tabIndex={-1} role={feedback.error ? "alert" : "status"} className="break-words rounded-2xl border border-slate-200 bg-white p-4">{feedback.text}</div>}
    {pending && <p role="status">{pending === "create" ? "Creating task…" : pending.startsWith("delete:") ? "Deleting task…" : "Saving task…"}</p>}
    {adding && <form onSubmit={event => { event.preventDefault(); void createTask(); }} className="grid min-w-0 gap-3 rounded-3xl border border-cyan-200 bg-white p-4 sm:grid-cols-2">
      <label className="min-w-0 text-sm font-semibold">New task title<input maxLength={255} required value={newTitle} disabled={disabled} onChange={event => setNewTitle(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void createTask(); } }} className={field}/></label>
      <label className="min-w-0 text-sm font-semibold">New task assignee<select aria-label="New task assignee" value={newAssignee} disabled={disabled} onChange={event => setNewAssignee(event.target.value)} className={field}><option value="">Unassigned</option>{people.filter(person => person.status !== "archived").map(person => <option key={person.id} value={person.id}>{personLabel(person)}</option>)}</select></label>
      <div className="flex flex-wrap gap-2 sm:col-span-2"><button type="submit" disabled={disabled || !newTitle.trim()} className={`${button} bg-cyan-600 text-white`}>{pending === "create" ? "Creating…" : "Add task"}</button><button type="button" disabled={disabled} onClick={() => { setAdding(false); setNewTitle(""); setNewAssignee(""); }} className={button}>Cancel new task</button></div>
    </form>}
    {loaded && tasks.length === 0 && <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-center"><h3 className="font-semibold">No tasks yet</h3><p className="text-sm">Choose New task to add your first item.</p></div>}
    {[...tasks].sort((a, b) => a.position - b.position).map(task => { const draft = drafts[task.id]; return <article key={task.id} className="min-w-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3"><button type="button" aria-label={`Open task: ${task.title}`} disabled={pending !== null} onClick={() => { if (lock.current) return; setExpanded(task.id); setDrafts(current => current[task.id] ? current : { ...current, [task.id]: taskDraft(task) }); }} className="min-w-0 flex-1 text-left disabled:opacity-60"><h3 className="flex items-start gap-2 break-words font-semibold text-slate-950">{task.status === "done" ? <CheckCircle2 className="h-5 w-5 shrink-0 text-cyan-600"/> : <Circle className="h-5 w-5 shrink-0 text-slate-400"/>}<span className="min-w-0 break-words">{task.title}</span></h3><p className="mt-1 break-words text-sm text-slate-500"><span>{assigneeLabel(task.assigneeId, people)}</span> • {task.estimatedHours === null ? "No estimate" : `${task.estimatedHours}h`} • {task.dueDate ? `Due ${task.dueDate.slice(0, 10)}` : "No due date"}</p></button>
        <button type="button" aria-label={`Delete task: ${task.title}`} disabled={disabled} onClick={() => void deleteTask(task.id)} className={`${button} inline-flex items-center gap-2`}><Trash2 className="h-4 w-4"/>Delete</button></div>
      {expanded === task.id && draft && <form onSubmit={event => { event.preventDefault(); void saveTask(task.id); }} className="mt-4 grid min-w-0 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
        <label className="min-w-0 text-sm font-semibold">Title<input required maxLength={255} disabled={disabled} value={draft.title} onChange={event => change(task.id, { title: event.target.value })} className={field}/></label>
        <label className="min-w-0 text-sm font-semibold">Assignee<select aria-label="Assignee" disabled={disabled} value={draft.assigneeId} onChange={event => change(task.id, { assigneeId: event.target.value })} className={field}><option value="">Unassigned</option>{draft.assigneeId && !people.some(person => person.id === draft.assigneeId) && <option value={draft.assigneeId}>{assigneeLabel(draft.assigneeId, people)}</option>}{people.map(person => <option key={person.id} value={person.id}>{personLabel(person)}{person.status === "archived" ? " (archived)" : ""}</option>)}</select></label>
        <label className="min-w-0 text-sm font-semibold">Status<select aria-label="Status" disabled={disabled} value={draft.status} onChange={event => change(task.id, { status: event.target.value as TaskDraft["status"] })} className={field}>{TASK_STATUSES.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>
        <label className="min-w-0 text-sm font-semibold">Due date<input type="date" disabled={disabled} value={draft.dueDate} onChange={event => change(task.id, { dueDate: event.target.value })} className={field}/></label>
        <label className="min-w-0 text-sm font-semibold">Estimated hours<input type="text" inputMode="decimal" disabled={disabled} value={draft.estimatedHours} onChange={event => change(task.id, { estimatedHours: event.target.value })} className={field}/></label>
        <label className="min-w-0 text-sm font-semibold sm:col-span-2">Description<textarea aria-label="Description" rows={4} disabled={disabled} value={draft.description} onChange={event => change(task.id, { description: event.target.value })} className={field}/></label>
        <div className="flex flex-wrap gap-2 sm:col-span-2"><button type="submit" disabled={disabled || !draft.title.trim()} className={`${button} bg-cyan-600 text-white`}>Save task</button><button type="button" disabled={disabled} onClick={() => setExpanded(null)} className={button}>Collapse task</button><button type="button" disabled={disabled} onClick={() => { setDrafts(current => ({ ...current, [task.id]: taskDraft(task) })); setFeedback(null); }} className={button}>Cancel / discard changes</button></div>
      </form>}
    </article>; })}
  </section>;
}
