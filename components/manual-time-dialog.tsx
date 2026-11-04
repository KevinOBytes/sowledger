"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { Clock3, X } from "lucide-react";
import { toast } from "sonner";
import { ModalDialog } from "@/components/modal-dialog";
import { localDateTimeValue, parseLocalDateTime } from "@/lib/date-input";

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
  returnFocusRef?: RefObject<HTMLElement | null>;
};

function parts(date: Date) {
  const [dateValue, timeValue] = localDateTimeValue(date).split("T");
  return {
    date: dateValue,
    time: timeValue,
  };
}

const PRESERVE_ACTION_VALUE = "__preserve_current_action__";

export function ManualTimeDialog({ open, onOpenChange, onSaved, scheduledBlock, editEntry, defaultTaskId, defaultProjectId, defaultDescription, returnFocusRef }: ManualTimeDialogProps) {
  const titleId = useId();
  const timezoneId = useId();
  const workLabelRef = useRef<HTMLInputElement>(null);
  const fallbackOpenerRef = useRef<HTMLElement | null>(null);
  const initializedEntryRef = useRef<string | null>(null);
  const savingRef = useRef(false);
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
  const [saveError, setSaveError] = useState("");
  const [optionsError, setOptionsError] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);

  useEffect(() => {
    if (open || returnFocusRef) return;
    // Existing callers may not pass an opener. Pointer capture also works in
    // Safari, where clicking a button need not make it document.activeElement.
    function rememberOpener(event: Event) {
      if (!(event.target instanceof Element) || event.target.closest("dialog[open]")) return;
      const control = event.target.closest<HTMLElement>("button, a[href], input, select, textarea, [tabindex]");
      if (control) fallbackOpenerRef.current = control;
    }
    document.addEventListener("pointerdown", rememberOpener, true);
    document.addEventListener("focusin", rememberOpener, true);
    return () => {
      document.removeEventListener("pointerdown", rememberOpener, true);
      document.removeEventListener("focusin", rememberOpener, true);
    };
  }, [open, returnFocusRef]);

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
    if (!open) {
      initializedEntryRef.current = null;
      return;
    }
    const entryKey = editEntry ? `edit:${editEntry.id}` : scheduledBlock ? `schedule:${scheduledBlock.id}` : "new";
    if (initializedEntryRef.current === entryKey) return;
    initializedEntryRef.current = entryKey;
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const start = editEntry ? new Date(editEntry.startedAt) : scheduledBlock ? new Date(scheduledBlock.startsAt) : oneHourAgo;
    const end = editEntry?.stoppedAt ? new Date(editEntry.stoppedAt) : scheduledBlock ? new Date(scheduledBlock.endsAt) : now;
    const startParts = parts(start);
    const endParts = parts(end);

    setTaskId(editEntry?.taskId || scheduledBlock?.taskId || defaultTaskId || "General work");
    setProjectId(editEntry ? editEntry.projectId ?? "" : scheduledBlock?.projectId || defaultProjectId || "");
    setActionId(editEntry?.action ? PRESERVE_ACTION_VALUE : scheduledBlock?.actionId || "");
    setDescription(editEntry ? editEntry.description ?? "" : scheduledBlock?.notes || scheduledBlock?.title || defaultDescription || "");
    setTags((editEntry?.tags ?? scheduledBlock?.tags ?? []).join(", "));
    setStartDate(startParts.date);
    setStartTime(startParts.time);
    setEndDate(endParts.date);
    setEndTime(endParts.time);
    setSaveError("");
  }, [defaultDescription, defaultProjectId, defaultTaskId, editEntry, open, scheduledBlock]);

  const originalStart = editEntry?.startedAt ?? scheduledBlock?.startsAt;
  const originalEnd = editEntry?.stoppedAt ?? scheduledBlock?.endsAt;
  const durationLabel = useMemo(() => {
    if (!startDate || !startTime || !endDate || !endTime) return "";
    try {
      const start = parseLocalDateTime(`${startDate}T${startTime}`, originalStart);
      const end = parseLocalDateTime(`${endDate}T${endTime}`, originalEnd);
      const recordedBreaks = editEntry?.stoppedAt && editEntry.durationSeconds != null
        ? Math.max(0, Math.floor((new Date(editEntry.stoppedAt).getTime() - new Date(editEntry.startedAt).getTime()) / 1000) - editEntry.durationSeconds) : 0;
      const seconds = Math.floor((end.getTime() - start.getTime()) / 1000) - recordedBreaks;
      if (seconds < 0) return "";
      return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    } catch {
      return "";
    }
  }, [editEntry, endDate, endTime, originalEnd, originalStart, startDate, startTime]);

  function close() {
    if (!savingRef.current) onOpenChange(false);
  }

  async function save() {
    if (savingRef.current) return;
    setSaveError("");
    if (!taskId.trim()) {
      setSaveError("Work label is required.");
      workLabelRef.current?.focus();
      return;
    }
    let startedAt: Date;
    let stoppedAt: Date;
    try {
      startedAt = parseLocalDateTime(`${startDate}T${startTime}`, originalStart);
      stoppedAt = parseLocalDateTime(`${endDate}T${endTime}`, originalEnd);
      if (stoppedAt < startedAt || (!editEntry && stoppedAt <= startedAt)) throw new Error("Choose an end time after the start time.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Enter a valid time range.");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    let confirmed = false;
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
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status >= 500 || response.status === 408) throw new Error("We couldn't confirm the save. Check Activity before retrying so you don't log this work twice. Your details are still here.");
        throw new Error(data?.error || "Your time could not be saved. Please try again.");
      }
      if (data?.ok !== true) throw new Error("We couldn't confirm the save. Check Activity before retrying so you don't log this work twice.");
      confirmed = true;
    } catch (error) {
      setSaveError(error instanceof TypeError
        ? "The connection was interrupted. Check Activity before retrying so you don't log this work twice. Your details are still here."
        : error instanceof Error ? error.message : "We couldn't confirm the save. Your details are still here; check Activity before retrying.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    if (!confirmed) return;
    toast.success(editEntry ? "Time entry updated" : "Time logged");
    onOpenChange(false);
    window.dispatchEvent(new CustomEvent("sowledger:time-saved"));
    try {
      await onSaved?.();
    } catch {
      toast.warning("Time was saved, but the list couldn't refresh. Reload the page to see it.");
    }
  }

  if (!open) return null;

  return (
    <ModalDialog
      onClose={close}
      labelledBy={titleId}
      initialFocusRef={workLabelRef}
      returnFocusRef={returnFocusRef ?? fallbackOpenerRef}
      className="inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl rounded-[28px] border border-slate-200 bg-white text-slate-950 shadow-2xl backdrop:bg-slate-950/55 backdrop:backdrop-blur-sm"
    >
      <form noValidate aria-busy={saving} onSubmit={(event) => { event.preventDefault(); void save(); }} className="flex min-h-0 flex-col">
        <div className="flex shrink-0 items-start justify-between border-b border-slate-200 px-4 py-3 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-cyan-700">
              <Clock3 className="h-4 w-4" /> {editEntry ? "Correct logged time" : "Log time manually"}
            </div>
            <h2 id={titleId} className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{editEntry ? "Edit completed work" : "Add completed work"}</h2>
            <p className="mt-1 text-sm text-slate-500">{editEntry ? "Update the details before this time is approved or invoiced." : "Add work you finished without a timer."}</p>
          </div>
          <button type="button" onClick={close} disabled={saving} className="shrink-0 rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50" aria-label="Close manual time dialog">
            <X className="h-5 w-5" />
          </button>
        </div>

        <fieldset disabled={saving} className="grid min-h-0 min-w-0 gap-4 overflow-y-auto overscroll-contain px-4 py-4 sm:grid-cols-2 sm:px-6 sm:py-5">
          {optionsError && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2">Could not load projects and work types. Your entry details are unchanged. <button type="button" disabled={optionsLoading} onClick={() => void loadOptions()} className="font-semibold underline">{optionsLoading ? "Retrying..." : "Retry choices"}</button></p>}
          <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">
            Work label
            <input ref={workLabelRef} value={taskId} maxLength={255} onChange={(e) => setTaskId(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" placeholder="Client call, research review, design QA" />
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
              {actions.map((action) => <option key={action.id} value={action.id}>{action.name}{action.hourlyRate != null ? ` ($${action.hourlyRate}/hr)` : ""}</option>)}
            </select>
          </label>

          <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">
            Notes
            <input value={description} maxLength={10000} onChange={(e) => setDescription(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" placeholder="What was completed?" />
          </label>

          <div className="grid min-w-0 grid-cols-2 gap-3">
            <label className="min-w-0 space-y-1 text-sm font-medium text-slate-700">Start date<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-describedby={timezoneId} className="h-11 min-w-0 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none" /></label>
            <label className="min-w-0 space-y-1 text-sm font-medium text-slate-700">Start time<input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} aria-describedby={timezoneId} className="h-11 min-w-0 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none" /></label>
          </div>

          <div className="grid min-w-0 grid-cols-2 gap-3">
            <label className="min-w-0 space-y-1 text-sm font-medium text-slate-700">End date<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-describedby={timezoneId} className="h-11 min-w-0 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none" /></label>
            <label className="min-w-0 space-y-1 text-sm font-medium text-slate-700">End time<input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} aria-describedby={timezoneId} className="h-11 min-w-0 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none" /></label>
          </div>

          <p id={timezoneId} className="text-xs leading-5 text-slate-500 sm:col-span-2">Times use your device timezone: <span className="font-medium">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>. When clocks repeat an hour, new times use the first occurrence. Unchanged saved times keep their original offset.</p>

          <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">
            Tags
            <input value={tags} onChange={(e) => setTags(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" placeholder="research, client-call" />
          </label>
        </fieldset>

        <div className="shrink-0 space-y-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-6 sm:py-5">
          {saveError && <p role="alert" className="max-h-24 overflow-y-auto rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{saveError}</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-slate-500">Duration: <span className="font-semibold text-slate-900">{durationLabel || "Set a range"}</span></span>
            <div className="flex gap-2">
              <button type="button" onClick={close} disabled={saving} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">{saving ? "Saving..." : editEntry ? "Save correction" : "Log time"}</button>
            </div>
          </div>
        </div>
      </form>
    </ModalDialog>
  );
}
