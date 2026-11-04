"use client";

import { useEffect, useRef, useState, type DragEvent, type FocusEvent, type PointerEvent } from "react";
import { Plus, GripVertical, CheckCircle2, Circle, Lock, Paperclip, Trash2, X } from "lucide-react";
import { ModalDialog } from "@/components/modal-dialog";
import { assigneeLabel, draftPatch, hasIncompleteBlocker, mergeTaskDraft, personLabel, readDeletedTask, readPeople, readSavedTask, readTasks, safeAttachmentUrl, taskDraft, TASK_STATUSES, unsavedPatch, type TaskDraft, type TaskPatch, type TaskPerson, type TaskRecord } from "@/lib/task-client-state";

export function KanbanBoard({ projectId }: { projectId: string }) { return <Board key={projectId} projectId={projectId}/>; }

function Board({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [people, setPeople] = useState<TaskPerson[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [loaded, setLoaded] = useState(false);
  const [dragged, setDragged] = useState<string | null>(null);
  const [adding, setAdding] = useState<TaskDraft["status"] | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, TaskDraft>>({});
  const [assets, setAssets] = useState<Record<string, { name: string; url: string }>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const [failedDrafts, setFailedDrafts] = useState<Record<string, string>>({});
  const alive = useRef(false); const generation = useRef(0); const lock = useRef(false);
  const opener = useRef<HTMLElement | null>(null); const titleRef = useRef<HTMLInputElement>(null); const alertRef = useRef<HTMLDivElement>(null);
  const taskOpeners = useRef(new Map<string, HTMLButtonElement>());
  const returnTaskId = useRef<string | null>(null);
  const refreshRef = useRef<HTMLButtonElement>(null);
  const discardRef = useRef<HTMLButtonElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const discardPointer = useRef(false);

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
  useEffect(() => {
    if (selected === null && returnTaskId.current) {
      (taskOpeners.current.get(returnTaskId.current) ?? refreshRef.current)?.focus({ preventScroll: true });
      returnTaskId.current = null;
    }
  }, [selected]);
  const disabled = pending !== null || loadState !== "ready";
  const task = tasks.find(task => task.id === selected);
  const draft = selected ? drafts[selected] : undefined;
  let dirty = false;
  if (task && draft) {
    try { dirty = Object.keys(unsavedPatch(draft, task)).length > 0; }
    catch { dirty = true; } // Invalid inputs remain editable; validate on save, not render.
  }
  const retryFailedDraft = Boolean(task && draft && failedDrafts[task.id] === JSON.stringify(draft));
  const asset = selected ? assets[selected] ?? { name: "", url: "" } : { name: "", url: "" };

  async function mutate(kind: string, action: (isCurrent: () => boolean) => Promise<void>, failure: string) {
    if (lock.current || loadState !== "ready") return false;
    lock.current = true; const request = ++generation.current; setPending(kind); setFeedback(null);
    try { await action(() => alive.current && generation.current === request); return alive.current && generation.current === request; }
    catch { if (alive.current && generation.current === request) setFeedback({ error: true, text: failure }); return false; }
    finally { if (alive.current && generation.current === request) { lock.current = false; setPending(null); } }
  }
  async function createTask(status: TaskDraft["status"]) {
    if (lock.current || !newTitle.trim() || newTitle.trim().length > 255) return;
    const values = { title: newTitle.trim(), status, assigneeId: newAssignee || null };
    await mutate("create", async isCurrent => {
      const response = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, ...values }) });
      if (!response.ok) throw new Error("Create failed");
      const saved = readSavedTask(await response.json(), projectId, null, values);
      if (!isCurrent()) return;
      if (tasks.some(task => task.id === saved.id)) throw new Error("Duplicate response");
      setTasks(current => [...current, saved]); setAdding(null); setNewTitle(""); setNewAssignee(""); setFeedback({ error: false, text: "Task created." });
    }, "Could not confirm task creation. Your draft is kept. Check existing tasks before retrying to avoid duplicates.");
  }
  async function patchTask(id: string, values: TaskPatch, attemptedDraft?: TaskDraft) {
    if (lock.current || loadState !== "ready" || !Object.keys(values).length) return false;
    const before = tasks.find(task => task.id === id);
    if (!before) return false;
    if ((values.status === "review" || values.status === "done") && hasIncompleteBlocker(before, tasks)) { setFeedback({ error: true, text: "Finish the incomplete blockers shown here before moving this task to Review or Done." }); return false; }
    const saved = await mutate(id, async isCurrent => {
      const response = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: id, ...values }) });
      if (!response.ok) throw new Error("Save failed");
      const saved = readSavedTask(await response.json(), projectId, id, values);
      if (!isCurrent()) return;
      setTasks(current => current.map(task => task.id === id ? saved : task));
      setDrafts(current => current[id] ? { ...current, [id]: mergeTaskDraft(current[id], before, saved, values) } : current);
      setFeedback({ error: false, text: "Task saved." });
    }, "Could not confirm the task save. Your changes are kept; retry unsaved changes or try the action again.");
    if (attemptedDraft && alive.current) setFailedDrafts(current => ({ ...current, [id]: saved ? "" : JSON.stringify(attemptedDraft) }));
    return saved;
  }
  function change(id: string, values: Partial<TaskDraft>) { if (!lock.current) setDrafts(current => ({ ...current, [id]: { ...current[id], ...values } })); }
  function autosave(key: keyof TaskDraft, value: string) {
    if (!task || !draft || lock.current) return;
    change(task.id, { [key]: value });
    try {
      // Validate this field independently, so an earlier invalid/failed draft is not erased.
      const canonical = draftPatch({ ...taskDraft(task), [key]: value });
      const old = draftPatch(taskDraft(task));
      if (canonical[key] !== old[key]) void patchTask(task.id, { [key]: canonical[key] }, { ...draft, [key]: value });
    } catch (error) { setFeedback({ error: true, text: (error as Error).message }); }
  }
  function saveOnBlur(key: keyof TaskDraft, event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
    // Direct keyboard/assistive-control navigation to Discard must not commit the field first.
    if (discardPointer.current || event.relatedTarget === discardRef.current || event.relatedTarget === saveRef.current) return;
    autosave(key, event.currentTarget.value);
  }
  function discardChanges() {
    discardPointer.current = false;
    if (!task || lock.current || loadState !== "ready") return;
    setDrafts(current => ({ ...current, [task.id]: taskDraft(task) }));
    setAssets(current => ({ ...current, [task.id]: { name: "", url: "" } }));
    setFeedback(null);
    setFailedDrafts(current => ({ ...current, [task.id]: "" }));
  }
  function beginDiscardPointer(event: PointerEvent<HTMLButtonElement>) {
    if (disabled || event.button !== 0) return;
    discardPointer.current = event.pointerType !== "mouse";
    // Retain mouse focus until click; canceling touch pointerdown suppresses WebKit's tap click.
    if (event.pointerType === "mouse") event.preventDefault();
  }
  function endDiscardPointer(event: PointerEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.pointerType === "mouse" || event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom) discardPointer.current = false;
  }
  async function retryDraft() {
    if (!task || !draft || lock.current) return;
    // Explicit activation owns this save, including assistive/programmatic clicks.
    // Move focus first so later failure feedback cannot trigger a second blur save.
    saveRef.current?.focus();
    try { await patchTask(task.id, unsavedPatch(draft, task), draft); }
    catch (error) { setFeedback({ error: true, text: (error as Error).message }); }
  }
  async function deleteTask(id: string) {
    await mutate(`delete:${id}`, async isCurrent => {
      const response = await fetch(`/api/tasks?taskId=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete failed"); readDeletedTask(await response.json(), id);
      if (!isCurrent()) return;
      setTasks(current => current.filter(task => task.id !== id && task.parentId !== id)); setFeedback({ error: false, text: "Task deleted." });
    }, "Could not confirm task deletion. The task is still shown; refresh or try again.");
  }
  async function attachAsset() {
    if (!task || lock.current || !asset.name.trim() || !safeAttachmentUrl(asset.url.trim())) return;
    const id = task.id;
    if (await patchTask(id, { attachments: [...(task.attachments ?? []), { name: asset.name.trim(), url: asset.url.trim() }] })) setAssets(current => ({ ...current, [id]: { name: "", url: "" } }));
  }
  function closeTask() { if (!lock.current) { discardPointer.current = false; returnTaskId.current = selected; setSelected(null); } }
  function drop(event: DragEvent, status: TaskDraft["status"]) {
    event.preventDefault(); const id = dragged; setDragged(null);
    if (id && !lock.current && tasks.find(task => task.id === id)?.status !== status) void patchTask(id, { status });
  }
  const button = "rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold disabled:opacity-50";
  const field = "mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-cyan-500 disabled:opacity-60";
  const notice = <>
    {feedback && <div ref={alertRef} tabIndex={-1} role={feedback.error ? "alert" : "status"}
      className="break-words rounded-xl border border-slate-200 bg-white p-3 text-sm">{feedback.text}</div>}
    {pending && <p role="status" className="text-sm">
      {pending === "create" ? "Creating task…" : pending.startsWith("delete:") ? "Deleting task…" : "Saving task…"}
    </p>}
  </>;
  return <section className="min-w-0 max-w-full space-y-4 text-slate-700" aria-label="Task board">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold text-slate-950">Tasks</h2><p className="text-sm text-slate-500">Add work and set a due date.</p></div><button ref={refreshRef} type="button" disabled={disabled} onClick={refresh} className={button}>Refresh tasks</button></header>
    {loadState === "loading" && <p role="status">Loading tasks…</p>}
    {loadState === "failed" && <div role="alert" className="rounded-2xl border border-rose-200 bg-white p-4"><p>Could not load tasks and assignees. {loaded ? "Previously loaded tasks are still shown; refresh before making changes." : "Try loading again before making changes."}</p><button type="button" onClick={refresh} className={`${button} mt-2`}>Retry loading tasks</button></div>}
    {!selected && notice}
    <div className="flex max-w-full gap-4 overflow-x-auto pb-4" aria-label="Task columns">
      {TASK_STATUSES.map(column => {
        const columnTasks = tasks
          .filter(task => task.status === column.value && !task.parentId)
          .sort((a, b) => a.position - b.position);
        return <section key={column.value} aria-label={column.label}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
          onDrop={event => drop(event, column.value)}
          className="flex w-72 shrink-0 flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <header className="flex items-center justify-between gap-2"><h3 className="font-semibold">{column.label} <span className="text-sm text-slate-500">{columnTasks.length}</span></h3><button type="button" aria-label={`Add task to ${column.label}`} disabled={disabled} onClick={() => setAdding(column.value)} className="rounded-xl p-2 text-cyan-700 disabled:opacity-50"><Plus className="h-5 w-5"/></button></header>
        {loaded && columnTasks.length === 0 && <p className="text-sm text-slate-500">Use + to add a task.</p>}
        {columnTasks.map(item => <article key={item.id} draggable={!disabled}
          onDragStart={event => {
            if (lock.current) { event.preventDefault(); return; }
            setDragged(item.id);
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => setDragged(null)}
          className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm ${dragged === item.id ? "opacity-60" : ""}`}>
          <div className="flex items-start gap-2">
            <button ref={element => {
              if (element) taskOpeners.current.set(item.id, element);
              else taskOpeners.current.delete(item.id);
            }} type="button" aria-label={`Open task: ${item.title}`} disabled={pending !== null}
              onClick={event => {
                if (lock.current) return;
                opener.current = event.currentTarget;
                setSelected(item.id);
                setDrafts(current => current[item.id] ? current : { ...current, [item.id]: taskDraft(item) });
              }}
              className="min-w-0 flex-1 text-left font-semibold text-slate-950 disabled:opacity-50">
              <span className="block break-words">{item.title}</span>
            </button>
            <button type="button" aria-label={`Delete task: ${item.title}`} disabled={disabled}
              onClick={event => { event.stopPropagation(); void deleteTask(item.id); }}
              className="shrink-0 rounded-lg p-2 text-slate-500 hover:text-rose-700 disabled:opacity-50"><Trash2 className="h-4 w-4"/></button>
          </div>
          {item.description && <p className="mt-2 line-clamp-2 break-words text-sm text-slate-500" title={item.description}>{item.description}</p>}
          <p className="mt-3 break-words text-sm text-slate-500">{assigneeLabel(item.assigneeId, people)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 text-xs text-slate-500"><GripVertical className="h-4 w-4"/><span>{item.estimatedHours === null ? "No estimate" : `${item.estimatedHours}h`}</span>{hasIncompleteBlocker(item, tasks) && <Lock aria-label="Incomplete blockers in current view" className="h-4 w-4"/>}{!!item.attachments?.length && <span className="inline-flex items-center gap-1"><Paperclip className="h-3 w-3"/>{item.attachments.length}</span>}{item.status === "done" ? <CheckCircle2 className="ml-auto h-4 w-4 text-cyan-600"/> : <Circle className="ml-auto h-4 w-4"/>}</div>
        </article>)}
        {adding === column.value && <form onSubmit={event => { event.preventDefault(); void createTask(column.value); }} className="min-w-0 space-y-3 rounded-2xl border border-cyan-200 p-3">
          <label className="block text-sm font-semibold">New task title
            <input autoFocus maxLength={255} required disabled={disabled} value={newTitle}
              onChange={event => setNewTitle(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") { event.preventDefault(); void createTask(column.value); }
                if (event.key === "Escape" && !lock.current) setAdding(null);
              }} className={field}/>
          </label>
          <label className="block text-sm font-semibold">New task assignee<select aria-label="New task assignee" disabled={disabled} value={newAssignee} onChange={event => setNewAssignee(event.target.value)} className={field}><option value="">Unassigned</option>{people.filter(person => person.status !== "archived").map(person => <option key={person.id} value={person.id}>{personLabel(person)}</option>)}</select></label>
          <div className="flex flex-wrap gap-2"><button type="submit" disabled={disabled || !newTitle.trim()} className={`${button} bg-cyan-600 text-white`}>Add task</button><button type="button" disabled={disabled} onClick={() => { setAdding(null); setNewTitle(""); setNewAssignee(""); }} className={button}>Cancel new task</button></div>
        </form>}
      </section>; })}
    </div>
    {task && draft && <ModalDialog label={`Task details: ${task.title}`} onClose={closeTask} initialFocusRef={titleRef} returnFocusRef={opener} className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl rounded-3xl border border-slate-200 bg-white text-slate-700 shadow-xl backdrop:bg-slate-950/40">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 p-4"><h2 className="min-w-0 break-words text-lg font-semibold text-slate-950">Task details</h2><button type="button" aria-label="Close task details" disabled={disabled} onClick={closeTask} className="rounded-xl p-2 disabled:opacity-50"><X className="h-5 w-5"/></button></header>
      <div className="min-h-0 space-y-5 overflow-y-auto p-4">
        {notice}
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="min-w-0 text-sm font-semibold sm:col-span-2">Title<input ref={titleRef} maxLength={255} required disabled={disabled} value={draft.title} onChange={event => change(task.id, { title: event.target.value })} onBlur={event => saveOnBlur("title", event)} className={field}/></label>
          <label className="min-w-0 text-sm font-semibold">Status<select aria-label="Status" disabled={disabled} value={draft.status} onChange={event => autosave("status", event.target.value)} className={field}>{TASK_STATUSES.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>
          <label className="min-w-0 text-sm font-semibold">Estimated hours<input type="text" inputMode="decimal" disabled={disabled} value={draft.estimatedHours} onChange={event => change(task.id, { estimatedHours: event.target.value })} onBlur={event => saveOnBlur("estimatedHours", event)} className={field}/></label>
          <label className="min-w-0 text-sm font-semibold">Assigned person<select aria-label="Assigned person" disabled={disabled} value={draft.assigneeId} onChange={event => autosave("assigneeId", event.target.value)} className={field}><option value="">Unassigned</option>{draft.assigneeId && !people.some(person => person.id === draft.assigneeId) && <option value={draft.assigneeId}>{assigneeLabel(draft.assigneeId, people)}</option>}{people.map(person => <option key={person.id} value={person.id}>{personLabel(person)}{person.status === "archived" ? " (archived)" : ""}</option>)}</select></label>
          <label className="min-w-0 text-sm font-semibold">Due date<input type="date" disabled={disabled} value={draft.dueDate} onChange={event => autosave("dueDate", event.target.value)} className={field}/></label>
          <label className="min-w-0 text-sm font-semibold sm:col-span-2">Description<textarea aria-label="Description" rows={4} disabled={disabled} value={draft.description} onChange={event => change(task.id, { description: event.target.value })} onBlur={event => saveOnBlur("description", event)} className={field}/></label>
        </div>
        <section className="min-w-0 space-y-3 border-t border-slate-200 pt-4"><h3 className="font-semibold">Attachments</h3>
          {!task.attachments?.length && <p className="text-sm text-slate-500">No attachments yet. Add a name and public link below.</p>}
          {task.attachments?.map((attachment, index) => <div key={index} className="flex min-w-0 items-start gap-2 rounded-xl border border-slate-200 p-3"><div className="min-w-0 flex-1 break-words"><p className="text-sm font-semibold">{attachment.name}</p>{safeAttachmentUrl(attachment.url) ? <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-cyan-700">{attachment.url}</a> : <p className="break-all text-sm text-slate-500">Unavailable link: {attachment.url}</p>}</div><button type="button" aria-label={`Remove attachment: ${attachment.name}`} disabled={disabled} onClick={() => void patchTask(task.id, { attachments: task.attachments!.filter((_, i) => i !== index) })} className="shrink-0 rounded-lg p-2 text-slate-500 disabled:opacity-50"><X className="h-4 w-4"/></button></div>)}
          <div className="grid min-w-0 gap-3 sm:grid-cols-2"><label className="min-w-0 text-sm font-semibold">Asset name<input disabled={disabled} value={asset.name} onChange={event => setAssets(current => ({ ...current, [task.id]: { ...asset, name: event.target.value } }))} className={field}/></label><label className="min-w-0 text-sm font-semibold">Public URL<input type="url" disabled={disabled} value={asset.url} onChange={event => setAssets(current => ({ ...current, [task.id]: { ...asset, url: event.target.value } }))} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void attachAsset(); } }} className={field}/></label><button type="button" disabled={disabled || !asset.name.trim() || !safeAttachmentUrl(asset.url.trim())} onClick={() => void attachAsset()} className={`${button} justify-self-start bg-cyan-600 text-white sm:col-span-2`}>Attach Asset</button></div>
        </section>
      </div>
      <footer className="flex shrink-0 flex-wrap gap-2 border-t border-slate-200 bg-white p-4"><button ref={saveRef} type="button" disabled={disabled || !dirty} onPointerDown={event => { if (event.button === 0) event.currentTarget.focus(); }} onClick={() => void retryDraft()} className={`${button} bg-cyan-600 text-white`}>{pending === task.id ? "Saving…" : !dirty ? "Saved" : retryFailedDraft ? "Retry unsaved changes" : "Save changes"}</button><button ref={discardRef} type="button" disabled={disabled} onPointerDown={beginDiscardPointer} onPointerUp={endDiscardPointer} onPointerCancel={() => { discardPointer.current = false; }} onClick={discardChanges} className={button}>Cancel / discard changes</button><button type="button" disabled={disabled} onClick={closeTask} className={button}>Close task details</button></footer>
    </ModalDialog>}
  </section>;
}
