"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  GripVertical,
  LayoutGrid,
  Pencil,
  Play,
  Plus,
  Repeat,
  SkipForward,
  SquarePen,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { toast } from "sonner";

type TimeEntry = {
  id: string;
  userId: string;
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number | null;
  taskId?: string;
  projectId?: string | null;
  source: "web" | "calendar" | "manual";
};

type Project = { id: string; name: string };
type Person = {
  id: string;
  linkedUserId: string | null;
  displayName: string | null;
  email: string | null;
  personType: "member" | "client" | "contractor" | "contact";
  invitationStatus: "none" | "pending" | "accepted";
};
type Session = { sub: string; email: string; role: "client" | "member" | "manager" | "owner"; workspaceId: string };
type CalendarPreferences = { visibleStartHour?: number; visibleEndHour?: number };

type ScheduledBlock = {
  id: string;
  userId: string;
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

type ComposerMode = "scheduled" | "calendar" | "unavailable";
type ViewMode = "week" | "team" | "month";
type ResizeEdge = "start" | "end";
type RepeatMode = "none" | "daily" | "weekly";

type OpenComposerOptions = {
  mode?: ComposerMode;
  dateStr?: string;
  startAt?: Date;
  endAt?: Date;
  block?: ScheduledBlock | null;
  userId?: string | null;
};

type CalendarDraft = {
  kind: "selection" | "move" | "resize";
  startsAt: Date;
  endsAt: Date;
  x: number;
  y: number;
  block?: ScheduledBlock;
  edge?: ResizeEdge;
  userId?: string | null;
};

type DragState =
  | {
      kind: "selection";
      day: Date;
      userId?: string | null;
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
    }
  | {
      kind: "resize";
      block: ScheduledBlock;
      day: Date;
      columnTop: number;
      edge: ResizeEdge;
      fixedMinute: number;
      currentMinute: number;
      x: number;
      y: number;
    };

type Lane = { key: string; label: string; date: Date; userId?: string | null };
type Conflict = { id: string; label: string; kind: "planned" | "logged" | "unavailable" };

const DEFAULT_START_HOUR = 5;
const DEFAULT_END_HOUR = 24;
const SLOT_MINUTES = 15;
const HOUR_HEIGHT = 72;
const MIN_BLOCK_MINUTES = 15;
const MAX_REPEAT_COUNT = 12;

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

function addRepeat(date: Date, mode: RepeatMode, index: number) {
  if (mode === "daily") return addDays(date, index);
  if (mode === "weekly") return addDays(date, index * 7);
  return new Date(date);
}

function defaultStart(dateStr?: string, visibleStartHour = DEFAULT_START_HOUR, visibleEndHour = DEFAULT_END_HOUR) {
  if (dateStr) return new Date(`${dateStr}T09:00`);
  const date = new Date();
  date.setMinutes(0, 0, 0);
  if (date.getHours() < visibleStartHour) {
    date.setHours(Math.max(visibleStartHour, 9));
    return date;
  }
  if (date.getHours() >= visibleEndHour - 1) {
    date.setDate(date.getDate() + 1);
    date.setHours(Math.max(visibleStartHour, 9));
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

function rangesOverlap(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && endA > startB;
}

function eventOverlapsDay(day: Date, startsAt: string | Date, endsAt: string | Date) {
  const dayStart = new Date(`${dateKey(day)}T00:00`);
  const dayEnd = addDays(dayStart, 1);
  return rangesOverlap(new Date(startsAt), new Date(endsAt), dayStart, dayEnd);
}

function isUnavailableBlock(block: ScheduledBlock) {
  const text = `${block.title} ${(block.tags ?? []).join(" ")}`.toLowerCase();
  return text.includes("unavailable") || text.includes("ooo") || text.includes("out of office");
}

function statusLabel(block: ScheduledBlock) {
  if (isUnavailableBlock(block)) return "Unavailable";
  if (block.status === "in_progress") return "Running";
  return block.status.charAt(0).toUpperCase() + block.status.slice(1);
}

function minuteDuration(startsAt: Date | string, endsAt: Date | string) {
  return Math.max(MIN_BLOCK_MINUTES, Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000));
}

function timezoneLabel(timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: "short" }).formatToParts(new Date());
    return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

export function CalendarView() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [session, setSession] = useState<Session | null>(null);
  const [userTimezone, setUserTimezone] = useState("UTC");
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [blocks, setBlocks] = useState<ScheduledBlock[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
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
  const [eventUserId, setEventUserId] = useState<string | null>(null);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("none");
  const [repeatCount, setRepeatCount] = useState(1);
  const [savingEvent, setSavingEvent] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [draft, setDraft] = useState<CalendarDraft | null>(null);
  const [quickTitle, setQuickTitle] = useState("Focus block");
  const [reschedulingBlock, setReschedulingBlock] = useState(false);
  const [movingBlockId, setMovingBlockId] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<{ block: ScheduledBlock; x: number; y: number } | null>(null);
  const [visibleStartHour, setVisibleStartHour] = useState(DEFAULT_START_HOUR);
  const [visibleEndHour, setVisibleEndHour] = useState(DEFAULT_END_HOUR);
  const [savingHours, setSavingHours] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);

  const browserTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const isManager = session?.role === "manager" || session?.role === "owner";
  const visibleStartMinutes = visibleStartHour * 60;
  const visibleEndMinutes = visibleEndHour * 60;
  const hours = useMemo(() => Array.from({ length: visibleEndHour - visibleStartHour }, (_, index) => index + visibleStartHour), [visibleStartHour, visibleEndHour]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }, [currentDate]);

  const members = useMemo(() => {
    const seen = new Set<string>();
    const rows = people
      .filter((person) => person.personType === "member" && person.invitationStatus === "accepted" && person.linkedUserId)
      .map((person) => ({
        id: person.linkedUserId!,
        label: person.displayName || person.email || "Workspace member",
      }));
    if (session && !rows.some((row) => row.id === session.sub)) rows.unshift({ id: session.sub, label: session.email });
    return rows.filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  }, [people, session]);

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

  const lanes: Lane[] = useMemo(() => {
    if (viewMode === "team") {
      const day = new Date(currentDate);
      day.setHours(0, 0, 0, 0);
      return (members.length > 0 ? members : session ? [{ id: session.sub, label: session.email }] : []).map((member) => ({
        key: `team-${member.id}`,
        label: member.label,
        date: day,
        userId: member.id,
      }));
    }
    return weekDays.map((day) => ({ key: dateKey(day), label: day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }), date: day, userId: session?.sub }));
  }, [currentDate, members, session, viewMode, weekDays]);

  const minuteFromPointer = useCallback((clientY: number, columnTop: number) => {
    const rawMinute = visibleStartMinutes + ((clientY - columnTop) / HOUR_HEIGHT) * 60;
    return clamp(snapMinute(rawMinute), visibleStartMinutes, visibleEndMinutes - SLOT_MINUTES);
  }, [visibleEndMinutes, visibleStartMinutes]);

  const normalizedSelection = useCallback((day: Date, startMinute: number, currentMinute: number) => {
    let start = Math.min(startMinute, currentMinute);
    let end = Math.max(startMinute, currentMinute);
    if (end === start) end = start + 60;
    if (end - start < MIN_BLOCK_MINUTES) end = start + MIN_BLOCK_MINUTES;
    if (end > visibleEndMinutes) {
      end = visibleEndMinutes;
      start = Math.max(visibleStartMinutes, end - MIN_BLOCK_MINUTES);
    }
    return { startsAt: dateAtMinute(day, start), endsAt: dateAtMinute(day, end) };
  }, [visibleEndMinutes, visibleStartMinutes]);

  function clampEventStyle(day: Date, startsAt: string | Date, endsAt: string | Date) {
    const startMinutes = dayMinute(day, startsAt);
    const endMinutes = dayMinute(day, endsAt);
    const top = Math.max(0, ((Math.max(startMinutes, visibleStartMinutes) - visibleStartMinutes) / 60) * HOUR_HEIGHT);
    const height = Math.max(34, ((Math.min(endMinutes, visibleEndMinutes) - Math.max(startMinutes, visibleStartMinutes)) / 60) * HOUR_HEIGHT);
    return { top, height };
  }

  function visibleInHourRange(day: Date, startsAt: string, endsAt: string) {
    const startMinutes = dayMinute(day, startsAt);
    const endMinutes = dayMinute(day, endsAt);
    return endMinutes > visibleStartMinutes && startMinutes < visibleEndMinutes;
  }

  function blocksForLane(lane: Lane) {
    return blocks.filter((block) => block.status !== "canceled" && eventOverlapsDay(lane.date, block.startsAt, block.endsAt) && (!lane.userId || block.userId === lane.userId));
  }

  function entriesForLane(lane: Lane) {
    return entries.filter((entry) => eventOverlapsDay(lane.date, entry.startedAt, entryEnd(entry)) && (!lane.userId || entry.userId === lane.userId));
  }

  function conflictsForRange(startsAt: Date, endsAt: Date, userId?: string | null, ignoreBlockId?: string): Conflict[] {
    const planned = blocks
      .filter((block) => block.id !== ignoreBlockId && block.status !== "canceled" && block.status !== "skipped")
      .filter((block) => !userId || block.userId === userId)
      .filter((block) => rangesOverlap(startsAt, endsAt, new Date(block.startsAt), new Date(block.endsAt)))
      .map((block) => ({ id: block.id, label: block.title, kind: isUnavailableBlock(block) ? "unavailable" as const : "planned" as const }));
    const logged = entries
      .filter((entry) => !userId || entry.userId === userId)
      .filter((entry) => rangesOverlap(startsAt, endsAt, new Date(entry.startedAt), new Date(entryEnd(entry))))
      .map((entry) => ({ id: entry.id, label: entry.taskId || "Logged time", kind: "logged" as const }));
    return [...planned, ...logged];
  }

  function findNextOpenSlot(after: Date, durationMinutes: number, userId?: string | null, ignoreBlockId?: string) {
    let cursor = new Date(after);
    cursor.setMinutes(snapMinute(cursor.getMinutes()), 0, 0);
    if (cursor.getHours() < visibleStartHour) cursor = dateAtMinute(cursor, visibleStartMinutes);
    for (let dayOffset = 0; dayOffset < 35; dayOffset++) {
      const day = addDays(cursor, dayOffset === 0 ? 0 : 1);
      if (dayOffset > 0) cursor = dateAtMinute(day, visibleStartMinutes);
      while (dayMinute(cursor, cursor) + durationMinutes <= visibleEndMinutes) {
        const end = new Date(cursor.getTime() + durationMinutes * 60000);
        if (conflictsForRange(cursor, end, userId, ignoreBlockId).length === 0) return { startsAt: new Date(cursor), endsAt: end };
        cursor = new Date(cursor.getTime() + SLOT_MINUTES * 60000);
      }
    }
    return null;
  }

  function firstConflictAfterStart(startsAt: Date, endsAt: Date, userId?: string | null) {
    const candidates = conflictsForRange(startsAt, endsAt, userId)
      .map((conflict) => {
        const block = blocks.find((item) => item.id === conflict.id);
        const entry = entries.find((item) => item.id === conflict.id);
        return block ? new Date(block.startsAt) : entry ? new Date(entry.startedAt) : null;
      })
      .filter((date): date is Date => date !== null && date > startsAt)
      .sort((a, b) => a.getTime() - b.getTime());
    return candidates[0] ?? null;
  }

  async function fetchData() {
    setLoading(true);
    const [calendarRes, scheduleRes, projectsRes, peopleRes, settingsRes, authRes] = await Promise.all([
      fetch("/api/calendar").catch(() => null),
      fetch("/api/schedule?scope=team").catch(() => null),
      fetch("/api/projects").catch(() => null),
      fetch("/api/people").catch(() => null),
      fetch("/api/user/settings").catch(() => null),
      fetch("/api/auth/me").catch(() => null),
    ]);
    if (authRes?.ok) {
      const data = await authRes.json();
      setSession(data.session ?? null);
    }
    if (calendarRes?.ok) {
      const data = await calendarRes.json();
      setEntries(data.entries ?? []);
    }
    if (scheduleRes?.ok) {
      const data = await scheduleRes.json();
      setBlocks(data.blocks ?? []);
    }
    if (projectsRes?.ok) setProjects((await projectsRes.json()).projects ?? []);
    if (peopleRes?.ok) setPeople((await peopleRes.json()).people ?? []);
    if (settingsRes?.ok) {
      const data = await settingsRes.json();
      setUserTimezone(data.user?.timezone ?? "UTC");
      const prefs = (data.user?.calendarPreferences ?? {}) as CalendarPreferences;
      const start = Number(prefs.visibleStartHour ?? DEFAULT_START_HOUR);
      const end = Number(prefs.visibleEndHour ?? DEFAULT_END_HOUR);
      if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= 24 && end > start) {
        setVisibleStartHour(start);
        setVisibleEndHour(end);
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      fetchData().catch(() => toast.error("Unable to load calendar"));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onTimeSaved = () => {
      fetchData().catch(() => null);
    };
    window.addEventListener("billabled:time-saved", onTimeSaved);
    return () => window.removeEventListener("billabled:time-saved", onTimeSaved);
  }, []);

  useLayoutEffect(() => {
    if (!focusBlockId) return;
    const element = document.querySelector<HTMLElement>(`[data-calendar-block-id="${CSS.escape(focusBlockId)}"]`);
    if (!element) return;
    const scrollableElement = element as HTMLElement & { scrollIntoViewIfNeeded?: (centerIfNeeded?: boolean) => void };
    if (typeof scrollableElement.scrollIntoViewIfNeeded === "function") {
      scrollableElement.scrollIntoViewIfNeeded(true);
    } else {
      element.scrollIntoView({ block: "center", inline: "nearest" });
    }
    setFocusBlockId(null);
  }, [blocks, focusBlockId]);

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
          userId: nextState.userId,
          x: event.clientX,
          y: event.clientY,
        });
        return;
      }

      if (dragState?.kind === "move") {
        const targetColumn = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-day-column]");
        const dayKeyValue = targetColumn?.dataset.dayKey ?? dragState.dayKey;
        const columnTop = targetColumn?.getBoundingClientRect().top ?? dragState.columnTop;
        const laneUserId = targetColumn?.dataset.userId ?? dragState.block.userId;
        const day = new Date(`${dayKeyValue}T00:00`);
        const maxStart = Math.max(visibleStartMinutes, visibleEndMinutes - dragState.durationMinutes);
        const pointerMinute = minuteFromPointer(event.clientY, columnTop);
        const currentStartMinute = clamp(snapMinute(pointerMinute - dragState.grabOffsetMinutes), visibleStartMinutes, maxStart);
        const startsAt = dateAtMinute(day, currentStartMinute);
        const endsAt = dateAtMinute(day, currentStartMinute + dragState.durationMinutes);
        const nextBlock = { ...dragState.block, userId: laneUserId };
        setDragState({ ...dragState, columnTop, dayKey: dayKeyValue, currentStartMinute, x: event.clientX, y: event.clientY });
        setDraft({ kind: "move", block: nextBlock, startsAt, endsAt, userId: laneUserId, x: event.clientX, y: event.clientY });
        return;
      }

      if (dragState?.kind === "resize") {
        const currentMinute = minuteFromPointer(event.clientY, dragState.columnTop);
        const startMinute = dragState.edge === "start" ? Math.min(currentMinute, dragState.fixedMinute - MIN_BLOCK_MINUTES) : dragState.fixedMinute;
        const endMinute = dragState.edge === "end" ? Math.max(currentMinute, dragState.fixedMinute + MIN_BLOCK_MINUTES) : dragState.fixedMinute;
        setDragState({ ...dragState, currentMinute, x: event.clientX, y: event.clientY });
        setDraft({
          kind: "resize",
          block: dragState.block,
          startsAt: dateAtMinute(dragState.day, clamp(startMinute, visibleStartMinutes, visibleEndMinutes - MIN_BLOCK_MINUTES)),
          endsAt: dateAtMinute(dragState.day, clamp(endMinute, visibleStartMinutes + MIN_BLOCK_MINUTES, visibleEndMinutes)),
          edge: dragState.edge,
          userId: dragState.block.userId,
          x: event.clientX,
          y: event.clientY,
        });
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
  }, [dragState, minuteFromPointer, normalizedSelection, visibleEndMinutes, visibleStartMinutes]);

  function openComposer({ mode = "scheduled", dateStr, startAt, endAt, block = null, userId = null }: OpenComposerOptions = {}) {
    const start = block ? new Date(block.startsAt) : startAt ?? defaultStart(dateStr, visibleStartHour, visibleEndHour);
    const end = block ? new Date(block.endsAt) : endAt ?? new Date(start.getTime() + 60 * 60 * 1000);

    setComposerMode(mode);
    setEditingBlock(block);
    setEventTitle(block?.title ?? (mode === "calendar" ? "Completed work" : mode === "unavailable" ? "Unavailable" : "Focus block"));
    setEventProjectId(block?.projectId ?? "");
    setEventTaskId(block?.taskId ?? "");
    setEventNotes(block?.notes ?? "");
    const tags = new Set(block?.tags ?? []);
    if (mode === "unavailable") tags.add("unavailable");
    setEventTags([...tags].join(", "));
    setEventStart(localInput(start));
    setEventEnd(localInput(end));
    setEventUserId(block?.userId ?? userId ?? session?.sub ?? null);
    setRepeatMode("none");
    setRepeatCount(1);
    setComposerOpen(true);
    setSelectedBlock(null);
  }

  function openComposerFromDraft(mode: ComposerMode) {
    if (!draft) return;
    openComposer({ mode, startAt: draft.startsAt, endAt: draft.endsAt, block: draft.kind === "selection" ? null : draft.block ?? null, userId: draft.userId ?? null });
    if (draft.kind === "selection") setEditingBlock(null);
    setDraft(null);
    setMovingBlockId(null);
  }

  async function saveWorkingHours() {
    if (visibleEndHour <= visibleStartHour) {
      toast.error("End hour must be after start hour.");
      return;
    }
    setSavingHours(true);
    try {
      const response = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarPreferences: { visibleStartHour, visibleEndHour } }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save calendar hours");
      toast.success("Calendar hours saved");
    } catch (error) {
      toast.error("Could not save calendar hours", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setSavingHours(false);
    }
  }

  async function patchBlock(blockId: string, updates: Record<string, unknown>, successMessage?: string) {
    const response = await fetch("/api/schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blockId, ...updates }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not update scheduled work");
    if (successMessage) toast.success(successMessage);
    await fetchData();
    return data.block as ScheduledBlock;
  }

  async function createScheduledBlock(input: {
    title: string;
    startsAt: Date;
    endsAt: Date;
    userId?: string | null;
    projectId?: string | null;
    taskId?: string | null;
    notes?: string | null;
    tags?: string[];
  }) {
    const response = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: input.title,
        projectId: input.projectId || null,
        taskId: input.taskId || null,
        notes: input.notes || null,
        tags: input.tags ?? [],
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
        userId: input.userId || undefined,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not schedule work");
    return data.block as ScheduledBlock;
  }

  function scrollBlockIntoView(blockId: string) {
    setFocusBlockId(blockId);
  }

  async function createQuickDraft(options: { replace?: boolean; shorten?: boolean } = {}) {
    if (!draft) return;
    const title = quickTitle.trim() || "Focus block";
    const startsAt = draft.startsAt;
    let endsAt = draft.endsAt;
    if (options.shorten) {
      const firstConflict = firstConflictAfterStart(startsAt, endsAt, draft.userId ?? session?.sub);
      if (firstConflict && firstConflict.getTime() - startsAt.getTime() >= MIN_BLOCK_MINUTES * 60000) endsAt = firstConflict;
    }
    try {
      if (options.replace) {
        const conflicts = conflictsForRange(startsAt, endsAt, draft.userId ?? session?.sub).filter((conflict) => conflict.kind === "planned");
        await Promise.all(conflicts.map((conflict) => patchBlock(conflict.id, { status: "skipped" }).catch(() => null)));
      }
      const block = await createScheduledBlock({ title, startsAt, endsAt, userId: draft.userId ?? session?.sub, tags: [] });
      toast.success("Work scheduled");
      setDraft(null);
      setQuickTitle("Focus block");
      await fetchData();
      scrollBlockIntoView(block.id);
    } catch (error) {
      toast.error("Could not schedule work", { description: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  async function saveEvent() {
    const startsAt = new Date(eventStart);
    const endsAt = new Date(eventEnd);
    const title = eventTitle.trim();
    const taskId = eventTaskId.trim();
    const tags = new Set(eventTags.split(",").map((tag) => tag.trim()).filter(Boolean));
    if (composerMode === "unavailable") tags.add("unavailable");

    if (!title) {
      toast.error("Add a title for this work block.");
      return;
    }
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      toast.error("Enter a valid start and end time.");
      return;
    }

    const conflicts = composerMode !== "calendar" ? conflictsForRange(startsAt, endsAt, eventUserId ?? session?.sub, editingBlock?.id) : [];
    let targetBlockId = editingBlock?.id ?? null;
    setSavingEvent(true);
    try {
      if (composerMode === "scheduled" || composerMode === "unavailable") {
        const occurrences = editingBlock ? 1 : repeatMode === "none" ? 1 : clamp(repeatCount, 1, MAX_REPEAT_COUNT);
        for (let index = 0; index < occurrences; index++) {
          const nextStart = addRepeat(startsAt, repeatMode, index);
          const nextEnd = addRepeat(endsAt, repeatMode, index);
          if (editingBlock) {
            await patchBlock(editingBlock.id, {
              title,
              projectId: eventProjectId || null,
              taskId: taskId || null,
              notes: eventNotes || null,
              tags: [...tags],
              startsAt: nextStart.toISOString(),
              endsAt: nextEnd.toISOString(),
              userId: eventUserId || undefined,
            });
          } else {
            const block = await createScheduledBlock({ title, startsAt: nextStart, endsAt: nextEnd, userId: eventUserId ?? session?.sub, projectId: eventProjectId, taskId, notes: eventNotes, tags: [...tags] });
            targetBlockId ??= block.id;
          }
        }
        toast.success(editingBlock ? "Scheduled work updated" : repeatMode === "none" ? "Work scheduled" : `${occurrences} work blocks scheduled`);
        if (conflicts.length > 0) toast.warning("This overlaps existing calendar work", { description: `${conflicts.length} conflict(s) detected. You allowed the overlap.` });
      } else {
        const response = await fetch("/api/timer/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: taskId || title,
            projectId: eventProjectId || undefined,
            description: eventNotes || title,
            tags: [...tags],
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
      if (targetBlockId) scrollBlockIntoView(targetBlockId);
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

  async function logCompletedBlock(block: ScheduledBlock) {
    openComposer({ mode: "calendar", block });
  }

  async function moveToNextOpenSlot(block: ScheduledBlock) {
    const nextSlot = findNextOpenSlot(new Date(block.endsAt), minuteDuration(block.startsAt, block.endsAt), block.userId, block.id);
    if (!nextSlot) {
      toast.error("No open slot found in the next 35 days.");
      return;
    }
    try {
      await patchBlock(block.id, { startsAt: nextSlot.startsAt.toISOString(), endsAt: nextSlot.endsAt.toISOString() }, "Moved to next open slot");
      setSelectedBlock(null);
      setDraft(null);
    } catch (error) {
      toast.error("Could not move work", { description: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  async function duplicateBlock(block: ScheduledBlock) {
    const duration = minuteDuration(block.startsAt, block.endsAt);
    const nextSlot = findNextOpenSlot(new Date(block.endsAt), duration, block.userId, block.id) ?? { startsAt: new Date(new Date(block.endsAt).getTime() + SLOT_MINUTES * 60000), endsAt: new Date(new Date(block.endsAt).getTime() + (duration + SLOT_MINUTES) * 60000) };
    try {
      await createScheduledBlock({
        title: block.title,
        startsAt: nextSlot.startsAt,
        endsAt: nextSlot.endsAt,
        userId: block.userId,
        projectId: block.projectId,
        taskId: block.taskId,
        notes: block.notes,
        tags: block.tags,
      });
      toast.success("Block duplicated");
      setSelectedBlock(null);
      await fetchData();
    } catch (error) {
      toast.error("Could not duplicate block", { description: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  async function skipBlock(block: ScheduledBlock) {
    try {
      await patchBlock(block.id, { status: "skipped" }, "Scheduled work skipped");
      setSelectedBlock(null);
    } catch (error) {
      toast.error("Could not skip work", { description: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  async function cancelBlock(block: ScheduledBlock) {
    const response = await fetch(`/api/schedule?blockId=${encodeURIComponent(block.id)}`, { method: "DELETE" });
    if (!response.ok) toast.error("Could not cancel scheduled work");
    else toast.success("Scheduled work canceled");
    setSelectedBlock(null);
    await fetchData();
  }

  function beginSlotDrag(event: ReactPointerEvent<HTMLElement>, lane: Lane) {
    if (event.button !== 0) return;
    const column = event.currentTarget.closest<HTMLElement>("[data-day-column]");
    if (!column) return;
    const columnTop = column.getBoundingClientRect().top;
    const startMinute = minuteFromPointer(event.clientY, columnTop);
    const currentMinute = Math.min(startMinute + 60, visibleEndMinutes);
    const selection = normalizedSelection(lane.date, startMinute, currentMinute);
    event.preventDefault();
    setMovingBlockId(null);
    setSelectedBlock(null);
    setQuickTitle("Focus block");
    setDraft({ kind: "selection", ...selection, userId: lane.userId ?? session?.sub, x: event.clientX, y: event.clientY });
    setDragState({ kind: "selection", day: lane.date, userId: lane.userId ?? session?.sub, columnTop, startMinute, currentMinute, x: event.clientX, y: event.clientY });
  }

  function beginBlockMove(event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>, block: ScheduledBlock, day: Date) {
    if (event.button !== 0) return;
    const column = event.currentTarget.closest<HTMLElement>("[data-day-column]");
    if (!column) return;
    const columnTop = column.getBoundingClientRect().top;
    const startMinute = dayMinute(day, block.startsAt);
    const endMinute = dayMinute(day, block.endsAt);
    const durationMinutes = Math.max(MIN_BLOCK_MINUTES, snapMinute(endMinute - startMinute));
    const pointerMinute = minuteFromPointer(event.clientY, columnTop);
    const grabOffsetMinutes = clamp(pointerMinute - startMinute, 0, Math.max(SLOT_MINUTES, durationMinutes - SLOT_MINUTES));
    event.preventDefault();
    event.stopPropagation();
    setSelectedBlock(null);
    setMovingBlockId(block.id);
    setDraft({ kind: "move", block, startsAt: new Date(block.startsAt), endsAt: new Date(block.endsAt), userId: block.userId, x: event.clientX, y: event.clientY });
    setDragState({ kind: "move", block, columnTop, dayKey: dateKey(day), durationMinutes, grabOffsetMinutes, currentStartMinute: startMinute, x: event.clientX, y: event.clientY });
  }

  function beginBlockResize(event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>, block: ScheduledBlock, day: Date, edge: ResizeEdge) {
    if (event.button !== 0) return;
    const column = event.currentTarget.closest<HTMLElement>("[data-day-column]");
    if (!column) return;
    const columnTop = column.getBoundingClientRect().top;
    const startMinute = dayMinute(day, block.startsAt);
    const endMinute = dayMinute(day, block.endsAt);
    event.preventDefault();
    event.stopPropagation();
    setSelectedBlock(null);
    setMovingBlockId(block.id);
    setDraft({ kind: "resize", block, startsAt: new Date(block.startsAt), endsAt: new Date(block.endsAt), edge, userId: block.userId, x: event.clientX, y: event.clientY });
    setDragState({ kind: "resize", block, day, columnTop, edge, fixedMinute: edge === "start" ? endMinute : startMinute, currentMinute: edge === "start" ? startMinute : endMinute, x: event.clientX, y: event.clientY });
  }

  async function applyDraftMove() {
    if (!draft || !draft.block) return;
    setReschedulingBlock(true);
    try {
      await patchBlock(draft.block.id, {
        startsAt: draft.startsAt.toISOString(),
        endsAt: draft.endsAt.toISOString(),
        userId: draft.userId || undefined,
      }, draft.kind === "resize" ? "Scheduled work resized" : "Scheduled work moved");
      setDraft(null);
      setMovingBlockId(null);
    } catch (error) {
      toast.error(draft.kind === "resize" ? "Could not resize scheduled work" : "Could not move scheduled work", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setReschedulingBlock(false);
    }
  }

  async function nudgeBlock(block: ScheduledBlock, minutes: number, days = 0) {
    const startsAt = addDays(new Date(block.startsAt), days);
    const endsAt = addDays(new Date(block.endsAt), days);
    startsAt.setMinutes(startsAt.getMinutes() + minutes);
    endsAt.setMinutes(endsAt.getMinutes() + minutes);
    try {
      await patchBlock(block.id, { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() });
    } catch (error) {
      toast.error("Could not move scheduled work", { description: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  function handleBlockKeyDown(event: ReactKeyboardEvent<HTMLElement>, block: ScheduledBlock) {
    const step = event.shiftKey ? 60 : SLOT_MINUTES;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      nudgeBlock(block, -step);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      nudgeBlock(block, step);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      nudgeBlock(block, 0, -1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      nudgeBlock(block, 0, 1);
    }
  }

  const weekRangeLabel = `${weekDays[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${weekDays[6].toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const missedBlocks = blocks.filter((block) => block.status === "planned" && !isUnavailableBlock(block) && new Date(block.endsAt).getTime() < Date.now()).slice(0, 5);
  const upcomingBlocks = blocks.filter((block) => {
    const untilStart = new Date(block.startsAt).getTime() - Date.now();
    return block.status === "planned" && !isUnavailableBlock(block) && untilStart >= 0 && untilStart <= 10 * 60 * 1000;
  }).slice(0, 3);

  function blockClasses(block: ScheduledBlock) {
    if (isUnavailableBlock(block)) return "border-slate-300 bg-slate-100 text-slate-700";
    if (block.status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-900";
    if (block.status === "in_progress") return "border-blue-200 bg-blue-50 text-blue-900";
    if (block.status === "skipped") return "border-amber-200 bg-amber-50 text-amber-800";
    return "border-cyan-200 bg-cyan-50 text-cyan-950";
  }

  function blockAccentClasses(block: ScheduledBlock) {
    if (isUnavailableBlock(block)) return "text-slate-600";
    if (block.status === "completed") return "text-emerald-700";
    if (block.status === "in_progress") return "text-blue-700";
    if (block.status === "skipped") return "text-amber-700";
    return "text-cyan-700";
  }

  function canOperateOwnTime(block: ScheduledBlock) {
    return Boolean(session?.sub && block.userId === session.sub);
  }

  function renderBlock(block: ScheduledBlock, lane: Lane, index: number) {
    const style = clampEventStyle(lane.date, block.startsAt, block.endsAt);
    const isMoving = movingBlockId === block.id || (draft?.block?.id === block.id);
    const unavailable = isUnavailableBlock(block);
    const accent = blockAccentClasses(block);
    return (
      <article
        key={block.id}
        data-testid="calendar-block"
        data-calendar-block-id={block.id}
        tabIndex={0}
        aria-label={`${block.title} ${statusLabel(block)} ${timeLabel(block.startsAt)} to ${timeLabel(block.endsAt)}`}
        onKeyDown={(event) => handleBlockKeyDown(event, block)}
        onPointerDownCapture={(event) => {
          if ((event.target as HTMLElement).closest("[data-calendar-drag-handle='true']")) beginBlockMove(event, block, lane.date);
        }}
        onMouseDownCapture={(event) => {
          if ((event.target as HTMLElement).closest("[data-calendar-drag-handle='true']")) beginBlockMove(event, block, lane.date);
        }}
        className={`absolute left-1 right-1 overflow-hidden rounded-xl border p-2 text-xs shadow-sm transition focus:outline-none focus:ring-2 focus:ring-cyan-500 ${blockClasses(block)} ${isMoving ? "opacity-40 ring-2 ring-cyan-300" : "hover:shadow-md"}`}
        style={{ top: style.top + index * 3, height: style.height }}
        onClick={(event) => {
          if (movingBlockId === block.id || draft?.block?.id === block.id) return;
          setSelectedBlock({ block, x: event.clientX, y: event.clientY });
        }}
      >
        {!unavailable && block.status !== "completed" && block.status !== "skipped" && (
          <button type="button" data-testid="calendar-block-resize-start" onPointerDown={(event) => beginBlockResize(event, block, lane.date, "start")} onMouseDown={(event) => beginBlockResize(event, block, lane.date, "start")} onClick={(event) => event.stopPropagation()} className="absolute left-4 right-4 top-0 h-2 cursor-ns-resize rounded-b-full bg-white/60 hover:bg-white" aria-label={`Resize start for ${block.title}`} />
        )}
        <div className="flex items-start justify-between gap-2">
          {!unavailable && block.status !== "completed" && block.status !== "skipped" ? (
            <button type="button" data-calendar-drag-handle="true" onPointerDown={(event) => beginBlockMove(event, block, lane.date)} onMouseDown={(event) => beginBlockMove(event, block, lane.date)} onClick={(event) => event.stopPropagation()} className="mt-0.5 rounded-md bg-white/75 p-0.5 transition hover:bg-white" aria-label={`Drag to reschedule ${block.title}`} title="Drag to reschedule">
              <GripVertical className={`h-3.5 w-3.5 ${accent}`} />
            </button>
          ) : <div className="h-4 w-4" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate font-bold">{block.title}</p>
              <span data-testid="calendar-block-status" className="shrink-0 rounded-full bg-white/75 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">{statusLabel(block)}</span>
            </div>
            <p className={`mt-0.5 truncate text-[10px] ${accent}`}>{timeLabel(block.startsAt)} - {timeLabel(block.endsAt)}</p>
          </div>
          {!unavailable && canOperateOwnTime(block) && block.status === "planned" && (
            <button onClick={(event) => { event.stopPropagation(); startBlock(block); }} className="rounded-full bg-white/70 p-1" aria-label="Start timer from scheduled work"><Play className={`h-3 w-3 fill-current ${accent}`} /></button>
          )}
        </div>
        <div className={`mt-1 flex flex-wrap gap-2 text-[10px] font-bold ${accent}`}>
          {!unavailable && canOperateOwnTime(block) && block.status !== "completed" && <button onClick={(event) => { event.stopPropagation(); logCompletedBlock(block); }} className="inline-flex items-center gap-1"><SquarePen className="h-3 w-3" />Log</button>}
          {!unavailable && <button onClick={(event) => { event.stopPropagation(); moveToNextOpenSlot(block); }}>Next slot</button>}
          {block.status === "planned" && !unavailable && <button onClick={(event) => { event.stopPropagation(); skipBlock(block); }}>Skip</button>}
        </div>
        {!unavailable && block.status !== "completed" && block.status !== "skipped" && (
          <button type="button" data-testid="calendar-block-resize-end" onPointerDown={(event) => beginBlockResize(event, block, lane.date, "end")} onMouseDown={(event) => beginBlockResize(event, block, lane.date, "end")} onClick={(event) => event.stopPropagation()} className="absolute bottom-0 left-4 right-4 h-2 cursor-ns-resize rounded-t-full bg-white/60 hover:bg-white" aria-label={`Resize end for ${block.title}`} />
        )}
      </article>
    );
  }

  function renderGrid() {
    const gridTemplateColumns = viewMode === "team"
      ? `72px repeat(${Math.max(1, lanes.length)}, minmax(170px, 1fr))`
      : "72px repeat(7, minmax(130px, 1fr))";
    return (
      <div className="min-h-0 flex-1 overflow-auto">
        <div className={viewMode === "team" ? "min-w-[1080px]" : "min-w-[1040px]"}>
          <div className="grid border-b border-slate-200 bg-slate-50 text-sm" style={{ gridTemplateColumns }}>
            <div className="border-r border-slate-200 px-3 py-3 text-xs font-bold uppercase tracking-wide text-slate-400">Time</div>
            {lanes.map((lane) => {
              const isToday = dateKey(lane.date) === dateKey(new Date());
              return (
                <div key={lane.key} className={`border-r border-slate-200 px-3 py-3 ${isToday ? "bg-cyan-50" : ""}`}>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{viewMode === "team" ? lane.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : lane.date.toLocaleDateString(undefined, { weekday: "short" })}</p>
                  <p className={`mt-1 truncate text-lg font-semibold ${isToday ? "text-cyan-700" : "text-slate-950"}`}>{viewMode === "team" ? lane.label : lane.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
                </div>
              );
            })}
          </div>
          <div className="grid" style={{ gridTemplateColumns }}>
            <div className="border-r border-slate-200 bg-slate-50">
              {hours.map((hour) => <div key={hour} className="border-b border-slate-200 px-2 py-2 text-right text-[11px] font-semibold text-slate-400" style={{ height: HOUR_HEIGHT }}>{timeLabel(new Date(2020, 0, 1, hour))}</div>)}
            </div>
            {lanes.map((lane) => {
              const planned = blocksForLane(lane).filter((block) => visibleInHourRange(lane.date, block.startsAt, block.endsAt));
              const logged = entriesForLane(lane).filter((entry) => visibleInHourRange(lane.date, entry.startedAt, entryEnd(entry)));
              const draftForLane = draft && dateKey(draft.startsAt) === dateKey(lane.date) && (!lane.userId || !draft.userId || draft.userId === lane.userId) ? draft : null;
              const hasWork = planned.length > 0 || logged.length > 0;
              return (
                <div key={lane.key} data-day-column data-day-key={dateKey(lane.date)} data-user-id={lane.userId ?? ""} className="relative border-r border-slate-200" style={{ height: hours.length * HOUR_HEIGHT }}>
                  {hours.map((hour) => {
                    const slotStart = new Date(`${dateKey(lane.date)}T${String(hour).padStart(2, "0")}:00`);
                    return (
                      <button key={`${lane.key}-${hour}`} type="button" data-calendar-slot="true" onPointerDown={(event) => beginSlotDrag(event, lane)} className="block w-full border-b border-slate-100 px-2 text-left text-[11px] text-transparent transition hover:bg-cyan-50 hover:text-cyan-700" style={{ height: HOUR_HEIGHT }} aria-label={`Schedule work ${lane.label} ${timeLabel(slotStart)}`}>Drag to add</button>
                    );
                  })}
                  {!hasWork && <div data-testid="calendar-empty-day-hint" className="pointer-events-none absolute left-3 right-3 top-4 rounded-2xl border border-dashed border-slate-200 bg-white/70 p-3 text-xs text-slate-400">Drag here to plan work, log time, or mark unavailable.</div>}
                  {draftForLane && (
                    <div className={`pointer-events-none absolute left-1 right-1 z-20 rounded-2xl border-2 border-dashed p-2 text-xs shadow-lg ${draftForLane.kind === "selection" ? "border-cyan-500 bg-cyan-100/85 text-cyan-950" : "border-slate-400 bg-white/90 text-slate-800"}`} style={clampEventStyle(lane.date, draftForLane.startsAt, draftForLane.endsAt)}>
                      <p className="font-bold">{draftForLane.kind === "resize" ? "Resize block" : draftForLane.kind === "move" ? "Move block here" : "New work block"}</p>
                      <p className="mt-0.5 text-[10px]">{timeLabel(draftForLane.startsAt)} - {timeLabel(draftForLane.endsAt)}</p>
                    </div>
                  )}
                  {planned.map((block, index) => renderBlock(block, lane, index))}
                  {logged.map((entry, index) => {
                    const style = clampEventStyle(lane.date, entry.startedAt, entryEnd(entry));
                    const color = entry.source === "manual" ? "border-amber-200 bg-amber-50 text-amber-800" : entry.source === "calendar" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-700";
                    return <article key={entry.id} className={`absolute left-2 right-2 rounded-xl border p-2 text-xs shadow-sm ${color}`} style={{ top: style.top + 18 + index * 4, height: Math.min(style.height, 48) }}><p className="truncate font-bold">{entry.taskId || "Logged time"}</p><p className="mt-0.5 text-[10px]">{timeLabel(entry.startedAt)} - {timeLabel(entryEnd(entry))}</p></article>;
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const draftConflicts = draft ? conflictsForRange(draft.startsAt, draft.endsAt, draft.userId ?? session?.sub, draft.block?.id) : [];
  const selectedBlockConflicts = selectedBlock ? conflictsForRange(new Date(selectedBlock.block.startsAt), new Date(selectedBlock.block.endsAt), selectedBlock.block.userId, selectedBlock.block.id) : [];
  const composerConflicts = composerMode !== "calendar" ? conflictsForRange(new Date(eventStart), new Date(eventEnd), eventUserId ?? session?.sub, editingBlock?.id) : [];
  const popoverStyle = draft && !isMobile && typeof window !== "undefined" ? {
    left: Math.min(Math.max(16, draft.x + 14), Math.max(16, window.innerWidth - 384)),
    top: Math.min(Math.max(16, draft.y + 14), Math.max(16, window.innerHeight - 320)),
  } : undefined;
  const selectedStyle = selectedBlock && !isMobile && typeof window !== "undefined" ? {
    left: Math.min(Math.max(16, selectedBlock.x + 14), Math.max(16, window.innerWidth - 400)),
    top: Math.min(Math.max(16, selectedBlock.y + 14), Math.max(16, window.innerHeight - 380)),
  } : undefined;

  return (
    <div className="flex h-full flex-col gap-5">
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.22em] text-cyan-700"><CalendarClock className="h-4 w-4" /> Calendar operations</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Block the week. Log what happened.</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">Drag empty space to block time, use handles to resize, recover missed work, or switch to team lanes when assigning schedules.</p>
            <div data-testid="calendar-timezone-cue" className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              <Clock className="h-3.5 w-3.5" /> Times shown in {userTimezone} ({timezoneLabel(userTimezone)}){browserTimezone !== userTimezone ? ` · Browser ${browserTimezone}` : ""}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => openComposer({ mode: "scheduled" })} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800"><CalendarPlus className="h-4 w-4" /> Schedule work</button>
            <button onClick={() => openComposer({ mode: "calendar" })} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700"><CheckCircle2 className="h-4 w-4" /> Log completed time</button>
            <button onClick={() => openComposer({ mode: "unavailable" })} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-slate-400 hover:text-slate-950"><Bell className="h-4 w-4" /> Mark unavailable</button>
          </div>
        </div>
      </div>

      {(upcomingBlocks.length > 0 || missedBlocks.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {upcomingBlocks.length > 0 && <div className="rounded-[24px] border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900"><div className="flex items-center gap-2 font-bold"><Bell className="h-4 w-4" /> Starting soon</div>{upcomingBlocks.map((block) => <p key={block.id} className="mt-2">{block.title} starts at {timeLabel(block.startsAt)}.</p>)}</div>}
          {missedBlocks.length > 0 && <div className="rounded-[24px] border border-amber-100 bg-amber-50 p-4 text-sm text-amber-900"><div className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" /> Missed planned work</div><div className="mt-2 space-y-2">{missedBlocks.map((block) => <div key={block.id} className="flex flex-wrap items-center justify-between gap-2"><span>{block.title} · {timeLabel(block.startsAt)}</span><span className="flex gap-2"><button className="font-bold underline" onClick={() => logCompletedBlock(block)}>Log it</button><button className="font-bold underline" onClick={() => moveToNextOpenSlot(block)}>Reschedule</button><button className="font-bold underline" onClick={() => skipBlock(block)}>Skip</button></span></div>)}</div></div>}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-visible rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">{viewMode === "week" ? weekRangeLabel : viewMode === "team" ? `${currentDate.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })} team lanes` : `${currentDate.toLocaleString("default", { month: "long" })} ${currentDate.getFullYear()}`}</h2>
            <p className="text-sm text-slate-500">{viewMode === "team" ? "Assign work across members without leaving the calendar." : viewMode === "week" ? `${visibleStartHour}:00 to ${visibleEndHour === 24 ? "midnight" : `${visibleEndHour}:00`} with 15-minute drag scheduling.` : "Month overview for spotting planned and logged work."}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-full bg-slate-100 p-1">
              <button onClick={() => setViewMode("week")} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-bold transition ${viewMode === "week" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"}`}><CalendarDays className="h-4 w-4" />Week</button>
              {isManager && <button onClick={() => setViewMode("team")} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-bold transition ${viewMode === "team" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"}`}><UsersRound className="h-4 w-4" />Team</button>}
              <button onClick={() => setViewMode("month")} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-bold transition ${viewMode === "month" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"}`}><LayoutGrid className="h-4 w-4" />Month</button>
            </div>
            <select aria-label="Visible start hour" value={visibleStartHour} onChange={(event) => setVisibleStartHour(Number(event.target.value))} className="h-10 rounded-xl border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-700">{Array.from({ length: 23 }, (_, i) => i).map((hour) => <option key={hour} value={hour}>{timeLabel(new Date(2020, 0, 1, hour))}</option>)}</select>
            <select aria-label="Visible end hour" value={visibleEndHour} onChange={(event) => setVisibleEndHour(Number(event.target.value))} className="h-10 rounded-xl border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-700">{Array.from({ length: 24 }, (_, i) => i + 1).map((hour) => <option key={hour} value={hour}>{hour === 24 ? "Midnight" : timeLabel(new Date(2020, 0, 1, hour))}</option>)}</select>
            <button onClick={saveWorkingHours} disabled={savingHours} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">{savingHours ? "Saving..." : "Save hours"}</button>
            <button onClick={() => setCurrentDate(viewMode === "month" ? new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1) : addDays(currentDate, viewMode === "team" ? -1 : -7))} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" aria-label="Previous period"><ChevronLeft className="h-5 w-5" /></button>
            <button onClick={() => setCurrentDate(new Date())} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Today</button>
            <button onClick={() => setCurrentDate(viewMode === "month" ? new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1) : addDays(currentDate, viewMode === "team" ? 1 : 7))} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" aria-label="Next period"><ChevronRight className="h-5 w-5" /></button>
          </div>
        </div>

        {loading ? <div className="p-10 text-center text-slate-500">Loading calendar...</div> : viewMode === "month" ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid grid-cols-7 bg-slate-50 text-center text-xs font-bold uppercase tracking-wider text-slate-500">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="border-b border-slate-200 py-3">{day}</div>)}</div>
            <div className="grid min-h-full grid-cols-7 auto-rows-[minmax(155px,1fr)]">
              {monthDays.map((cell, index) => {
                if (!cell) return <div key={`empty-${index}`} className="border-b border-r border-slate-100 bg-slate-50/60" />;
                const cellDate = new Date(`${cell.dateStr}T00:00`);
                const lane = { key: cell.dateStr, label: cell.dateStr, date: cellDate, userId: session?.sub };
                const blocksForDay = blocksForLane(lane);
                const entriesForDay = entriesForLane(lane);
                const totalSeconds = entriesForDay.reduce((sum, entry) => sum + (entry.durationSeconds || 0), 0);
                const isToday = cell.dateStr === dateKey(new Date());
                return <div key={cell.dateStr} onDoubleClick={() => openComposer({ dateStr: cell.dateStr, mode: "scheduled" })} className={`border-b border-r border-slate-100 p-2 ${isToday ? "bg-cyan-50" : "bg-white"}`}><div className="mb-2 flex items-center justify-between"><span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${isToday ? "bg-cyan-600 text-white" : "text-slate-500"}`}>{cell.dayNumber}</span><button onClick={() => openComposer({ dateStr: cell.dateStr, mode: "scheduled" })} className="rounded-full p-1 text-slate-300 hover:bg-slate-100 hover:text-cyan-700" aria-label="Add calendar event"><Plus className="h-3 w-3" /></button></div><div className="space-y-1.5">{blocksForDay.slice(0, 3).map((block) => <div key={block.id} onClick={(event) => setSelectedBlock({ block, x: event.clientX, y: event.clientY })} className={`cursor-pointer rounded-xl border px-2 py-1.5 text-xs transition ${blockClasses(block)}`}><div className="flex items-center justify-between gap-2"><span className="truncate font-semibold">{block.title}</span><span className="text-[9px] font-bold uppercase">{statusLabel(block)}</span></div><div className="mt-1 text-[10px]">{timeLabel(block.startsAt)} - {timeLabel(block.endsAt)}</div></div>)}{totalSeconds > 0 && <div className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700"><span className="flex items-center gap-1"><Clock className="h-3 w-3" />Logged</span><strong>{formatHours(totalSeconds)}</strong></div>}{blocksForDay.length === 0 && totalSeconds === 0 && <div className="rounded-xl border border-dashed border-slate-200 px-2 py-2 text-[10px] font-semibold text-slate-400">No planned work. Click + to add.</div>}</div></div>;
              })}
            </div>
          </div>
        ) : renderGrid()}
      </div>

      {draft && !composerOpen && (
        <div className={`fixed z-[70] rounded-3xl border border-slate-200 bg-white p-4 text-slate-950 shadow-2xl ${isMobile ? "inset-x-3 bottom-3" : "w-[22rem]"}`} style={popoverStyle} role="dialog" aria-label={draft.kind === "selection" ? "Create calendar work block" : draft.kind === "resize" ? "Resize scheduled work" : "Move scheduled work"}>
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">{draft.kind === "selection" ? "Selected time" : draft.kind === "resize" ? "Resize" : "Reschedule"}</p><h3 className="mt-1 text-lg font-semibold">{draft.block?.title ?? "Fill this schedule block"}</h3><p className="mt-1 text-sm text-slate-500">{draft.startsAt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {timeLabel(draft.startsAt)} - {timeLabel(draft.endsAt)}</p></div><button onClick={() => { setDraft(null); setMovingBlockId(null); }} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Dismiss calendar selection"><X className="h-4 w-4" /></button></div>
          {draftConflicts.length > 0 && <div data-testid="calendar-conflict-warning" className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><div className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" />{draftConflicts.length} conflict(s)</div><p className="mt-1">Overlaps {draftConflicts.slice(0, 2).map((conflict) => conflict.label).join(", ")}.</p></div>}
          {draft.kind === "selection" ? <div className="mt-4 space-y-3"><input value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500" placeholder="Work title" /><div className="flex flex-wrap gap-2"><button onClick={() => createQuickDraft()} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Save plan</button><button onClick={() => openComposerFromDraft("calendar")} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Log completed</button><button onClick={() => openComposerFromDraft("unavailable")} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Unavailable</button></div>{draftConflicts.length > 0 && <div className="flex flex-wrap gap-2 text-xs"><button onClick={() => { const next = findNextOpenSlot(draft.endsAt, minuteDuration(draft.startsAt, draft.endsAt), draft.userId ?? session?.sub); if (next) setDraft({ ...draft, ...next }); }} className="font-bold text-cyan-700 underline">Move next open</button><button onClick={() => createQuickDraft({ shorten: true })} className="font-bold text-cyan-700 underline">Shorten</button><button onClick={() => createQuickDraft({ replace: true })} className="font-bold text-cyan-700 underline">Replace planned</button></div>}<button onClick={() => openComposerFromDraft("scheduled")} className="text-xs font-bold text-slate-500 underline">Plan work</button></div> : <div className="mt-4 flex flex-wrap gap-2"><button onClick={applyDraftMove} disabled={reschedulingBlock} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{reschedulingBlock ? "Saving..." : draft.kind === "resize" ? "Resize block" : "Move block"}</button>{draft.block && <button onClick={() => { openComposer({ mode: "scheduled", block: draft.block }); setDraft(null); setMovingBlockId(null); }} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Edit details</button>}</div>}
        </div>
      )}

      {selectedBlock && !composerOpen && (
        <div className={`fixed z-[70] rounded-3xl border border-slate-200 bg-white p-4 text-slate-950 shadow-2xl ${isMobile ? "inset-x-3 bottom-3" : "w-[23rem]"}`} style={selectedStyle} role="dialog" aria-label="Scheduled work actions">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">{statusLabel(selectedBlock.block)}</p><h3 className="mt-1 text-lg font-semibold">{selectedBlock.block.title}</h3><p className="mt-1 text-sm text-slate-500">{timeLabel(selectedBlock.block.startsAt)} - {timeLabel(selectedBlock.block.endsAt)}</p></div><button onClick={() => setSelectedBlock(null)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close scheduled work actions"><X className="h-4 w-4" /></button></div>
          {selectedBlockConflicts.length > 0 && <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><AlertTriangle className="mr-1 inline h-4 w-4" />Overlaps {selectedBlockConflicts.length} item(s).</div>}
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm font-semibold">
            {!isUnavailableBlock(selectedBlock.block) && canOperateOwnTime(selectedBlock.block) && selectedBlock.block.status === "planned" && <button onClick={() => startBlock(selectedBlock.block)} className="rounded-xl bg-slate-950 px-3 py-2 text-white"><Play className="mr-1 inline h-4 w-4" />Start</button>}
            {!isUnavailableBlock(selectedBlock.block) && canOperateOwnTime(selectedBlock.block) && selectedBlock.block.status !== "completed" && <button onClick={() => logCompletedBlock(selectedBlock.block)} className="rounded-xl border border-slate-200 px-3 py-2 text-slate-700"><CheckCircle2 className="mr-1 inline h-4 w-4" />Complete</button>}
            <button onClick={() => duplicateBlock(selectedBlock.block)} className="rounded-xl border border-slate-200 px-3 py-2 text-slate-700"><Copy className="mr-1 inline h-4 w-4" />Duplicate</button>
            <button onClick={() => moveToNextOpenSlot(selectedBlock.block)} className="rounded-xl border border-slate-200 px-3 py-2 text-slate-700"><SkipForward className="mr-1 inline h-4 w-4" />Next slot</button>
            <button onClick={() => openComposer({ mode: isUnavailableBlock(selectedBlock.block) ? "unavailable" : "scheduled", block: selectedBlock.block })} className="rounded-xl border border-slate-200 px-3 py-2 text-slate-700"><Pencil className="mr-1 inline h-4 w-4" />Edit</button>
            {selectedBlock.block.status === "planned" && !isUnavailableBlock(selectedBlock.block) && <button onClick={() => skipBlock(selectedBlock.block)} className="rounded-xl border border-slate-200 px-3 py-2 text-slate-700">Skip</button>}
            <button onClick={() => cancelBlock(selectedBlock.block)} className="rounded-xl border border-red-100 px-3 py-2 text-red-700"><Trash2 className="mr-1 inline h-4 w-4" />Cancel</button>
          </div>
          <p className="mt-3 text-xs text-slate-500">Keyboard: focus a block, then use arrows to nudge by 15 minutes or days. Hold Shift for one-hour vertical moves.</p>
        </div>
      )}

      {composerOpen && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Calendar event composer">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] border border-slate-200 bg-white text-slate-950 shadow-2xl sm:rounded-[28px]">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5"><div><div className="flex items-center gap-2 text-sm font-semibold text-cyan-700">{composerMode === "scheduled" ? <CalendarPlus className="h-4 w-4" /> : composerMode === "unavailable" ? <Bell className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{editingBlock ? "Edit calendar work" : "New calendar work"}</div><h2 className="mt-1 text-2xl font-semibold tracking-tight">{composerMode === "scheduled" ? "Schedule work" : composerMode === "unavailable" ? "Mark unavailable" : "Log completed work"}</h2><p className="mt-1 text-sm text-slate-500">Use calendar-style details, recurrence, and assignment without leaving the planning surface.</p></div><button onClick={() => setComposerOpen(false)} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Close calendar composer"><X className="h-5 w-5" /></button></div>
            <div className="border-b border-slate-100 px-6 py-4"><div className="inline-flex rounded-full bg-slate-100 p-1"><button onClick={() => setComposerMode("scheduled")} className={`rounded-full px-4 py-2 text-sm font-bold transition ${composerMode === "scheduled" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"}`}>Scheduled work</button><button onClick={() => setComposerMode("calendar")} className={`rounded-full px-4 py-2 text-sm font-bold transition ${composerMode === "calendar" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"}`}>Completed time</button><button onClick={() => setComposerMode("unavailable")} className={`rounded-full px-4 py-2 text-sm font-bold transition ${composerMode === "unavailable" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"}`}>Unavailable</button></div></div>
            {composerConflicts.length > 0 && <div className="mx-6 mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mr-2 inline h-4 w-4" />This time overlaps {composerConflicts.length} calendar item(s). Saving will allow the overlap.</div>}
            <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">Title<input value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" placeholder="Client review, proposal writing, design QA" /></label>
              <label className="space-y-1 text-sm font-medium text-slate-700">Project<select value={eventProjectId} onChange={(event) => setEventProjectId(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white"><option value="">No project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
              <label className="space-y-1 text-sm font-medium text-slate-700">Work label<input value={eventTaskId} onChange={(event) => setEventTaskId(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" placeholder="Client call, research review, design QA" /></label>
              {isManager && composerMode !== "calendar" && <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">Assignee<select value={eventUserId ?? session?.sub ?? ""} onChange={(event) => setEventUserId(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white">{members.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}</select></label>}
              <label className="space-y-1 text-sm font-medium text-slate-700">Starts<input type="datetime-local" value={eventStart} onChange={(event) => setEventStart(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" /></label>
              <label className="space-y-1 text-sm font-medium text-slate-700">Ends<input type="datetime-local" value={eventEnd} onChange={(event) => setEventEnd(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" /></label>
              {composerMode !== "calendar" && !editingBlock && <><label className="space-y-1 text-sm font-medium text-slate-700">Repeat<Repeat className="ml-1 inline h-3 w-3" /><select value={repeatMode} onChange={(event) => setRepeatMode(event.target.value as RepeatMode)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white"><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label><label className="space-y-1 text-sm font-medium text-slate-700">Occurrences<input type="number" min={1} max={MAX_REPEAT_COUNT} value={repeatCount} onChange={(event) => setRepeatCount(Number(event.target.value))} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" /></label></>}
              <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">Notes<input value={eventNotes} onChange={(event) => setEventNotes(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" placeholder="What should happen during this block?" /></label>
              <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">Tags<input value={eventTags} onChange={(event) => setEventTags(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" placeholder="research, review, billable" /></label>
            </div>
            <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2 text-sm text-slate-500"><Pencil className="h-4 w-4" />{composerMode === "scheduled" ? "Creates scheduled work visible on Dashboard and exports." : composerMode === "unavailable" ? "Blocks unavailable time and hides timer actions." : "Creates a completed time entry with source calendar."}</div><div className="flex gap-2"><button onClick={() => setComposerOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white">Cancel</button><button onClick={saveEvent} disabled={savingEvent} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">{savingEvent ? "Saving..." : composerMode === "scheduled" ? "Save scheduled work" : composerMode === "unavailable" ? "Save unavailable block" : "Log completed work"}</button></div></div>
          </div>
        </div>
      )}
    </div>
  );
}
