"use client";

import { useEffect, useMemo, useState } from "react";
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

type ManualTimeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void | Promise<void>;
  scheduledBlock?: ScheduledBlock | null;
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

export function ManualTimeDialog({ open, onOpenChange, onSaved, scheduledBlock, defaultTaskId, defaultProjectId, defaultDescription }: ManualTimeDialogProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [taskId, setTaskId] = useState(defaultTaskId || "manual-entry");
  const [projectId, setProjectId] = useState(defaultProjectId || "");
  const [actionId, setActionId] = useState("");
  const [description, setDescription] = useState(defaultDescription || "");
  const [tags, setTags] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      fetch("/api/projects").then((res) => res.ok ? res.json() : null).catch(() => null),
      fetch("/api/user/actions").then((res) => res.ok ? res.json() : null).catch(() => null),
    ]).then(([projectData, actionData]) => {
      setProjects(projectData?.projects ?? []);
      setActions(actionData?.actions ?? []);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const start = scheduledBlock ? new Date(scheduledBlock.startsAt) : oneHourAgo;
    const end = scheduledBlock ? new Date(scheduledBlock.endsAt) : now;
    const startParts = parts(start);
    const endParts = parts(end);

    setTaskId(scheduledBlock?.taskId || defaultTaskId || "manual-entry");
    setProjectId(scheduledBlock?.projectId || defaultProjectId || "");
    setActionId(scheduledBlock?.actionId || "");
    setDescription(scheduledBlock?.notes || scheduledBlock?.title || defaultDescription || "");
    setTags((scheduledBlock?.tags ?? []).join(", "));
    setStartDate(startParts.date);
    setStartTime(startParts.time);
    setEndDate(endParts.date);
    setEndTime(endParts.time);
  }, [defaultDescription, defaultProjectId, defaultTaskId, open, scheduledBlock]);

  const durationLabel = useMemo(() => {
    if (!startDate || !startTime || !endDate || !endTime) return "";
    const seconds = Math.max(0, Math.floor((localDate(endDate, endTime).getTime() - localDate(startDate, startTime).getTime()) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }, [endDate, endTime, startDate, startTime]);

  async function save() {
    if (!taskId.trim()) {
      toast.error("Task reference is required.");
      return;
    }
    const startedAt = localDate(startDate, startTime);
    const stoppedAt = localDate(endDate, endTime);
    if (Number.isNaN(startedAt.getTime()) || Number.isNaN(stoppedAt.getTime()) || stoppedAt <= startedAt) {
      toast.error("Enter a valid time range.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/timer/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: taskId.trim(),
          projectId: projectId || undefined,
          actionId: actionId || undefined,
          description: description || undefined,
          tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          startedAt: startedAt.toISOString(),
          stoppedAt: stoppedAt.toISOString(),
          scheduledBlockId: scheduledBlock?.id,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to log time");
      toast.success("Manual time logged");
      onOpenChange(false);
      await onSaved?.();
      window.dispatchEvent(new CustomEvent("billabled:time-saved"));
    } catch (error) {
      toast.error("Could not log time", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl text-slate-950">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-cyan-700">
              <Clock3 className="h-4 w-4" /> Log time manually
            </div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Add a non-timer work block</h2>
            <p className="mt-1 text-sm text-slate-500">Use this for work you completed without starting a live timer.</p>
          </div>
          <button onClick={() => onOpenChange(false)} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Close manual time dialog">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">
            Work reference
            <input value={taskId} onChange={(e) => setTaskId(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" placeholder="TASK-123 or short work label" />
          </label>

          <label className="space-y-1 text-sm font-medium text-slate-700">
            Project
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white">
              <option value="">No project</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>

          <label className="space-y-1 text-sm font-medium text-slate-700">
            Action / rate
            <select value={actionId} onChange={(e) => setActionId(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white">
              <option value="">No action rate</option>
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

        <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-slate-500">Duration: <span className="font-semibold text-slate-900">{durationLabel || "Set a range"}</span></span>
          <div className="flex gap-2">
            <button onClick={() => onOpenChange(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white">Cancel</button>
            <button onClick={save} disabled={saving} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">{saving ? "Saving..." : "Log time"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
