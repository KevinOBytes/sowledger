"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  GripVertical,
  LayoutGrid,
  Pencil,
  Play,
  Plus,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

type TimeEntry = {
  id: string;
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number | null;
  taskId?: string;
  projectId?: string | null;
  source: "web" | "calendar" | "manual";
};

type Project = { id: string; name: string };

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
  status: "planned" | "in_progress" | "completed" | "skipped" | "canceled";
};

type ComposerMode = "scheduled" | "calendar";
type ViewMode = "week" | "month";

type OpenComposerOptions = {
  mode?: ComposerMode;
  dateStr?: string;
  startAt?: Date;
  endAt?: Date;
  block?: ScheduledBlock | null;
};

type CalendarDraft =
  | {
      kind: "selection";
      startsAt: Date;
      endsAt: Date;
      x: number;
      y: number;
    }
  | {
      kind: "move";
      block: ScheduledBlock;
      startsAt: Date;
      endsAt: Date;
      x: number;
      y: number;
    };

type DragState =
  | {
      kind: "selection";
      day: Date;
      columnTop: number;
      startMinute: number;
      currentMinute: number;
      x: number;
      y: number;
    }
  | {
      kind: "move";
      block: ScheduledBlock;
      columnTop: number;
      dayKey: string;
      durationMinutes: number;
      grabOffsetMinutes: number;
      currentStartMinute: number;
      x: number;
      y: number;
    };

const DAY_START_HOUR = 5;
const DAY_END_HOUR = 24;
const DAY_START_MINUTES = DAY_START_HOUR * 60;
const DAY_END_MINUTES = DAY_END_HOUR * 60;
const SLOT_MINUTES = 15;
const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, index) => index + DAY_START_HOUR);
const HOUR_HEIGHT = 72;

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localInput(date: Date) {
  return `${dateKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatHours(seconds: number) {
  return `${(seconds / 3600).toFixed(1)}h`;
}

function timeLabel(value: string | Date) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function startOfWeek(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() - next.getDay());
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function defaultStart(dateStr?: string) {
  if (dateStr) return new Date(`${dateStr}T09:00`);
  const date = new Date();
  date.setMinutes(0, 0, 0);
  if (date.getHours() < DAY_START_HOUR) {
    date.setHours(9);
    return date;
  }
  if (date.getHours() >= DAY_END_HOUR - 1) {
    date.setDate(date.getDate() + 1);
    date.setHours(9);
    return date;
  }
  date.setHours(date.getHours() + 1);
  return date;
}

function entryEnd(entry: TimeEntry) {
  if (entry.stoppedAt) return entry.stoppedAt;
  const start = new Date(entry.startedAt);
  start.setSeconds(start.getSeconds() + (entry.durationSeconds ?? 1800));
  return start.toISOString();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function snapMinute(value: number) {
  return Math.round(value / SLOT_MINUTES) * SLOT_MINUTES;
}

function dayMinute(day: Date, value: string | Date) {
  const dayStart = new Date(`${dateKey(day)}T00:00`);
  return Math.round((new Date(value).getTime() - dayStart.getTime()) / 60000);
}

function dateAtMinute(day: Date, minute: number) {
  const date = new Date(`${dateKey(day)}T00:00`);
  date.setMinutes(minute);
  return date;
}

function minuteFromPointer(clientY: number, columnTop: number) {
  const rawMinute = DAY_START_MINUTES + ((clientY - columnTop) / HOUR_HEIGHT) * 60;
  return clamp(snapMinute(rawMinute), DAY_START_MINUTES, DAY_END_MINUTES - SLOT_MINUTES);
}

function normalizedSelection(day: Date, startMinute: number, currentMinute: number) {
  let start = Math.min(startMinute, currentMinute);
  let end = Math.max(startMinute, currentMinute);
  if (end === start) end = start + 60;
  if (end - start < SLOT_MINUTES) end = start + SLOT_MINUTES;
  if (end > DAY_END_MINUTES) {
    end = DAY_END_MINUTES;
    start = Math.max(DAY_START_MINUTES, end - SLOT_MINUTES);
  }
  return { startsAt: dateAtMinute(day, start), endsAt: dateAtMinute(day, end) };
}

function clampEventStyle(day: Date, startsAt: string | Date, endsAt: string | Date) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const startMinutes = dayMinute(day, start);
  const endMinutes = dayMinute(day, end);
  const top = Math.max(0, ((Math.max(startMinutes, DAY_START_MINUTES) - DAY_START_MINUTES) / 60) * HOUR_HEIGHT);
  const height = Math.max(34, ((Math.min(endMinutes, DAY_END_MINUTES) - Math.max(startMinutes, DAY_START_MINUTES)) / 60) * HOUR_HEIGHT);
  return { top, height };
}

function visibleInHourRange(day: Date, startsAt: string, endsAt: string) {
  const startMinutes = dayMinute(day, startsAt);
  const endMinutes = dayMinute(day, endsAt);
  return endMinutes > DAY_START_MINUTES && startMinutes < DAY_END_MINUTES;
}

export function CalendarView() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [blocks, setBlocks] = useState<ScheduledBlock[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerMode>("scheduled");
  const [editingBlock, setEditingBlock] = useState<ScheduledBlock | null>(null);
  const [eventTitle, setEventTitle] = useState("Focus block");
  const [eventProjectId, setEventProjectId] = useState("");
  const [eventTaskId, setEventTaskId] = useState("");
  const [eventNotes, setEventNotes] = useState("");
  const [eventTags, setEventTags] = useState("");
  const [eventStart, setEventStart] = useState(() => localInput(defaultStart()));
  const [eventEnd, setEventEnd] = useState(() => localInput(new Date(defaultStart().getTime() + 60 * 60 * 1000)));
  const [savingEvent, setSavingEvent] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [draft, setDraft] = useState<CalendarDraft | null>(null);
  const [reschedulingBlock, setReschedulingBlock] = useState(false);
  const [movingBlockId, setMovingBlockId] = useState<string | null>(null);

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }, [currentDate]);

  const monthDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ dayNumber: number; dateStr: string } | null> = [];
    for (let i = 0; i < firstDayIndex; i++) cells.push(null);
    for (let i = 1; i <= daysInMonth; i++) cells.push({ dayNumber: i, dateStr: `${year}-${String(month + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}` });
    return cells;
  }, [currentDate]);

  async function fetchData() {
    setLoading(true);
    const [calendarRes, scheduleRes, projectsRes] = await Promise.all([
      fetch("/api/calendar").catch(() => null),
      fetch("/api/schedule?scope=team").catch(() => null),
      fetch("/api/projects").catch(() => null),
    ]);
    if (calendarRes?.ok) {
      const data = await calendarRes.json();
      setEntries(data.entries ?? []);
    }
    if (scheduleRes?.ok) {
      const data = await scheduleRes.json();
      setBlocks(data.blocks ?? []);
    }
    if (projectsRes?.ok) setProjects((await projectsRes.json()).projects ?? []);
    setLoading(false);
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      fetchData().catch(() => toast.error("Unable to load calendar"));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const onTimeSaved = () => {
      fetchData().catch(() => null);
    };
    window.addEventListener("billabled:time-saved", onTimeSaved);
    return () => window.removeEventListener("billabled:time-saved", onTimeSaved);
  }, []);

  useEffect(() => {
    if (!dragState) return;

    function handlePointerMove(event: PointerEvent) {
      if (dragState?.kind === "selection") {
        const currentMinute = minuteFromPointer(event.clientY, dragState.columnTop);
        const nextState = { ...dragState, currentMinute, x: event.clientX, y: event.clientY };
        setDragState(nextState);
        setDraft({
          kind: "selection",
          ...normalizedSelection(nextState.day, nextState.startMinute, currentMinute),
          x: event.clientX,
          y: event.clientY,
        });
        return;
      }

      if (dragState?.kind === "move") {
        const targetColumn = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-day-column]");
        const dayKeyValue = targetColumn?.dataset.dayKey ?? dragState.dayKey;
        const columnTop = targetColumn?.getBoundingClientRect().top ?? dragState.columnTop;
        const day = new Date(`${dayKeyValue}T00:00`);
        const maxStart = Math.max(DAY_START_MINUTES, DAY_END_MINUTES - dragState.durationMinutes);
        const pointerMinute = minuteFromPointer(event.clientY, columnTop);
        const currentStartMinute = clamp(snapMinute(pointerMinute - dragState.grabOffsetMinutes), DAY_START_MINUTES, maxStart);
        const startsAt = dateAtMinute(day, currentStartMinute);
        const endsAt = dateAtMinute(day, currentStartMinute + dragState.durationMinutes);
        const nextState = {
          ...dragState,
          columnTop,
          dayKey: dayKeyValue,
          currentStartMinute,
          x: event.clientX,
          y: event.clientY,
        };
        setDragState(nextState);
        setDraft({ kind: "move", block: dragState.block, startsAt, endsAt, x: event.clientX, y: event.clientY });
      }
    }

    function handlePointerUp() {
      setDragState(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragState]);

  function openComposer({ mode = "scheduled", dateStr, startAt, endAt, block = null }: OpenComposerOptions = {}) {
    const start = block ? new Date(block.startsAt) : startAt ?? defaultStart(dateStr);
    const end = block ? new Date(block.endsAt) : endAt ?? new Date(start.getTime() + 60 * 60 * 1000);

    setComposerMode(mode);
    setEditingBlock(block);
    setEventTitle(block?.title ?? (mode === "calendar" ? "Completed work" : "Focus block"));
    setEventProjectId(block?.projectId ?? "");
    setEventTaskId(block?.taskId ?? "");
    setEventNotes(block?.notes ?? "");
    setEventTags((block?.tags ?? []).join(", "));
    setEventStart(localInput(start));
    setEventEnd(localInput(end));
    setComposerOpen(true);
  }

  function openComposerFromDraft(mode: ComposerMode) {
    if (!draft) return;
    openComposer({ mode, startAt: draft.startsAt, endAt: draft.endsAt, block: draft.kind === "move" ? draft.block : null });
    if (draft.kind === "selection") {
      setEditingBlock(null);
    }
    setDraft(null);
    setMovingBlockId(null);
  }

  function dayBlocks(date: Date) {
    const key = dateKey(date);
    return blocks.filter((block) => block.startsAt.startsWith(key) && block.status !== "canceled");
  }

  function dayEntries(date: Date) {
    const key = dateKey(date);
    return entries.filter((entry) => entry.startedAt.startsWith(key));
  }

  async function saveEvent() {
    const startsAt = new Date(eventStart);
    const endsAt = new Date(eventEnd);
    const title = eventTitle.trim();
    const taskId = eventTaskId.trim();
    const tags = eventTags.split(",").map((tag) => tag.trim()).filter(Boolean);

    if (!title) {
      toast.error("Add a title for this work block.");
      return;
    }
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      toast.error("Enter a valid start and end time.");
      return;
    }

    setSavingEvent(true);
    try {
      if (composerMode === "scheduled") {
        const response = await fetch("/api/schedule", {
          method: editingBlock ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(editingBlock ? { blockId: editingBlock.id } : {}),
            title,
            projectId: eventProjectId || null,
            taskId: taskId || null,
            notes: eventNotes || null,
            tags,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not save scheduled work");
        toast.success(editingBlock ? "Scheduled work updated" : "Work scheduled");
      } else {
        const response = await fetch("/api/timer/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: taskId || title,
            projectId: eventProjectId || undefined,
            description: eventNotes || title,
            tags,
            startedAt: startsAt.toISOString(),
            stoppedAt: endsAt.toISOString(),
            scheduledBlockId: editingBlock?.id,
            source: "calendar",
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not log completed work");
        window.dispatchEvent(new CustomEvent("billabled:time-saved"));
        toast.success("Completed work logged");
      }
      setComposerOpen(false);
      await fetchData();
    } catch (error) {
      toast.error("Could not save calendar event", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setSavingEvent(false);
    }
  }

  async function startBlock(block: ScheduledBlock) {
    const response = await fetch("/api/timer/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: block.taskId || block.title,
        projectId: block.projectId || undefined,
        description: block.notes || block.title,
        tags: block.tags,
        scheduledBlockId: block.id,
      }),
    });
    const data = await response.json();
    if (!response.ok) toast.error("Could not start scheduled work", { description: data.error });
    else toast.success("Timer started from schedule");
    await fetchData();
  }

  async function moveBlockTomorrow(block: ScheduledBlock) {
    const startsAt = new Date(block.startsAt);
    const endsAt = new Date(block.endsAt);
    startsAt.setDate(startsAt.getDate() + 1);
    endsAt.setDate(endsAt.getDate() + 1);
    const response = await fetch("/api/schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blockId: block.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }),
    });
    if (!response.ok) toast.error("Could not reschedule work");
    else toast.success("Work moved to tomorrow");
    await fetchData();
  }

  function beginSlotDrag(event: React.PointerEvent<HTMLElement>, day: Date) {
    if (event.button !== 0) return;
    const column = event.currentTarget.closest<HTMLElement>("[data-day-column]");
    if (!column) return;
    const columnTop = column.getBoundingClientRect().top;
    const startMinute = minuteFromPointer(event.clientY, columnTop);
    const currentMinute = Math.min(startMinute + 60, DAY_END_MINUTES);
    const selection = normalizedSelection(day, startMinute, currentMinute);
    event.preventDefault();
    setMovingBlockId(null);
    setDraft({ kind: "selection", ...selection, x: event.clientX, y: event.clientY });
    setDragState({
      kind: "selection",
      day,
      columnTop,
      startMinute,
      currentMinute,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function beginBlockMove(event: React.PointerEvent<HTMLButtonElement>, block: ScheduledBlock, day: Date) {
    if (event.button !== 0) return;
    const column = event.currentTarget.closest<HTMLElement>("[data-day-column]");
    if (!column) return;
    const columnTop = column.getBoundingClientRect().top;
    const startMinute = dayMinute(day, block.startsAt);
    const endMinute = dayMinute(day, block.endsAt);
    const durationMinutes = Math.max(SLOT_MINUTES, snapMinute(endMinute - startMinute));
    const pointerMinute = minuteFromPointer(event.clientY, columnTop);
    const grabOffsetMinutes = clamp(pointerMinute - startMinute, 0, Math.max(SLOT_MINUTES, durationMinutes - SLOT_MINUTES));
    event.preventDefault();
    event.stopPropagation();
    setMovingBlockId(block.id);
    setDraft({ kind: "move", block, startsAt: new Date(block.startsAt), endsAt: new Date(block.endsAt), x: event.clientX, y: event.clientY });
    setDragState({
      kind: "move",
      block,
      columnTop,
      dayKey: dateKey(day),
      durationMinutes,
      grabOffsetMinutes,
      currentStartMinute: startMinute,
      x: event.clientX,
      y: event.clientY,
    });
  }

  async function applyDraftMove() {
    if (!draft || draft.kind !== "move") return;
    setReschedulingBlock(true);
    try {
      const response = await fetch("/api/schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockId: draft.block.id,
          startsAt: draft.startsAt.toISOString(),
          endsAt: draft.endsAt.toISOString(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not move scheduled work");
      toast.success("Scheduled work moved");
      setDraft(null);
      setMovingBlockId(null);
      await fetchData();
    } catch (error) {
      toast.error("Could not move scheduled work", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setReschedulingBlock(false);
    }
  }

  async function cancelBlock(block: ScheduledBlock) {
    const response = await fetch(`/api/schedule?blockId=${encodeURIComponent(block.id)}`, { method: "DELETE" });
    if (!response.ok) toast.error("Could not cancel scheduled work");
    else toast.success("Scheduled work canceled");
    await fetchData();
  }

  const weekRangeLabel = `${weekDays[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${weekDays[6].toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  return (
    <div className="flex h-full flex-col gap-5">
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.22em] text-cyan-700">
              <CalendarClock className="h-4 w-4" /> Calendar operations
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Block the week. Log what happened.</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">Calendar is for scheduling and adjusting the week. Drag empty space to block time, drag a planned block handle to reschedule, or log completed work when it happened without a timer.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => openComposer({ mode: "scheduled" })} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800">
              <CalendarPlus className="h-4 w-4" /> Schedule work
            </button>
            <button onClick={() => openComposer({ mode: "calendar" })} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700">
              <CheckCircle2 className="h-4 w-4" /> Log completed time
            </button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">{viewMode === "week" ? weekRangeLabel : `${currentDate.toLocaleString("default", { month: "long" })} ${currentDate.getFullYear()}`}</h2>
            <p className="text-sm text-slate-500">{viewMode === "week" ? "5 AM to midnight with 15-minute drag scheduling." : "Month overview for spotting planned and logged work."}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-full bg-slate-100 p-1">
              <button onClick={() => setViewMode("week")} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-bold transition ${viewMode === "week" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"}`}><CalendarDays className="h-4 w-4" />Week</button>
              <button onClick={() => setViewMode("month")} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-bold transition ${viewMode === "month" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"}`}><LayoutGrid className="h-4 w-4" />Month</button>
            </div>
            <button onClick={() => setCurrentDate(viewMode === "week" ? addDays(currentDate, -7) : new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" aria-label="Previous period"><ChevronLeft className="h-5 w-5" /></button>
            <button onClick={() => setCurrentDate(new Date())} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Today</button>
            <button onClick={() => setCurrentDate(viewMode === "week" ? addDays(currentDate, 7) : new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" aria-label="Next period"><ChevronRight className="h-5 w-5" /></button>
          </div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-slate-500">Loading calendar...</div>
        ) : viewMode === "week" ? (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[1040px]">
              <div className="grid grid-cols-[72px_repeat(7,minmax(130px,1fr))] border-b border-slate-200 bg-slate-50 text-sm">
                <div className="border-r border-slate-200 px-3 py-3 text-xs font-bold uppercase tracking-wide text-slate-400">Time</div>
                {weekDays.map((day) => {
                  const isToday = dateKey(day) === dateKey(new Date());
                  return (
                    <div key={dateKey(day)} className={`border-r border-slate-200 px-3 py-3 ${isToday ? "bg-cyan-50" : ""}`}>
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{day.toLocaleDateString(undefined, { weekday: "short" })}</p>
                      <p className={`mt-1 text-lg font-semibold ${isToday ? "text-cyan-700" : "text-slate-950"}`}>{day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-[72px_repeat(7,minmax(130px,1fr))]">
                <div className="border-r border-slate-200 bg-slate-50">
                  {HOURS.map((hour) => (
                    <div key={hour} className="border-b border-slate-200 px-2 py-2 text-right text-[11px] font-semibold text-slate-400" style={{ height: HOUR_HEIGHT }}>
                      {timeLabel(new Date(2020, 0, 1, hour))}
                    </div>
                  ))}
                </div>

                {weekDays.map((day) => {
                  const planned = dayBlocks(day).filter((block) => visibleInHourRange(day, block.startsAt, block.endsAt));
                  const logged = dayEntries(day).filter((entry) => visibleInHourRange(day, entry.startedAt, entryEnd(entry)));
                  const draftForDay = draft && dateKey(draft.startsAt) === dateKey(day) ? draft : null;
                  return (
                    <div key={dateKey(day)} data-day-column data-day-key={dateKey(day)} className="relative border-r border-slate-200" style={{ height: HOURS.length * HOUR_HEIGHT }}>
                      {HOURS.map((hour) => {
                        const slotStart = new Date(`${dateKey(day)}T${String(hour).padStart(2, "0")}:00`);
                        return (
                          <button
                            key={`${dateKey(day)}-${hour}`}
                            type="button"
                            data-calendar-slot="true"
                            onPointerDown={(event) => beginSlotDrag(event, day)}
                            className="block w-full border-b border-slate-100 px-2 text-left text-[11px] text-transparent transition hover:bg-cyan-50 hover:text-cyan-700"
                            style={{ height: HOUR_HEIGHT }}
                            aria-label={`Schedule work ${day.toLocaleDateString()} ${timeLabel(slotStart)}`}
                          >
                            Drag to add
                          </button>
                        );
                      })}

                      {draftForDay && (
                        <div
                          className={`pointer-events-none absolute left-1 right-1 z-20 rounded-2xl border-2 border-dashed p-2 text-xs shadow-lg ${
                            draftForDay.kind === "move"
                              ? "border-slate-400 bg-white/90 text-slate-800"
                              : "border-cyan-500 bg-cyan-100/85 text-cyan-950"
                          }`}
                          style={clampEventStyle(day, draftForDay.startsAt, draftForDay.endsAt)}
                        >
                          <p className="font-bold">{draftForDay.kind === "move" ? "Move block here" : "New work block"}</p>
                          <p className="mt-0.5 text-[10px]">{timeLabel(draftForDay.startsAt)} - {timeLabel(draftForDay.endsAt)}</p>
                        </div>
                      )}

                      {planned.map((block, index) => {
                        const style = clampEventStyle(day, block.startsAt, block.endsAt);
                        const isMoving = draft?.kind === "move" && draft.block.id === block.id;
                        return (
                          <article
                            key={block.id}
                            className={`absolute left-1 right-1 overflow-hidden rounded-xl border border-cyan-200 bg-cyan-50 p-2 text-xs text-cyan-950 shadow-sm transition ${isMoving ? "opacity-40 ring-2 ring-cyan-300" : "hover:border-cyan-300 hover:shadow-md"}`}
                            style={{ top: style.top + index * 3, height: style.height }}
                            onClick={() => {
                              if (movingBlockId === block.id || (draft?.kind === "move" && draft.block.id === block.id)) return;
                              openComposer({ mode: "scheduled", block });
                            }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <button
                                type="button"
                                onPointerDown={(event) => beginBlockMove(event, block, day)}
                                onClick={(event) => event.stopPropagation()}
                                className="mt-0.5 rounded-md bg-white/75 p-0.5 text-cyan-700 transition hover:bg-white"
                                aria-label={`Drag to reschedule ${block.title}`}
                                title="Drag to reschedule"
                              >
                                <GripVertical className="h-3.5 w-3.5" />
                              </button>
                              <div className="min-w-0">
                                <p className="truncate font-bold">{block.title}</p>
                                <p className="mt-0.5 truncate text-[10px] text-cyan-700">{timeLabel(block.startsAt)} - {timeLabel(block.endsAt)}</p>
                              </div>
                              <button onClick={(event) => { event.stopPropagation(); startBlock(block); }} className="rounded-full bg-white/70 p-1 text-cyan-700" aria-label="Start timer from scheduled work"><Play className="h-3 w-3 fill-cyan-700" /></button>
                            </div>
                            <div className="mt-1 flex gap-2 text-[10px] font-bold text-cyan-700">
                              <button onClick={(event) => { event.stopPropagation(); openComposer({ mode: "calendar", block }); }} className="inline-flex items-center gap-1"><SquarePen className="h-3 w-3" />Log completed</button>
                              <button onClick={(event) => { event.stopPropagation(); moveBlockTomorrow(block); }}>Move</button>
                              <button onClick={(event) => { event.stopPropagation(); cancelBlock(block); }} aria-label="Cancel scheduled work"><Trash2 className="h-3 w-3" /></button>
                            </div>
                          </article>
                        );
                      })}

                      {logged.map((entry, index) => {
                        const style = clampEventStyle(day, entry.startedAt, entryEnd(entry));
                        const color = entry.source === "manual" ? "border-amber-200 bg-amber-50 text-amber-800" : entry.source === "calendar" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-700";
                        return (
                          <article key={entry.id} className={`absolute left-2 right-2 rounded-xl border p-2 text-xs shadow-sm ${color}`} style={{ top: style.top + 18 + index * 4, height: Math.min(style.height, 48) }}>
                            <p className="truncate font-bold">{entry.taskId || "Logged time"}</p>
                            <p className="mt-0.5 text-[10px]">{timeLabel(entry.startedAt)} - {timeLabel(entryEnd(entry))}</p>
                          </article>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid grid-cols-7 bg-slate-50 text-center text-xs font-bold uppercase tracking-wider text-slate-500">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="border-b border-slate-200 py-3">{day}</div>)}
            </div>
            <div className="grid min-h-full grid-cols-7 auto-rows-[minmax(155px,1fr)]">
              {monthDays.map((cell, index) => {
                if (!cell) return <div key={`empty-${index}`} className="border-b border-r border-slate-100 bg-slate-50/60" />;
                const cellDate = new Date(`${cell.dateStr}T00:00`);
                const blocksForDay = dayBlocks(cellDate);
                const entriesForDay = dayEntries(cellDate);
                const totalSeconds = entriesForDay.reduce((sum, entry) => sum + (entry.durationSeconds || 0), 0);
                const isToday = cell.dateStr === dateKey(new Date());
                return (
                  <div key={cell.dateStr} onDoubleClick={() => openComposer({ dateStr: cell.dateStr, mode: "scheduled" })} className={`border-b border-r border-slate-100 p-2 ${isToday ? "bg-cyan-50" : "bg-white"}`}>
                    <div className="mb-2 flex items-center justify-between">
                      <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${isToday ? "bg-cyan-600 text-white" : "text-slate-500"}`}>{cell.dayNumber}</span>
                      <button onClick={() => openComposer({ dateStr: cell.dateStr, mode: "scheduled" })} className="rounded-full p-1 text-slate-300 hover:bg-slate-100 hover:text-cyan-700" aria-label="Add calendar event"><Plus className="h-3 w-3" /></button>
                    </div>
                    <div className="space-y-1.5">
                      {blocksForDay.slice(0, 3).map((block) => (
                        <div key={block.id} onClick={() => openComposer({ mode: "scheduled", block })} className="cursor-pointer rounded-xl border border-cyan-100 bg-cyan-50 px-2 py-1.5 text-xs text-cyan-950 transition hover:border-cyan-300 hover:bg-cyan-100/70">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-semibold">{block.title}</span>
                            <button onClick={(event) => { event.stopPropagation(); startBlock(block); }} className="text-cyan-700"><Play className="h-3 w-3 fill-cyan-700" /></button>
                          </div>
                          <div className="mt-1 text-[10px] text-cyan-700">{timeLabel(block.startsAt)} - {timeLabel(block.endsAt)}</div>
                        </div>
                      ))}
                      {totalSeconds > 0 && <div className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700"><span className="flex items-center gap-1"><Clock className="h-3 w-3" />Logged</span><strong>{formatHours(totalSeconds)}</strong></div>}
                      {entriesForDay.filter((entry) => entry.source === "manual").length > 0 && <div className="rounded-xl bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">{entriesForDay.filter((entry) => entry.source === "manual").length} manual block(s)</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {draft && !composerOpen && (
        <div
          className="fixed z-[70] w-[min(22rem,calc(100vw-2rem))] rounded-3xl border border-slate-200 bg-white p-4 text-slate-950 shadow-2xl"
          style={{ left: `min(${Math.max(16, draft.x + 14)}px, calc(100vw - 23rem))`, top: `min(${Math.max(16, draft.y + 14)}px, calc(100vh - 13rem))` }}
          role="dialog"
          aria-label={draft.kind === "move" ? "Move scheduled work" : "Create calendar work block"}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">{draft.kind === "move" ? "Reschedule" : "Selected time"}</p>
              <h3 className="mt-1 text-lg font-semibold">{draft.kind === "move" ? draft.block.title : "Fill this schedule block"}</h3>
              <p className="mt-1 text-sm text-slate-500">{draft.startsAt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {timeLabel(draft.startsAt)} - {timeLabel(draft.endsAt)}</p>
            </div>
            <button onClick={() => { setDraft(null); setMovingBlockId(null); }} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Dismiss calendar selection">
              <X className="h-4 w-4" />
            </button>
          </div>
          {draft.kind === "move" ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={applyDraftMove} disabled={reschedulingBlock} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">{reschedulingBlock ? "Moving..." : "Move block"}</button>
              <button onClick={() => { openComposer({ mode: "scheduled", block: draft.block }); setDraft(null); setMovingBlockId(null); }} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Edit details</button>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => openComposerFromDraft("scheduled")} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Plan work</button>
              <button onClick={() => openComposerFromDraft("calendar")} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Log completed time</button>
            </div>
          )}
        </div>
      )}

      {composerOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Calendar event composer">
          <div className="w-full max-w-2xl overflow-hidden rounded-[28px] border border-slate-200 bg-white text-slate-950 shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-cyan-700">
                  {composerMode === "scheduled" ? <CalendarPlus className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                  {editingBlock ? "Edit calendar work" : "New calendar work"}
                </div>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight">{composerMode === "scheduled" ? "Schedule work" : "Log completed work"}</h2>
                <p className="mt-1 text-sm text-slate-500">Use the same title, project, start, and end model people expect from calendar events.</p>
              </div>
              <button onClick={() => setComposerOpen(false)} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Close calendar composer">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="border-b border-slate-100 px-6 py-4">
              <div className="inline-flex rounded-full bg-slate-100 p-1">
                <button onClick={() => setComposerMode("scheduled")} className={`rounded-full px-4 py-2 text-sm font-bold transition ${composerMode === "scheduled" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"}`}>Scheduled work</button>
                <button onClick={() => setComposerMode("calendar")} className={`rounded-full px-4 py-2 text-sm font-bold transition ${composerMode === "calendar" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"}`}>Completed time</button>
              </div>
            </div>

            <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">
                Title
                <input value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" placeholder="Client review, proposal writing, design QA" />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                Project
                <select value={eventProjectId} onChange={(event) => setEventProjectId(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white">
                  <option value="">No project</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                Work label
                <input value={eventTaskId} onChange={(event) => setEventTaskId(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" placeholder="Client call, research review, design QA" />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                Starts
                <input type="datetime-local" value={eventStart} onChange={(event) => setEventStart(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                Ends
                <input type="datetime-local" value={eventEnd} onChange={(event) => setEventEnd(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">
                Notes
                <input value={eventNotes} onChange={(event) => setEventNotes(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" placeholder="What should happen during this block?" />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">
                Tags
                <input value={eventTags} onChange={(event) => setEventTags(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" placeholder="research, review, billable" />
              </label>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Pencil className="h-4 w-4" />
                {composerMode === "scheduled" ? "Creates scheduled work visible on Dashboard and exports." : "Creates a completed time entry with source calendar."}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setComposerOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white">Cancel</button>
                <button onClick={saveEvent} disabled={savingEvent} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">{savingEvent ? "Saving..." : composerMode === "scheduled" ? "Save scheduled work" : "Log completed work"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
