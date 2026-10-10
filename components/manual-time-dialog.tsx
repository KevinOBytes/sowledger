"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Clock3, X } from "lucide-react";
import { toast } from "sonner";

type Project = { id: string; name: string };
type Action = { id: string; name: string; hourlyRate?: number | null };
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
};

type EditableTimeEntry = {
  id: string;
  taskId: string;
  projectId: string | null;
  action: string | null;
  tags: string[];
  description: string | null;
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds?: number | null;
};

type ManualTimeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void | Promise<void>;
  scheduledBlock?: ScheduledBlock | null;
  editEntry?: EditableTimeEntry | null;
  defaultTaskId?: string;
  defaultProjectId?: string;
  defaultDescription?: string;
};

function parts(date: Date) {
  return {
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
  };
}

function localDate(date: string, time: string) {
  return new Date(`${date}T${time}`);
}

function inputDate(date: string, time: string, original?: string | null) {
  if (original) {
    const originalParts = parts(new Date(original));
    if (date === originalParts.date && time === originalParts.time) return new Date(original);
  }
  return localDate(date, time);
}

const PRESERVE_ACTION_VALUE = "__preserve_current_action__";

export function ManualTimeDialog({ open, onOpenChange, onSaved, scheduledBlock, editEntry, defaultTaskId, defaultProjectId, defaultDescription }: ManualTimeDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [taskId, setTaskId] = useState(defaultTaskId || "General work");
  const [projectId, setProjectId] = useState(defaultProjectId || "");
  const [actionId, setActionId] = useState("");
  const [description, setDescription] = useState(defaultDescription || "");
  const [tags, setTags] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [optionsError, setOptionsError] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
      if (event.key !== "Tab") return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input, select, textarea, [tabindex='0']");
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, onOpenChange]);

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    const [projectData, actionData] = await Promise.all([
      fetch("/api/projects").then((res) => res.ok ? res.json() : null).catch(() => null),
      fetch("/api/user/actions").then((res) => res.ok ? res.json() : null).catch(() => null),
    ]);
    if (projectData) setProjects(projectData.projects ?? []);
    if (actionData) setActions(actionData.actions ?? []);
    setOptionsError(!projectData || !actionData);
    setOptionsLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOptions();
  }, [open, loadOptions]);

  useEffect(() => {
    if (!open) return;
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const start = editEntry ? new Date(editEntry.startedAt) : scheduledBlock ? new Date(scheduledBlock.startsAt) : oneHourAgo;
    const end = editEntry?.stoppedAt ? new Date(editEntry.stoppedAt) : scheduledBlock ? new Date(scheduledBlock.endsAt) : now;
    const startParts = parts(start);
    const endParts = parts(end);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTaskId(editEntry?.taskId || scheduledBlock?.taskId || defaultTaskId || "General work");
    setProjectId(editEntry ? editEntry.projectId ?? "" : scheduledBlock?.projectId || defaultProjectId || "");
    setActionId(editEntry?.action ? PRESERVE_ACTION_VALUE : scheduledBlock?.actionId || "");
    setDescription(editEntry ? editEntry.description ?? "" : scheduledBlock?.notes || scheduledBlock?.title || defaultDescription || "");
    setTags((editEntry?.tags ?? scheduledBlock?.tags ?? []).join(", "));
    setStartDate(startParts.date);
    setStartTime(startParts.time);
    setEndDate(endParts.date);
    setEndTime(endParts.time);
  }, [defaultDescription, defaultProjectId, defaultTaskId, editEntry, open, scheduledBlock]);

  const durationLabel = useMemo(() => {
    if (!startDate || !startTime || !endDate || !endTime) return "";
    const start = inputDate(startDate, startTime, editEntry?.startedAt);
    const end = inputDate(endDate, endTime, editEntry?.stoppedAt);
    const recordedBreaks = editEntry?.stoppedAt && editEntry.durationSeconds != null
      ? Math.max(0, Math.floor((new Date(editEntry.stoppedAt).getTime() - new Date(editEntry.startedAt).getTime()) / 1000) - editEntry.durationSeconds) : 0;
    const seconds = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000) - recordedBreaks);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }, [editEntry, endDate, endTime, startDate, startTime]);

  async function save() {
    if (!taskId.trim()) {
      toast.error("Work label is required.");
      return;
    }
    const startedAt = inputDate(startDate, startTime, editEntry?.startedAt);
    const stoppedAt = inputDate(endDate, endTime, editEntry?.stoppedAt);
    if (Number.isNaN(startedAt.getTime()) || Number.isNaN(stoppedAt.getTime()) || stoppedAt < startedAt || (!editEntry && stoppedAt <= startedAt)) {
      toast.error("Enter a valid time range.");
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        taskId: taskId.trim(),
        projectId: projectId || (editEntry ? null : undefined),
        description: description,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        startedAt: startedAt.toISOString(),
        stoppedAt: stoppedAt.toISOString(),
      };
      if (editEntry) {
        // Preserve sub-minute precision and paused duration for notes-only edits.
        if (startedAt.getTime() === new Date(editEntry.startedAt).getTime()) delete payload.startedAt;
        if (editEntry.stoppedAt && stoppedAt.getTime() === new Date(editEntry.stoppedAt).getTime()) delete payload.stoppedAt;
        if (actionId !== PRESERVE_ACTION_VALUE) payload.actionId = actionId;
      } else if (actionId || scheduledBlock) {
        // Explicitly clearing a scheduled rate must not inherit its previous value.
        payload.actionId = actionId;
      }
      if (scheduledBlock?.id) payload.scheduledBlockId = scheduledBlock.id;
      if (editEntry?.id) payload.entryId = editEntry.id;

      const response = await fetch(editEntry ? "/api/timer/edit" : "/api/timer/manual", {
        method: editEntry ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || (editEntry ? "Unable to correct time" : "Unable to log time"));
      toast.success(editEntry ? "Time entry updated" : "Time logged");
      onOpenChange(false);
      await onSaved?.();
      window.dispatchEvent(new CustomEvent("sowledger:time-saved"));
    } catch (error) {
      toast.error(editEntry ? "Could not correct time" : "Could not log time", { description: error instanceof Error ? error.message : "Check your connection and try again." });
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white text-slate-950 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex shrink-0 items-start justify-between border-b border-slate-200 px-4 py-3 sm:px-6 sm:py-5">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-cyan-700">
              <Clock3 className="h-4 w-4" /> {editEntry ? "Correct logged time" : "Log time manually"}
            </div>
            <h2 id={titleId} className="mt-1 text-2xl font-semibold tracking-tight">{editEntry ? "Edit completed work" : "Add completed work"}</h2>
            <p className="mt-1 text-sm text-slate-500">{editEntry ? "Update the details before this time is approved or invoiced." : "Add work you finished without a timer."}</p>
          </div>
          <button onClick={() => onOpenChange(false)} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Close manual time dialog">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid min-h-0 gap-4 overflow-y-auto overscroll-contain px-4 py-4 sm:grid-cols-2 sm:px-6 sm:py-5">
          {optionsError && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2">Could not load projects and work types. Your entry details are unchanged. <button type="button" disabled={optionsLoading} onClick={() => void loadOptions()} className="font-semibold underline">{optionsLoading ? "Retrying..." : "Retry choices"}</button></p>}
          <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">
            Work label
            <input value={taskId} onChange={(e) => setTaskId(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" placeholder="Client call, research review, design QA" />
          </label>

          <label className="space-y-1 text-sm font-medium text-slate-700">
            Project
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white">
              <option value="">No project</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>

          <label className="space-y-1 text-sm font-medium text-slate-700">
            Work type / rate
            <select value={actionId} onChange={(e) => setActionId(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white">
              {editEntry?.action && actionId === PRESERVE_ACTION_VALUE ? <option value={PRESERVE_ACTION_VALUE}>Keep current: {editEntry.action}</option> : null}
              <option value="">No work type rate</option>
              {actions.map((action) => <option key={action.id} value={action.id}>{action.name}{action.hourlyRate ? ` ($${action.hourlyRate}/hr)` : ""}</option>)}
            </select>
          </label>

          <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">
            Notes
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" placeholder="What was completed?" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm font-medium text-slate-700">Start date<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none" /></label>
            <label className="space-y-1 text-sm font-medium text-slate-700">Start time<input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none" /></label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm font-medium text-slate-700">End date<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none" /></label>
            <label className="space-y-1 text-sm font-medium text-slate-700">End time<input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none" /></label>
          </div>

          <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">
            Tags
            <input value={tags} onChange={(e) => setTags(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" placeholder="research, client-call" />
          </label>
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
          <span className="text-sm text-slate-500">Duration: <span className="font-semibold text-slate-900">{durationLabel || "Set a range"}</span></span>
          <div className="flex gap-2">
            <button onClick={() => onOpenChange(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white">Cancel</button>
            <button onClick={save} disabled={saving} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">{saving ? "Saving..." : editEntry ? "Save correction" : "Log time"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
