"use client";
import { moveCalendarRange } from "@/lib/calendar-move";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  AlertTriangle,
  Bell,
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
import { isUnavailableScheduledBlock } from "@/lib/scheduled-block-guards";
import { ModalDialog } from "@/components/modal-dialog";
import { packCalendarIntervals, type CalendarColumn } from "@/lib/calendar-layout";

type TimeEntry = {
  id: string;
  userId: string;
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number | null;
  isPaused?: boolean;
  pausedAt?: string | null;
  taskId?: string;
  projectId?: string | null;
  scheduledBlockId?: string | null;
  source: "web" | "calendar" | "manual";
};

type Project = { id: string; name: string };
type Action = { id: string; name: string; hourlyRate?: number | null };
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
  linkedTimeEntryId?: string | null;
  updatedAt?: string;
  hasRecordedTime?: boolean;
  isImported?: boolean;
};

type ScheduleBatch = {
  operationId: string;
  title: string;
  userId?: string | null;
  projectId?: string | null;
  actionId?: string | null;
  taskId?: string | null;
  notes?: string | null;
  tags: string[];
  occurrences: Array<{ startsAt: string; endsAt: string }>;
  replace?: Array<{ blockId: string; expectedUpdatedAt: string }>;
};

type ComposerMode = "scheduled" | "calendar" | "unavailable";
type ViewMode = "day" | "week" | "team" | "month";
type ResizeEdge = "start" | "end";
type RepeatMode = "none" | "daily" | "weekly";

type OpenComposerOptions = {
  mode?: ComposerMode;
  dateStr?: string;
  startAt?: Date;
  endAt?: Date;
  block?: ScheduledBlock | null;
  userId?: string | null;
  trigger?: HTMLElement;
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
  clockError?: string;
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
const RECOVERY_MAX_AGE = 24 * 60 * 60 * 1000;
const RECOVERY_WARNING = "This browser could not keep a recovery copy. Keep this page open and retry the save before leaving.";

function recordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function pendingScheduleKey(session: Session) {
  return `sowledger:schedule-pending:v1:${encodeURIComponent(session.workspaceId)}:${encodeURIComponent(session.sub)}`;
}

function readScheduleRecovery(raw: string, now: number): { payload: ScheduleBatch; expiresAt: number } | null {
  if (raw.length > 65536) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!recordValue(value) || value.version !== 1 || typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + RECOVERY_MAX_AGE || !recordValue(value.payload)) return null;
  const payload = value.payload;
  const allowed = new Set(["operationId", "title", "userId", "projectId", "actionId", "taskId", "notes", "tags", "occurrences", "replace"]);
  if (Object.keys(payload).some((key) => !allowed.has(key)) || typeof payload.operationId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(payload.operationId) || typeof payload.title !== "string" || !payload.title.trim() || payload.title.length > 255) return null;
  for (const key of ["userId", "projectId", "actionId", "taskId", "notes"]) {
    const text = payload[key];
    if (text !== undefined && text !== null && (typeof text !== "string" || text.length > (key === "notes" ? 50000 : 255))) return null;
  }
  if (!Array.isArray(payload.tags) || payload.tags.length > 100 || payload.tags.some((tag) => typeof tag !== "string" || tag.length > 1000)) return null;
  if (!Array.isArray(payload.occurrences) || payload.occurrences.length < 1 || payload.occurrences.length > MAX_REPEAT_COUNT || payload.occurrences.some((item) => !recordValue(item) || Object.keys(item).some((key) => !["startsAt", "endsAt"].includes(key)) || !canonicalTimestamp(item.startsAt) || !canonicalTimestamp(item.endsAt) || item.endsAt <= item.startsAt)) return null;
  if (payload.replace !== undefined && (!Array.isArray(payload.replace) || payload.replace.length > 100 || (payload.replace.length > 0 && payload.occurrences.length !== 1) || payload.replace.some((item) => !recordValue(item) || Object.keys(item).some((key) => !["blockId", "expectedUpdatedAt"].includes(key)) || typeof item.blockId !== "string" || !item.blockId || item.blockId.length > 255 || !canonicalTimestamp(item.expectedUpdatedAt)))) return null;
  return { payload: payload as ScheduleBatch, expiresAt: value.expiresAt };
}

function completeScheduleReceipt(value: unknown, request: ScheduleBatch): value is { ok: true; blockIds: string[]; replacedBlockIds: string[]; replayed: boolean; warnings: string[] } {
  if (!recordValue(value) || value.ok !== true || typeof value.replayed !== "boolean" || !Array.isArray(value.warnings) || value.warnings.some((warning) => typeof warning !== "string")) return false;
  if (!Array.isArray(value.blockIds) || value.blockIds.length !== request.occurrences.length || value.blockIds.some((id) => typeof id !== "string" || !id || id.length > 255) || new Set(value.blockIds).size !== value.blockIds.length) return false;
  const expected = new Set((request.replace ?? []).map((item) => item.blockId));
  return Array.isArray(value.replacedBlockIds) && value.replacedBlockIds.length === expected.size && new Set(value.replacedBlockIds).size === expected.size && value.replacedBlockIds.every((id) => typeof id === "string" && expected.has(id));
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localInput(date: Date) {
  return `${dateKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function composerDate(value: string, original?: string) {
  // Preserve the second occurrence of a repeated hour on notes-only edits.
  if (original && localInput(new Date(original)) === value) return new Date(original);
  return new Date(value);
}

function clockChangeHint(value: string, original?: string) {
  const date = composerDate(value, original);
  if (!Number.isFinite(date.getTime())) return null;
  if (localInput(date) !== value) {
    return { invalid: true, message: "This time does not exist because the clocks move forward. Choose another time." };
  }
  const first = new Date(value);
  const nextDay = addDays(first, 1);
  const repeatedMinutes = nextDay.getTimezoneOffset() - first.getTimezoneOffset();
  const second = new Date(first.getTime() + repeatedMinutes * 60000);
  if (repeatedMinutes <= 0 || localInput(second) !== value) return null;
  const offset = -date.getTimezoneOffset();
  const offsetLabel = `UTC${offset >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
  const usesSecond = date.getTimezoneOffset() === second.getTimezoneOffset();
  return { invalid: false, message: usesSecond ? `Second occurrence (${offsetLabel}). The saved time is preserved.` : `First occurrence (${offsetLabel}). New or changed times use the first occurrence.` };
}

/** Non-modal calendar actions keep the grid available; Escape returns to the opener. */
function CalendarPopover({ children, label, className, style, onClose, returnFocusRef }: {
  children: ReactNode;
  label: string;
  className: string;
  style?: CSSProperties;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = returnFocusRef.current;
    const element = elementRef.current;
    (element?.querySelector<HTMLElement>("input:not(:disabled)") ?? element?.querySelector<HTMLElement>("button:not(:disabled), a[href]") ?? element)?.focus({ preventScroll: true });
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, [returnFocusRef]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div ref={elementRef} tabIndex={-1} className={className} style={style} role="dialog" aria-label={label}>{children}</div>;
}

function formatHours(seconds: number) {
  return `${(seconds / 3600).toFixed(1)}h`;
}

function timeLabel(value: string | Date) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function timeRangeLabel(startsAt: string | Date, endsAt: string | Date) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).formatRange(new Date(startsAt), new Date(endsAt));
}

function offsetLabel(date: Date) {
  const offset = -date.getTimezoneOffset();
  return `UTC${offset >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
}

function intervalDisplayGuidance(startsAt: string | Date, endsAt: string | Date) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  const elapsed = seconds < 60 ? `${seconds} seconds` : `${Number((seconds / 60).toFixed(1))} ${seconds === 60 ? "minute" : "minutes"}`;
  const clockChanged = start.getTimezoneOffset() !== end.getTimezoneOffset();
  const folded = clockChanged && seconds > 0 && dayMinute(start, end) <= dayMinute(start, start);
  if (clockChanged) return `Clock change: ${timeLabel(start)} (${offsetLabel(start)}) to ${timeLabel(end)} (${offsetLabel(end)}), ${elapsed} elapsed.${folded ? " Shown as a minimum-size marker at the start time." : ""}`;
  return seconds < 15 * 60 ? `${elapsed} elapsed. Shown as a minimum-size marker; the saved times are unchanged.` : null;
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

function entryEnd(entry: TimeEntry, now: number) {
  if (entry.stoppedAt) return entry.stoppedAt;
  if (entry.isPaused && entry.pausedAt) return entry.pausedAt;
  return new Date(Math.max(new Date(entry.startedAt).getTime(), now)).toISOString();
}

function loggedSecondsForDay(day: Date, entry: TimeEntry) {
  if (!entry.stoppedAt || entry.durationSeconds == null) return 0;
  const start = new Date(entry.startedAt).getTime();
  const end = new Date(entry.stoppedAt).getTime();
  if (end <= start) return 0;
  const dayStart = new Date(`${dateKey(day)}T00:00`);
  const dayEnd = addDays(dayStart, 1);
  const from = Math.max(start, dayStart.getTime());
  const to = Math.min(end, dayEnd.getTime());
  if (to <= from) return 0;
  // Breaks are stored as an aggregate, not intervals. Allocate net duration
  // proportionally; differenced cumulative rounding preserves the total.
  const seconds = Math.max(0, entry.durationSeconds);
  return Math.floor(seconds * (to - start) / (end - start)) - Math.floor(seconds * (from - start) / (end - start));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function snapMinute(value: number) {
  return Math.round(value / SLOT_MINUTES) * SLOT_MINUTES;
}

function dayMinute(day: Date, value: string | Date) {
  const date = new Date(value);
  // Grid rows represent local clock time, not elapsed time since midnight.
  const dayOffset = (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(day.getFullYear(), day.getMonth(), day.getDate())) / 86400000;
  return dayOffset * 1440 + date.getHours() * 60 + date.getMinutes();
}

function dateAtMinute(day: Date, minute: number) {
  const date = new Date(`${dateKey(day)}T00:00`);
  // Match local Date/datetime-local semantics: missing hours move forward;
  // repeated hours choose the first occurrence. Existing timestamps remain stored in UTC.
  date.setMinutes(minute);
  return date;
}

function rangeAtMinutes(day: Date, startMinute: number, endMinute: number) {
  const startsAt = dateAtMinute(day, startMinute);
  const endsAt = dateAtMinute(day, endMinute);
  const missingTime = dayMinute(day, startsAt) !== startMinute || dayMinute(day, endsAt) !== endMinute;
  return { startsAt, endsAt, clockError: missingTime ? "The selected start or end time does not exist because the clocks move forward. Choose another slot." : undefined };
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
  return block.isImported === true || isUnavailableScheduledBlock(block);
}

function statusLabel(block: ScheduledBlock) {
  if (isUnavailableBlock(block)) return "Unavailable";
  if (block.status === "in_progress") return "Running";
  return block.status.charAt(0).toUpperCase() + block.status.slice(1);
}

function minuteDuration(startsAt: Date | string, endsAt: Date | string) {
  return (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000;
}

export function CalendarView() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [session, setSession] = useState<Session | null>(null);
  const [userTimezone, setUserTimezone] = useState("UTC");
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [blocks, setBlocks] = useState<ScheduledBlock[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [assigneeActions, setAssigneeActions] = useState<{ userId: string; rows: Action[]; loading: boolean; error: string | null }>({ userId: "", rows: [], loading: false, error: null });
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const actionReadGeneration = useRef(0);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerMode>("scheduled");
  const [editingBlock, setEditingBlock] = useState<ScheduledBlock | null>(null);
  const [eventTitle, setEventTitle] = useState("Focus block");
  const [eventProjectId, setEventProjectId] = useState("");
  const [eventActionId, setEventActionId] = useState("");
  const [eventTaskId, setEventTaskId] = useState("");
  const [eventNotes, setEventNotes] = useState("");
  const [eventTags, setEventTags] = useState("");
  const [eventStart, setEventStart] = useState(() => localInput(defaultStart()));
  const [eventEnd, setEventEnd] = useState(() => localInput(new Date(defaultStart().getTime() + 60 * 60 * 1000)));
  const [eventUserId, setEventUserId] = useState<string | null>(null);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("none");
  const [repeatCount, setRepeatCount] = useState(1);
  const [savingEvent, setSavingEvent] = useState(false);
  const [savingBatch, setSavingBatch] = useState(false);
  const [pendingScheduleSave, setPendingScheduleSave] = useState<ScheduleBatch | null>(null);
  const [scheduleSaveError, setScheduleSaveError] = useState<string | null>(null);
  const [manualSaveUnconfirmed, setManualSaveUnconfirmed] = useState(false);
  const [recoveredScheduleSave, setRecoveredScheduleSave] = useState(false);
  const [scheduleRecoveryWarning, setScheduleRecoveryWarning] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [draft, setDraft] = useState<CalendarDraft | null>(null);
  const [quickTitle, setQuickTitle] = useState("Focus block");
  const [reschedulingBlock, setReschedulingBlock] = useState(false);
  const [movingBlockId, setMovingBlockId] = useState<string | null>(null);
  const [selectedBlockAnchor, setSelectedBlock] = useState<{ block: ScheduledBlock; x: number; y: number } | null>(null);
  const [visibleStartHour, setVisibleStartHour] = useState(DEFAULT_START_HOUR);
  const [visibleEndHour, setVisibleEndHour] = useState(DEFAULT_END_HOUR);
  const [savingHours, setSavingHours] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);
  const [nudgeFocusId, setNudgeFocusId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [expandedMonthDays, setExpandedMonthDays] = useState<Set<string>>(() => new Set());
  const composerTitleRef = useRef<HTMLInputElement>(null);
  const saveNoticeRef = useRef<HTMLDivElement>(null);
  const composerReturnFocusRef = useRef<HTMLElement | null>(null);
  const popoverReturnFocusRef = useRef<HTMLElement | null>(null);
  const calendarDateRef = useRef<HTMLInputElement>(null);
  const calendarRetryRef = useRef<HTMLButtonElement>(null);
  const scheduleOperationRef = useRef<string | null>(null);
  const pendingScheduleRef = useRef<ScheduleBatch | null>(null);
  const scheduleRequestInFlight = useRef(false);
  const eventRequestInFlight = useRef(false);
  const scheduleRecoveryScope = useRef<string | null>(null);
  const pendingScheduleExpiry = useRef<number | null>(null);
  const calendarReadGeneration = useRef(0);
  const recoveryStorageKey = session ? pendingScheduleKey(session) : null;

  useEffect(() => {
    if (!composerOpen || !eventUserId) return;
    const generation = ++actionReadGeneration.current;
    let current = true;
    const userId = eventUserId;
    fetch(`/api/user/actions?userId=${encodeURIComponent(userId)}`)
      .then(async response => {
        if (!response.ok) throw new Error("Work types unavailable");
        const data = await response.json();
        if (!Array.isArray(data.actions) || !data.actions.every((action: Action) => typeof action.id === "string" && typeof action.name === "string")) throw new Error("Work types unavailable");
        if (current && generation === actionReadGeneration.current) setAssigneeActions({ userId, rows: data.actions, loading: false, error: null });
      })
      .catch(() => {
        if (current && generation === actionReadGeneration.current) setAssigneeActions({ userId, rows: [], loading: false, error: "Work types could not be loaded for this assignee. The saved work type is preserved on edits; new plans can be saved without a work type, or close and reopen to retry." });
      });
    return () => { current = false; };
  }, [composerOpen, eventUserId, session?.sub, session?.workspaceId]);

  useEffect(() => {
    if (!recoveryStorageKey) return;
    scheduleRecoveryScope.current = recoveryStorageKey;
    pendingScheduleRef.current = null;
    scheduleOperationRef.current = null;
    pendingScheduleExpiry.current = null;
    // Synchronize this scoped browser-storage record after session hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingScheduleSave(null);
    setRecoveredScheduleSave(false);
    setScheduleSaveError(null);
    setManualSaveUnconfirmed(false);
    setScheduleRecoveryWarning(null);
    try {
      const raw = sessionStorage.getItem(recoveryStorageKey);
      if (!raw) return;
      const recovery = readScheduleRecovery(raw, Date.now());
      if (!recovery) { sessionStorage.removeItem(recoveryStorageKey); return; }
      pendingScheduleRef.current = recovery.payload;
      scheduleOperationRef.current = recovery.payload.operationId;
      pendingScheduleExpiry.current = recovery.expiresAt;
      setPendingScheduleSave(recovery.payload);
      setRecoveredScheduleSave(true);
    } catch {
      setScheduleRecoveryWarning("Save recovery is unavailable in this tab. Keep this page open until new saves are confirmed.");
    }
  }, [recoveryStorageKey]);

  useLayoutEffect(() => {
    if (!composerOpen || savingEvent || savingBatch || (!pendingScheduleSave && !scheduleSaveError)) return;
    const notice = saveNoticeRef.current;
    notice?.scrollIntoView({ block: "nearest" });
    // Save actions sit outside the scrolling form. Bring an unconfirmed result
    // back into view and make its safe next step reachable from the keyboard.
    notice?.querySelector<HTMLElement>("button, a[href]")?.focus({ preventScroll: true });
  }, [composerOpen, pendingScheduleSave, savingEvent, savingBatch, scheduleSaveError]);

  const closeSelection = useCallback(() => {
    setDraft(null);
    setMovingBlockId(null);
  }, []);
  const closeBlockActions = useCallback(() => setSelectedBlock(null), []);

  function navigateToDate(date: Date) {
    setCurrentDate(date);
    setNavigationError(null);
    closeSelection();
    closeBlockActions();
  }

  function jumpToDate(value: string) {
    const date = new Date(`${value}T12:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || dateKey(date) !== value) {
      setNavigationError("Choose a valid calendar date.");
      return;
    }
    navigateToDate(date);
  }

  const blocksById = useMemo(() => new Map(blocks.map((block) => [block.id, block])), [blocks]);
  const selectedBlock = selectedBlockAnchor && blocksById.has(selectedBlockAnchor.block.id)
    ? { ...selectedBlockAnchor, block: blocksById.get(selectedBlockAnchor.block.id)! }
    : null;
  const recordedTime = useMemo(() => ({
    blocks: new Set(entries.flatMap((entry) => entry.scheduledBlockId ? [entry.scheduledBlockId] : [])),
    runningBlocks: new Set(entries.flatMap((entry) => !entry.stoppedAt && entry.scheduledBlockId ? [entry.scheduledBlockId] : [])),
    runningEntries: new Set(entries.filter((entry) => !entry.stoppedAt).map((entry) => entry.id)),
  }), [entries]);

  const browserTimezone = useMemo(() => mounted ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : "UTC", [mounted]);
  const isManager = session?.role === "manager" || session?.role === "owner";
  const visibleStartMinutes = visibleStartHour * 60;
  const visibleEndMinutes = visibleEndHour * 60;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    const onResize = () => {
      const phone = window.innerWidth < 640;
      setIsMobile(phone);
      if (phone) setViewMode((current) => current === "week" ? "day" : current);
    };
    onResize();
    window.addEventListener("resize", onResize);
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => {
      window.removeEventListener("resize", onResize);
      clearInterval(interval);
    };
  }, []);

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
    if (viewMode === "day") {
      const day = new Date(currentDate);
      day.setHours(0, 0, 0, 0);
      return [{ key: dateKey(day), label: day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }), date: day, userId: session?.sub }];
    }
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
    return rangeAtMinutes(day, start, end);
  }, [visibleEndMinutes, visibleStartMinutes]);

  function clampEventStyle(day: Date, startsAt: string | Date, endsAt: string | Date) {
    const startMinutes = dayMinute(day, startsAt);
    const endMinutes = dayMinute(day, endsAt);
    const top = Math.max(0, ((Math.max(startMinutes, visibleStartMinutes) - visibleStartMinutes) / 60) * HOUR_HEIGHT);
    // Sub-slot work and repeated-hour spans still need a reachable marker.
    const height = Math.max(18, ((Math.min(endMinutes, visibleEndMinutes) - Math.max(startMinutes, visibleStartMinutes)) / 60) * HOUR_HEIGHT);
    return { top, height };
  }

  function visibleInHourRange(day: Date, startsAt: string, endsAt: string) {
    const startMinutes = dayMinute(day, startsAt);
    const endMinutes = dayMinute(day, endsAt);
    if (endMinutes <= startMinutes && Date.parse(endsAt) >= Date.parse(startsAt)) {
      return startMinutes >= visibleStartMinutes && startMinutes < visibleEndMinutes;
    }
    return endMinutes > visibleStartMinutes && startMinutes < visibleEndMinutes;
  }

  function blocksForLane(lane: Lane) {
    return blocks.filter((block) => block.status !== "canceled" && eventOverlapsDay(lane.date, block.startsAt, block.endsAt) && (!lane.userId || block.userId === lane.userId));
  }

  function entriesForLane(lane: Lane) {
    return entries.filter((entry) => eventOverlapsDay(lane.date, entry.startedAt, entryEnd(entry, now)) && (!lane.userId || entry.userId === lane.userId));
  }

  function conflictsForRange(startsAt: Date, endsAt: Date, userId?: string | null, ignoreBlockId?: string): Conflict[] {
    const planned = blocks
      .filter((block) => block.id !== ignoreBlockId && block.status !== "canceled" && block.status !== "skipped")
      .filter((block) => !userId || block.userId === userId)
      .filter((block) => rangesOverlap(startsAt, endsAt, new Date(block.startsAt), new Date(block.endsAt)))
      .map((block) => ({ id: block.id, label: block.title, kind: isUnavailableBlock(block) ? "unavailable" as const : isUnloggedPlan(block) && canChangeBlockStructure(block) ? "planned" as const : "logged" as const }));
    const logged = entries
      .filter((entry) => !ignoreBlockId || (entry.scheduledBlockId !== ignoreBlockId && entry.id !== blocksById.get(ignoreBlockId)?.linkedTimeEntryId))
      .filter((entry) => !userId || entry.userId === userId)
      .filter((entry) => rangesOverlap(startsAt, endsAt, new Date(entry.startedAt), new Date(entryEnd(entry, now))))
      .map((entry) => ({ id: entry.id, label: entry.taskId || "Logged time", kind: "logged" as const }));
    return [...planned, ...logged];
  }

  function findNextOpenSlot(after: Date, durationMinutes: number, userId?: string | null, ignoreBlockId?: string, sourceStart?: Date) {
    let cursor = new Date(after);
    const remainder = sourceStart ? sourceStart.getSeconds() / 60 + sourceStart.getMilliseconds() / 60000 : 0;
    const firstMinute = Math.ceil((dayMinute(cursor, cursor) + cursor.getSeconds() / 60 + cursor.getMilliseconds() / 60000 - remainder) / SLOT_MINUTES) * SLOT_MINUTES;
    const atMinute = (day: Date, minute: number) => sourceStart
      ? moveCalendarRange(sourceStart, new Date(sourceStart.getTime() + durationMinutes * 60000), day, minute).startsAt
      : dateAtMinute(day, minute);
    cursor = atMinute(cursor, firstMinute);
    while (cursor < after) cursor = new Date(cursor.getTime() + SLOT_MINUTES * 60000);
    if (cursor.getHours() < visibleStartHour) cursor = atMinute(cursor, visibleStartMinutes);
    for (let dayOffset = 0; dayOffset < 35; dayOffset++) {
      const day = addDays(cursor, dayOffset === 0 ? 0 : 1);
      if (dayOffset > 0) cursor = atMinute(day, visibleStartMinutes);
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

  const fetchData = useCallback(async () => {
    const generation = ++calendarReadGeneration.current;
    setLoading(true);
    try {
      const [calendarRes, scheduleRes, projectsRes, actionsRes, peopleRes, settingsRes, authRes] = await Promise.all([
        fetch("/api/calendar").catch(() => null),
        fetch("/api/schedule?scope=team").catch(() => null),
        fetch("/api/projects").catch(() => null),
        fetch("/api/user/actions").catch(() => null),
        fetch("/api/people").catch(() => null),
        fetch("/api/user/settings").catch(() => null),
        fetch("/api/auth/me").catch(() => null),
      ]);
      if (![calendarRes, scheduleRes, projectsRes, actionsRes, settingsRes, authRes].every((response) => response?.ok)) {
        throw new Error("Calendar data unavailable");
      }
      const [calendarData, scheduleData, projectsData, actionsData, peopleData, settingsData, authData] = await Promise.all([
        calendarRes!.json(), scheduleRes!.json(), projectsRes!.json(), actionsRes!.json(),
        peopleRes?.ok ? peopleRes.json() : null, settingsRes!.json(), authRes!.json(),
      ]);
      // Parse and assemble the whole snapshot before any state changes. A slow
      // earlier refresh must not undo a confirmed write or mix old preferences
      // and membership with newer calendar data.
      const snapshot = {
        session: authData.session ?? null,
        entries: calendarData.entries ?? [],
        blocks: scheduleData.blocks ?? [],
        projects: projectsData.projects ?? [],
        actions: actionsData.actions ?? [],
        people: peopleRes?.ok ? peopleData.people ?? [] : null,
        timezone: settingsData.user?.timezone ?? "UTC",
        preferences: (settingsData.user?.calendarPreferences ?? {}) as CalendarPreferences,
      };
      const start = Number(snapshot.preferences.visibleStartHour ?? DEFAULT_START_HOUR);
      const end = Number(snapshot.preferences.visibleEndHour ?? DEFAULT_END_HOUR);
      if (generation !== calendarReadGeneration.current) return;
      setSession(snapshot.session);
      setEntries(snapshot.entries);
      setBlocks(snapshot.blocks);
      setProjects(snapshot.projects);
      setActions(snapshot.actions);
      if (snapshot.people !== null) setPeople(snapshot.people);
      setUserTimezone(snapshot.timezone);
      if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= 24 && end > start) {
        setVisibleStartHour(start);
        setVisibleEndHour(end);
      }
      setLoadError(false);
    } catch {
      if (generation === calendarReadGeneration.current) setLoadError(true);
    } finally {
      if (generation === calendarReadGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      fetchData().catch(() => toast.error("Unable to load calendar"));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [fetchData]);

  useEffect(() => {
    const onTimeSaved = () => {
      fetchData().catch(() => null);
    };
    window.addEventListener("sowledger:time-saved", onTimeSaved);
    window.addEventListener("sowledger:calendar-updated", onTimeSaved);
    return () => {
      window.removeEventListener("sowledger:time-saved", onTimeSaved);
      window.removeEventListener("sowledger:calendar-updated", onTimeSaved);
    };
  }, [fetchData]);

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
    element.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFocusBlockId(null);
  }, [blocks, focusBlockId]);

  useLayoutEffect(() => {
    if (!nudgeFocusId || loading) return;
    const card = document.querySelector<HTMLElement>(`[data-calendar-block-id="${CSS.escape(nudgeFocusId)}"]`);
    const target = card ?? (loadError ? calendarRetryRef.current : calendarDateRef.current);
    // The refresh can replace the focused card. Restore keyboard continuity
    // without scrolling or taking focus the user moved elsewhere while waiting.
    if (document.activeElement === document.body || document.activeElement === card) {
      target?.focus({ preventScroll: true });
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNudgeFocusId(null);
  }, [blocks, loading, loadError, nudgeFocusId]);

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
        const range = moveCalendarRange(dragState.block.startsAt, dragState.block.endsAt, day, currentStartMinute);
        setDragState({ ...dragState, columnTop, dayKey: dayKeyValue, currentStartMinute, x: event.clientX, y: event.clientY });
        setDraft({ kind: "move", block: dragState.block, ...range, userId: laneUserId, x: event.clientX, y: event.clientY });
        return;
      }

      if (dragState?.kind === "resize") {
        const currentMinute = minuteFromPointer(event.clientY, dragState.columnTop);
        const resizedMinute = dragState.edge === "start"
          ? clamp(Math.min(currentMinute, dragState.fixedMinute - MIN_BLOCK_MINUTES), visibleStartMinutes, visibleEndMinutes - MIN_BLOCK_MINUTES)
          : clamp(Math.max(currentMinute, dragState.fixedMinute + MIN_BLOCK_MINUTES), visibleStartMinutes + MIN_BLOCK_MINUTES, visibleEndMinutes);
        const resizedAt = dateAtMinute(dragState.day, resizedMinute);
        // Only the dragged edge changes. Keep the other instant, including its
        // seconds, repeated-hour offset, and any portion outside visible hours.
        const startsAt = dragState.edge === "start" ? resizedAt : new Date(dragState.block.startsAt);
        const endsAt = dragState.edge === "end" ? resizedAt : new Date(dragState.block.endsAt);
        const clockError = dayMinute(dragState.day, resizedAt) !== resizedMinute
          ? "The selected start or end time does not exist because the clocks move forward. Choose another slot."
          : endsAt <= startsAt ? "Choose an end time after the start time." : undefined;
        setDragState({ ...dragState, currentMinute, x: event.clientX, y: event.clientY });
        setDraft({
          kind: "resize",
          block: dragState.block,
          startsAt,
          endsAt,
          clockError,
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

  function openComposer({ mode = "scheduled", dateStr, startAt, endAt, block = null, userId = null, trigger }: OpenComposerOptions = {}) {
    if (eventRequestInFlight.current) return;
    if (block && !canEditBlockDetails(block)) return;
    if (pendingScheduleRef.current) {
      toast.info("Finish or retry the current save before starting another event.");
      return;
    }
    setScheduleSaveError(null);
    setManualSaveUnconfirmed(false);
    composerReturnFocusRef.current = trigger ?? ((selectedBlock || draft) ? popoverReturnFocusRef.current : document.activeElement as HTMLElement | null);
    const start = block ? new Date(block.startsAt) : startAt ?? defaultStart(dateStr, visibleStartHour, visibleEndHour);
    const end = block ? new Date(block.endsAt) : endAt ?? new Date(start.getTime() + 60 * 60 * 1000);

    setComposerMode(mode);
    setEditingBlock(block);
    setEventTitle(block?.title ?? (mode === "calendar" ? "Completed work" : mode === "unavailable" ? "Unavailable" : "Focus block"));
    setEventProjectId(block?.projectId ?? "");
    setEventActionId(block?.actionId ?? "");
    const assignedUserId = block?.userId ?? userId ?? session?.sub ?? "";
    actionReadGeneration.current++;
    setAssigneeActions({ userId: assignedUserId, rows: assignedUserId === session?.sub ? actions : [], loading: true, error: null });
    setActionNotice(null);
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

  function closeComposer() {
    // Batch creation has an exact retry receipt; other event writes do not.
    // Keep their draft mounted until the in-flight result has been handled.
    if (eventRequestInFlight.current && !scheduleRequestInFlight.current) return;
    setComposerOpen(false);
  }

  function openComposerFromDraft(mode: ComposerMode) {
    if (!draft) return;
    if (draft.clockError) { setScheduleSaveError(draft.clockError); return; }
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
      toast.error("Could not save calendar hours", { description: error instanceof Error ? error.message : "Check your connection and try again." });
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

  async function saveScheduledBatch(input?: Omit<ScheduleBatch, "operationId">) {
    if (scheduleRequestInFlight.current) return;
    if (!pendingScheduleRef.current && !input) return;
    if (!recoveryStorageKey) { setScheduleSaveError("Wait for your calendar to finish loading before saving."); return false; }
    scheduleOperationRef.current ??= crypto.randomUUID();
    const payload = pendingScheduleRef.current ?? { ...input!, operationId: scheduleOperationRef.current };
    // Keep the exact request until the server confirms it. A lost response may
    // mean the transaction committed, so a retry must not become a new save.
    pendingScheduleRef.current = payload;
    setPendingScheduleSave(payload);
    scheduleRequestInFlight.current = true;
    setSavingBatch(true);
    setScheduleSaveError(null);
    pendingScheduleExpiry.current ??= Date.now() + RECOVERY_MAX_AGE;
    try {
      const recovery = JSON.stringify({ version: 1, expiresAt: pendingScheduleExpiry.current, payload });
      // This timestamp is read only when a save or retry handler runs.
      // eslint-disable-next-line react-hooks/purity
      if (!readScheduleRecovery(recovery, Date.now())) throw new Error("Recovery is too large or expired.");
      sessionStorage.setItem(recoveryStorageKey, recovery);
      setScheduleRecoveryWarning(null);
    } catch { setScheduleRecoveryWarning(RECOVERY_WARNING); }
    const sameScope = () => scheduleRecoveryScope.current === recoveryStorageKey;
    const clearRecoveryCopy = () => {
      try {
        sessionStorage.removeItem(recoveryStorageKey);
        if (sameScope()) setScheduleRecoveryWarning(null);
      } catch {
        if (sameScope()) setScheduleRecoveryWarning("Could not clear this tab's recovery copy. A later visit may offer this request again.");
      }
    };
    let definitelyRejected = false;
    try {
      const response = await fetch("/api/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      definitelyRejected = !response.ok && response.status < 500 && response.status !== 408;
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not schedule work.");
      if (!completeScheduleReceipt(data, payload)) throw new Error("The server did not return a complete save confirmation.");
      clearRecoveryCopy();
      if (!sameScope()) return true;
      pendingScheduleRef.current = null;
      scheduleOperationRef.current = null;
      pendingScheduleExpiry.current = null;
      setPendingScheduleSave(null);
      setRecoveredScheduleSave(false);
      setComposerOpen(false);
      setDraft(null);
      setSelectedBlock(null);
      setMovingBlockId(null);
      setQuickTitle("Focus block");
      if (viewMode === "month") setExpandedMonthDays((current) => new Set([...current, ...payload.occurrences.map((item) => dateKey(new Date(item.startsAt)))]));
      toast.success(data.replayed ? "Save confirmed" : data.blockIds.length === 1 ? "Work scheduled" : `${data.blockIds.length} work blocks scheduled`);
      if (Array.isArray(data.warnings)) for (const warning of data.warnings) if (typeof warning === "string") toast.warning(warning);
      await fetchData();
      scrollBlockIntoView(data.blockIds[0]);
      return true;
    } catch (error) {
      if (definitelyRejected) clearRecoveryCopy();
      if (!sameScope()) return false;
      const message = error instanceof Error ? error.message : "Check your connection and try again.";
      setScheduleSaveError(message);
      if (definitelyRejected) {
        pendingScheduleRef.current = null;
        pendingScheduleExpiry.current = null;
        setPendingScheduleSave(null);
        setRecoveredScheduleSave(false);
      }
      toast.error(definitelyRejected ? "Could not schedule work" : "Save not confirmed", { description: message });
      return false;
    } finally {
      scheduleRequestInFlight.current = false;
      setSavingBatch(false);
    }
  }

  function renderScheduleSaveNotice() {
    if (pendingScheduleSave) return <div ref={saveNoticeRef} role={savingBatch ? "status" : "alert"} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-semibold">{savingBatch ? "Saving your work…" : recoveredScheduleSave ? "An earlier save in this tab still needs confirmation." : "This save still needs confirmation."}</p>
      <p className="mt-1">{pendingScheduleSave.title} · {pendingScheduleSave.occurrences.length} {pendingScheduleSave.occurrences.length === 1 ? "block" : "blocks"}</p>
      {scheduleRecoveryWarning && <p className="mt-2 font-semibold">{scheduleRecoveryWarning}</p>}
      {!savingBatch && <><p className="mt-1">Retry the same request before making changes. Already-saved blocks will not be created again.</p><div className="mt-2 flex flex-wrap gap-4"><button type="button" onClick={() => void saveScheduledBatch()} className="font-semibold underline">Retry save</button><button type="button" onClick={() => { setComposerOpen(false); closeSelection(); closeBlockActions(); setCurrentDate(new Date(pendingScheduleSave.occurrences[0].startsAt)); setViewMode("day"); }} className="font-semibold underline">Review calendar</button></div></>}
    </div>;
    return scheduleSaveError || scheduleRecoveryWarning ? <div ref={saveNoticeRef} role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{scheduleSaveError && <p>{scheduleSaveError}</p>}{manualSaveUnconfirmed && <p className="mt-2"><a href="/activity" target="_blank" rel="noopener noreferrer" className="font-semibold underline">Check Activity</a> (opens in a new tab).</p>}{scheduleRecoveryWarning && <p>{scheduleRecoveryWarning}</p>}</div> : null;
  }

  function scrollBlockIntoView(blockId: string) {
    setFocusBlockId(blockId);
  }

  async function createQuickDraft(options: { replace?: boolean; shorten?: boolean } = {}) {
    if (!draft || scheduleRequestInFlight.current || pendingScheduleRef.current) return;
    if (draft.clockError) { setScheduleSaveError(draft.clockError); return; }
    const title = quickTitle.trim() || "Focus block";
    const startsAt = draft.startsAt;
    let endsAt = draft.endsAt;
    if (options.shorten) {
      const firstConflict = firstConflictAfterStart(startsAt, endsAt, draft.userId ?? session?.sub);
      if (firstConflict && firstConflict.getTime() - startsAt.getTime() >= MIN_BLOCK_MINUTES * 60000) endsAt = firstConflict;
    }
    if (endsAt <= startsAt) { setScheduleSaveError("Choose an end time after the start time."); return; }
    const replacements = options.replace ? conflictsForRange(startsAt, endsAt, draft.userId ?? session?.sub).filter((conflict) => conflict.kind === "planned").map((conflict) => blocksById.get(conflict.id)!) : [];
    if (replacements.some((block) => !block?.updatedAt || !Number.isFinite(Date.parse(block.updatedAt)))) {
      setScheduleSaveError("Refresh the calendar before replacing these plans. Their last update time is missing.");
      return;
    }
    await saveScheduledBatch({ title, userId: draft.userId ?? session?.sub, tags: [], occurrences: [{ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }], ...(options.replace ? { replace: replacements.map((block) => ({ blockId: block.id, expectedUpdatedAt: block.updatedAt! })) } : {}) });
  }

  async function saveEvent() {
    if (eventRequestInFlight.current || pendingScheduleRef.current) return;
    setScheduleSaveError(null);
    setManualSaveUnconfirmed(false);
    if (composerMode === "calendar" && editingBlock && !canRecordBlockTime(editingBlock)) {
      setScheduleSaveError(blockTimeGuidance(editingBlock) || "Refresh the calendar before logging this work.");
      return;
    }
    const startsAt = composerDate(eventStart, editingBlock?.startsAt);
    const endsAt = composerDate(eventEnd, editingBlock?.endsAt);
    const title = eventTitle.trim();
    const taskId = eventTaskId.trim();
    const tags = new Set(eventTags.split(",").map((tag) => tag.trim()).filter(Boolean));
    if (composerMode === "unavailable") tags.add("unavailable");

    if (!title) {
      setScheduleSaveError("Add a title for this work block.");
      composerTitleRef.current?.focus();
      return;
    }
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      setScheduleSaveError("Enter a valid start and end time.");
      return;
    }
    if (clockChangeHint(eventStart, editingBlock?.startsAt)?.invalid || clockChangeHint(eventEnd, editingBlock?.endsAt)?.invalid) {
      setScheduleSaveError("Choose a time that exists in your browser timezone.");
      return;
    }

    const conflicts = composerMode !== "calendar" ? conflictsForRange(startsAt, endsAt, eventUserId ?? session?.sub, editingBlock?.id) : [];
    const targetBlockId = editingBlock?.id ?? null;
    eventRequestInFlight.current = true;
    setSavingEvent(true);
    let manualSaveMayHaveSucceeded = false;
    try {
      if (composerMode === "scheduled" || composerMode === "unavailable") {
        if (!editingBlock) {
          const count = repeatMode === "none" ? 1 : repeatCount;
          if (!Number.isInteger(count) || count < 1 || count > MAX_REPEAT_COUNT) throw new Error(`Choose between 1 and ${MAX_REPEAT_COUNT} occurrences.`);
          const occurrences = Array.from({ length: count }, (_, index) => {
            const nextStart = addRepeat(startsAt, repeatMode, index);
            const nextEnd = addRepeat(endsAt, repeatMode, index);
            const changedClock = [[startsAt, nextStart], [endsAt, nextEnd]].find(([original, next]) => original.getHours() !== next.getHours() || original.getMinutes() !== next.getMinutes());
            if (changedClock) throw new Error(`The repeated time does not exist on ${changedClock[1].toLocaleDateString(undefined, { month: "long", day: "numeric" })} because the clocks move forward. Choose another time or schedule that occurrence separately.`);
            return { startsAt: nextStart.toISOString(), endsAt: nextEnd.toISOString() };
          });
          const saved = await saveScheduledBatch({ title, userId: eventUserId ?? session?.sub, projectId: eventProjectId || null, actionId: eventActionId || null, taskId: taskId || null, notes: eventNotes || null, tags: [...tags], occurrences });
          if (saved && conflicts.length > 0) toast.warning("This overlaps existing calendar work", { description: `${conflicts.length} conflict(s) detected. You allowed the overlap.` });
          return;
        } else {
          await patchBlock(editingBlock.id, {
            title,
            notes: eventNotes || null,
            tags: [...tags],
            ...(canChangeBlockStructure(editingBlock) ? {
              projectId: eventProjectId || null,
              actionId: eventActionId || null,
              taskId: taskId || null,
              startsAt: startsAt.toISOString(),
              endsAt: endsAt.toISOString(),
              userId: eventUserId || undefined,
            } : {}),
          });
        }
        toast.success("Scheduled work updated");
        if (conflicts.length > 0) toast.warning("This overlaps existing calendar work", { description: `${conflicts.length} conflict(s) detected. You allowed the overlap.` });
      } else {
        manualSaveMayHaveSucceeded = true;
        const response = await fetch("/api/timer/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: taskId || title,
            projectId: eventProjectId || undefined,
            // An empty string explicitly clears the scheduled rate; omission inherits it.
            actionId: eventActionId,
            description: eventNotes || title,
            tags: [...tags],
            startedAt: startsAt.toISOString(),
            stoppedAt: endsAt.toISOString(),
            scheduledBlockId: editingBlock?.id,
            source: "calendar",
          }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          if (response.status < 500 && response.status !== 408) manualSaveMayHaveSucceeded = false;
          throw new Error(data?.error || "Could not log completed work");
        }
        if (data?.ok !== true) throw new Error("The server did not confirm the completed time entry.");
        manualSaveMayHaveSucceeded = false;
        window.dispatchEvent(new CustomEvent("sowledger:time-saved"));
        toast.success("Completed work logged");
      }
      await fetchData();
      setComposerOpen(false);
      if (targetBlockId) scrollBlockIntoView(targetBlockId);
    } catch (error) {
      const message = manualSaveMayHaveSucceeded ? "We couldn't confirm the save. Check Activity before retrying so you don't log this work twice. Your details are still here." : error instanceof Error ? error.message : "Check your connection and try again.";
      setManualSaveUnconfirmed(manualSaveMayHaveSucceeded);
      setScheduleSaveError(message);
      toast.error("Could not save calendar event", { description: message });
    } finally {
      eventRequestInFlight.current = false;
      setSavingEvent(false);
    }
  }

  async function startBlock(block: ScheduledBlock) {
    if (!canRecordBlockTime(block)) {
      toast.error(blockTimeGuidance(block) || "Refresh the calendar before starting this work.");
      return;
    }
    try {
      const response = await fetch("/api/timer/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: block.taskId || block.title,
          projectId: block.projectId || undefined,
          actionId: block.actionId || undefined,
          description: block.notes || block.title,
          tags: block.tags,
          scheduledBlockId: block.id,
        }),
      });
      const data = await response.json();
      if (!response.ok) toast.error("Could not start scheduled work", { description: data.error });
      else toast.success("Timer started from schedule");
      await fetchData();
    } catch {
      toast.error("Could not start scheduled work", { description: "Check your connection and try again." });
    }
  }

  async function logCompletedBlock(block: ScheduledBlock, trigger?: HTMLElement) {
    if (!canRecordBlockTime(block)) {
      toast.error(blockTimeGuidance(block) || "Refresh the calendar before logging this work.");
      return;
    }
    openComposer({ mode: "calendar", block, trigger });
  }

  async function moveToNextOpenSlot(block: ScheduledBlock) {
    if (!canRescheduleBlock(block)) return;
    const nextSlot = findNextOpenSlot(new Date(block.endsAt), minuteDuration(block.startsAt, block.endsAt), block.userId, block.id, new Date(block.startsAt));
    if (!nextSlot) {
      toast.error("No open slot found in the next 35 days.");
      return;
    }
    try {
      await patchBlock(block.id, { startsAt: nextSlot.startsAt.toISOString(), endsAt: nextSlot.endsAt.toISOString() }, "Moved to next open slot");
      setSelectedBlock(null);
      setDraft(null);
    } catch (error) {
      toast.error("Could not move work", { description: error instanceof Error ? error.message : "Check your connection and try again." });
    }
  }

  async function duplicateBlock(block: ScheduledBlock) {
    if (!canEditBlockDetails(block) || scheduleRequestInFlight.current || pendingScheduleRef.current) return;
    const duration = minuteDuration(block.startsAt, block.endsAt);
    const after = new Date(block.endsAt);
    const nextSlot = findNextOpenSlot(after, duration, block.userId, block.id, new Date(block.startsAt))
      ?? moveCalendarRange(block.startsAt, block.endsAt, after, dayMinute(after, after) + SLOT_MINUTES);
    if ("clockError" in nextSlot && typeof nextSlot.clockError === "string") {
      setScheduleSaveError(nextSlot.clockError);
      return;
    }
      await saveScheduledBatch({
        title: block.title,
        occurrences: [{ startsAt: nextSlot.startsAt.toISOString(), endsAt: nextSlot.endsAt.toISOString() }],
        userId: block.userId,
        projectId: block.projectId,
        actionId: block.actionId,
        taskId: block.taskId,
        notes: block.notes,
        tags: block.tags,
      });
  }

  async function skipBlock(block: ScheduledBlock) {
    if (!canRescheduleBlock(block)) return;
    try {
      await patchBlock(block.id, { status: "skipped" }, "Scheduled work skipped");
      setSelectedBlock(null);
    } catch (error) {
      toast.error("Could not skip work", { description: error instanceof Error ? error.message : "Check your connection and try again." });
    }
  }

  async function cancelBlock(block: ScheduledBlock) {
    if (!canChangeBlockStructure(block)) return;
    try {
      const response = await fetch(`/api/schedule?blockId=${encodeURIComponent(block.id)}`, { method: "DELETE" });
      if (!response.ok) toast.error("Could not cancel scheduled work");
      else toast.success("Scheduled work canceled");
      setSelectedBlock(null);
      await fetchData();
    } catch {
      toast.error("Could not cancel scheduled work", { description: "Check your connection and try again." });
    }
  }

  function beginSlotDrag(event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>, lane: Lane) {
    if (pendingScheduleRef.current || scheduleRequestInFlight.current) return;
    if (isMobile) return;
    if (event.button !== 0) return;
    const column = event.currentTarget.closest<HTMLElement>("[data-day-column]");
    if (!column) return;
    const columnTop = column.getBoundingClientRect().top;
    const startMinute = minuteFromPointer(event.clientY, columnTop);
    const currentMinute = Math.min(startMinute + 60, visibleEndMinutes);
    const selection = normalizedSelection(lane.date, startMinute, currentMinute);
    popoverReturnFocusRef.current = event.currentTarget;
    event.preventDefault();
    setScheduleSaveError(null);
    setMovingBlockId(null);
    setSelectedBlock(null);
    setQuickTitle("Focus block");
    setDraft({ kind: "selection", ...selection, userId: lane.userId ?? session?.sub, x: event.clientX, y: event.clientY });
    setDragState({ kind: "selection", day: lane.date, userId: lane.userId ?? session?.sub, columnTop, startMinute, currentMinute, x: event.clientX, y: event.clientY });
  }

  function beginBlockMove(event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>, block: ScheduledBlock, day: Date) {
    if (isMobile || !canRescheduleBlock(block)) return;
    if (event.button !== 0) return;
    const column = event.currentTarget.closest<HTMLElement>("[data-day-column]");
    if (!column) return;
    const columnTop = column.getBoundingClientRect().top;
    const startMinute = dayMinute(day, block.startsAt);
    const durationMinutes = minuteDuration(block.startsAt, block.endsAt);
    const pointerMinute = minuteFromPointer(event.clientY, columnTop);
    // Compact handles can snap to the end of the block. Retain that offset so
    // dragging from the bottom does not add an unintended extra time slot.
    const grabOffsetMinutes = Math.max(0, pointerMinute - startMinute);
    popoverReturnFocusRef.current = event.currentTarget.closest<HTMLElement>("[data-calendar-block-id]") ?? event.currentTarget;
    event.preventDefault();
    event.stopPropagation();
    setSelectedBlock(null);
    setMovingBlockId(block.id);
    setDraft({ kind: "move", block, startsAt: new Date(block.startsAt), endsAt: new Date(block.endsAt), userId: block.userId, x: event.clientX, y: event.clientY });
    setDragState({ kind: "move", block, columnTop, dayKey: dateKey(day), durationMinutes, grabOffsetMinutes, currentStartMinute: startMinute, x: event.clientX, y: event.clientY });
  }

  function beginBlockResize(event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>, block: ScheduledBlock, day: Date, edge: ResizeEdge) {
    if (isMobile || !canRescheduleBlock(block)) return;
    if (event.button !== 0) return;
    const column = event.currentTarget.closest<HTMLElement>("[data-day-column]");
    if (!column) return;
    const columnTop = column.getBoundingClientRect().top;
    const startMinute = dayMinute(day, block.startsAt);
    const endMinute = dayMinute(day, block.endsAt);
    popoverReturnFocusRef.current = event.currentTarget.closest<HTMLElement>("[data-calendar-block-id]") ?? event.currentTarget;
    event.preventDefault();
    event.stopPropagation();
    setSelectedBlock(null);
    setMovingBlockId(block.id);
    setDraft({ kind: "resize", block, startsAt: new Date(block.startsAt), endsAt: new Date(block.endsAt), edge, userId: block.userId, x: event.clientX, y: event.clientY });
    setDragState({ kind: "resize", block, day, columnTop, edge, fixedMinute: edge === "start" ? endMinute : startMinute, currentMinute: edge === "start" ? startMinute : endMinute, x: event.clientX, y: event.clientY });
  }

  async function applyDraftMove() {
    if (!draft || !draft.block) return;
    if (draft.userId && draft.userId !== draft.block.userId && draft.block.actionId) {
      setScheduleSaveError("This block has an assignee-specific work type. Use Edit details to choose the new assignee and their work type before moving it.");
      return;
    }
    if (draft.clockError) { setScheduleSaveError(draft.clockError); return; }
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
      toast.error(draft.kind === "resize" ? "Could not resize scheduled work" : "Could not move scheduled work", { description: error instanceof Error ? error.message : "Check your connection and try again." });
    } finally {
      setReschedulingBlock(false);
    }
  }

  async function nudgeBlock(block: ScheduledBlock, minutes: number, days = 0) {
    if (!canRescheduleBlock(block)) return;
    const originalDay = new Date(`${dateKey(new Date(block.startsAt))}T00:00`);
    const targetDay = addDays(originalDay, days);
    const { startsAt, endsAt, clockError } = moveCalendarRange(block.startsAt, block.endsAt, targetDay, dayMinute(originalDay, block.startsAt) + minutes);
    if (clockError) { setScheduleSaveError(clockError); return; }
    const originalFocus = document.activeElement;
    let restoreFocus = originalFocus instanceof HTMLElement && originalFocus.dataset.calendarBlockId === block.id;
    const onFocusChange = (event: FocusEvent) => {
      if (event.target !== originalFocus && event.target !== document.body) restoreFocus = false;
    };
    document.addEventListener("focusin", onFocusChange);
    try {
      await patchBlock(block.id, { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() });
      if (restoreFocus) setNudgeFocusId(block.id);
    } catch (error) {
      toast.error("Could not move scheduled work", { description: error instanceof Error ? error.message : "Check your connection and try again." });
    } finally {
      document.removeEventListener("focusin", onFocusChange);
    }
  }

  function handleBlockKeyDown(event: ReactKeyboardEvent<HTMLElement>, block: ScheduledBlock) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      popoverReturnFocusRef.current = event.currentTarget;
      setSelectedBlock({ block, x: bounds.left, y: bounds.top });
      return;
    }
    if (!canRescheduleBlock(block)) return;
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
  const missedBlocks = blocks.filter((block) => isUnloggedPlan(block) && new Date(block.endsAt).getTime() < now).slice(0, 5);
  const upcomingBlocks = blocks.filter((block) => {
    const untilStart = new Date(block.startsAt).getTime() - now;
    return isUnloggedPlan(block) && untilStart >= 0 && untilStart <= 10 * 60 * 1000;
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

  function isImportedBlock(block: ScheduledBlock) {
    return block.isImported === true || block.tags.some((tag) => tag.toLowerCase() === "external-calendar");
  }

  function canEditBlockDetails(block: ScheduledBlock) {
    const current = blocksById.get(block.id) ?? block;
    return !isImportedBlock(current) && (canOperateOwnTime(current) || isManager);
  }

  function canChangeBlockStructure(block: ScheduledBlock) {
    const current = blocksById.get(block.id) ?? block;
    return canEditBlockDetails(current) && !hasRunningTimer(current) && !hasRecordedTime(current);
  }

  function canRescheduleBlock(block: ScheduledBlock) {
    const current = blocksById.get(block.id) ?? block;
    return current.status === "planned" && canChangeBlockStructure(current);
  }

  function hasRunningTimer(block: ScheduledBlock) {
    return block.status === "in_progress" || recordedTime.runningBlocks.has(block.id)
      || Boolean(block.linkedTimeEntryId && recordedTime.runningEntries.has(block.linkedTimeEntryId));
  }

  function hasRecordedTime(block: ScheduledBlock) {
    return block.hasRecordedTime === true || block.status === "completed" || Boolean(block.linkedTimeEntryId) || recordedTime.blocks.has(block.id);
  }

  function isUnloggedPlan(block: ScheduledBlock) {
    return block.status === "planned" && !isUnavailableBlock(block) && !hasRecordedTime(block) && !hasRunningTimer(block);
  }

  function canRecordBlockTime(block: ScheduledBlock) {
    const current = blocksById.get(block.id) ?? block;
    return canOperateOwnTime(current) && isUnloggedPlan(current);
  }

  function blockTimeGuidance(block: ScheduledBlock) {
    const current = blocksById.get(block.id) ?? block;
    if (isImportedBlock(current)) return "Imported events are read-only. Edit the event in Google Calendar, then sync again.";
    if (isUnavailableBlock(current)) return "Unavailable blocks reserve time; they cannot be logged as work.";
    if (!canOperateOwnTime(current)) return "Only the assigned person can start a timer or log this work.";
    if (hasRunningTimer(current)) return "Stop the running timer from your dashboard.";
    if (hasRecordedTime(current)) return "Time has already been recorded for this block.";
    if (current.status === "skipped") return "This block was skipped. Duplicate it to plan the work again.";
    if (current.status === "canceled") return "This block was canceled. Duplicate it to plan the work again.";
    return null;
  }

  function renderBlockTimeGuidance(block: ScheduledBlock) {
    const current = blocksById.get(block.id) ?? block;
    const guidance = blockTimeGuidance(current);
    if (!guidance) return null;
    const ownWork = canOperateOwnTime(current) && !isUnavailableBlock(current);
    return <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
      <p>{guidance}</p>
      {isImportedBlock(current) && <a href="/integrations" className="mt-1 inline-block font-semibold text-cyan-700 underline">Integration settings</a>}
      {ownWork && hasRunningTimer(current) && <a href="/dashboard" className="mt-1 inline-block font-semibold text-cyan-700 underline">Go to timer</a>}
      {ownWork && !hasRunningTimer(current) && hasRecordedTime(current) && <a href="/activity" className="mt-1 inline-block font-semibold text-cyan-700 underline">Review in Activity</a>}
    </div>;
  }

  function packedHorizontalStyle(position: CalendarColumn): CSSProperties {
    return {
      left: `calc(${100 * position.column / position.columnCount}% + 4px)`,
      right: `calc(${100 * (position.columnCount - position.column - 1) / position.columnCount}% + 4px)`,
    };
  }

  function renderBlock(block: ScheduledBlock, lane: Lane, style: { top: number; height: number }, position: CalendarColumn) {
    const isMoving = movingBlockId === block.id || (draft?.block?.id === block.id);
    const unavailable = isUnavailableBlock(block);
    const accent = blockAccentClasses(block);
    const compact = position.columnCount > 1 || viewMode === "week" || viewMode === "team" || style.height < 72;
    const short = style.height < 60;
    const tiny = style.height < 34;
    const reschedulable = !unavailable && canRescheduleBlock(block);
    const compactTimeRange = compact ? timeRangeLabel(block.startsAt, block.endsAt) : "";
    const displayGuidance = intervalDisplayGuidance(block.startsAt, block.endsAt);
    const guidanceId = `calendar-block-time-${block.id}-${lane.key}`;
    return (
      <article
        key={block.id}
        data-testid="calendar-block"
        data-calendar-block-id={block.id}
        tabIndex={0}
        aria-label={`${block.title} ${statusLabel(block)} ${timeLabel(block.startsAt)} to ${timeLabel(block.endsAt)}`}
        aria-describedby={displayGuidance ? guidanceId : undefined}
        title={`${block.title} · ${timeLabel(block.startsAt)} to ${timeLabel(block.endsAt)}${displayGuidance ? `. ${displayGuidance}` : ""}`}
        onKeyDown={(event) => handleBlockKeyDown(event, block)}
        onPointerDownCapture={(event) => {
          if ((event.target as HTMLElement).closest("[data-calendar-drag-handle='true']")) beginBlockMove(event, block, lane.date);
        }}
        onMouseDownCapture={(event) => {
          if ((event.target as HTMLElement).closest("[data-calendar-drag-handle='true']")) beginBlockMove(event, block, lane.date);
        }}
        className={`absolute left-1 right-1 overflow-hidden rounded-xl border text-xs shadow-sm transition focus:outline-none focus:ring-2 focus:ring-cyan-500 ${tiny ? "px-1.5 py-0" : compact ? "px-1.5 py-0.5" : "p-2"} ${blockClasses(block)} ${isMoving ? "opacity-40 ring-2 ring-cyan-300" : "hover:shadow-md"}`}
        style={{ ...style, ...packedHorizontalStyle(position) }}
        onClick={(event) => {
          if (movingBlockId === block.id || draft?.block?.id === block.id) return;
          popoverReturnFocusRef.current = event.currentTarget;
          setSelectedBlock({ block, x: event.clientX, y: event.clientY });
        }}
      >
        {displayGuidance && <span id={guidanceId} className="sr-only">{displayGuidance}</span>}
        {reschedulable && (
          <button type="button" data-testid="calendar-block-resize-start" onPointerDown={(event) => beginBlockResize(event, block, lane.date, "start")} onMouseDown={(event) => beginBlockResize(event, block, lane.date, "start")} onClick={(event) => event.stopPropagation()} className={`absolute left-4 right-4 top-0 cursor-ns-resize rounded-b-full bg-white/60 hover:bg-white ${tiny ? "h-0.5" : compact ? "h-1" : "h-2"}`} aria-label={`Resize start for ${block.title}`} />
        )}
        {compact ? <>
          <p className={`truncate font-bold leading-4 ${tiny && reschedulable ? "pr-4" : ""}`}>{block.title}</p>
          {!tiny && <p className={`truncate text-[10px] leading-3 ${short && reschedulable ? "pr-5" : ""} ${accent}`}>{compactTimeRange}</p>}
          <div className={tiny ? "absolute right-1 top-1/2 flex -translate-y-1/2" : short ? "absolute bottom-0.5 right-1 flex" : `mt-1 flex items-center justify-between gap-1 ${accent}`}>
            {!short && <span data-testid="calendar-block-status" className="truncate text-[9px] font-semibold">{statusLabel(block)}</span>}
            {!short && !unavailable && canOperateOwnTime(block) && hasRunningTimer(block) && <a href="/dashboard" onClick={(event) => event.stopPropagation()} className="shrink-0 text-[10px] leading-3 underline">View timer</a>}
            {reschedulable && <button type="button" data-calendar-drag-handle="true" onPointerDown={(event) => beginBlockMove(event, block, lane.date)} onMouseDown={(event) => beginBlockMove(event, block, lane.date)} onClick={(event) => event.stopPropagation()} className={`shrink-0 rounded bg-white/75 transition hover:bg-white ${short ? "p-0" : "p-0.5"}`} aria-label={`Drag to reschedule ${block.title}`} title="Drag to reschedule"><GripVertical className={`h-3 w-3 ${accent}`} /></button>}
          </div>
        </> : <>
        <div className="flex items-start justify-between gap-2">
          {!unavailable && canRescheduleBlock(block) ? (
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
          {canRecordBlockTime(block) && (
            <button onClick={(event) => { event.stopPropagation(); startBlock(block); }} className="rounded-full bg-white/70 p-1" aria-label="Start timer from scheduled work"><Play className={`h-3 w-3 fill-current ${accent}`} /></button>
          )}
        </div>
        <div className={`mt-1 flex flex-wrap gap-2 text-[10px] font-bold ${accent}`}>
          {canRecordBlockTime(block) && <button onClick={(event) => { event.stopPropagation(); logCompletedBlock(block, event.currentTarget); }} className="inline-flex items-center gap-1"><SquarePen className="h-3 w-3" />Log</button>}
          {!unavailable && canOperateOwnTime(block) && hasRunningTimer(block) && <a href="/dashboard" onClick={(event) => event.stopPropagation()} className="underline">View timer</a>}
          {!unavailable && canRescheduleBlock(block) && <button onClick={(event) => { event.stopPropagation(); moveToNextOpenSlot(block); }}>Next slot</button>}
          {!unavailable && canRescheduleBlock(block) && <button onClick={(event) => { event.stopPropagation(); skipBlock(block); }}>Skip</button>}
        </div>
        </>}
        {reschedulable && (
          <button type="button" data-testid="calendar-block-resize-end" onPointerDown={(event) => beginBlockResize(event, block, lane.date, "end")} onMouseDown={(event) => beginBlockResize(event, block, lane.date, "end")} onClick={(event) => event.stopPropagation()} className={`absolute bottom-0 left-4 right-4 cursor-ns-resize rounded-t-full bg-white/60 hover:bg-white ${tiny ? "h-0.5" : compact ? "h-1" : "h-2"}`} aria-label={`Resize end for ${block.title}`} />
        )}
      </article>
    );
  }

  function renderGrid() {
    if (loading || !mounted) {
      return (
        <div className="flex h-[calc(100vh-64px)] items-center justify-center p-8">
          <div className="flex flex-col items-center gap-4 text-slate-500">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-cyan-600"></div>
            <p className="text-sm font-medium">Loading calendar...</p>
          </div>
        </div>
      );
    }
    const laneLayouts = lanes.map((lane) => {
      const plannedLayout = blocksForLane(lane).filter((block) => visibleInHourRange(lane.date, block.startsAt, block.endsAt))
        .map((block) => ({ block, style: clampEventStyle(lane.date, block.startsAt, block.endsAt) }));
      const loggedLayout = entriesForLane(lane).filter((entry) => visibleInHourRange(lane.date, entry.startedAt, entryEnd(entry, now)))
        .map((entry) => ({ entry, style: clampEventStyle(lane.date, entry.startedAt, entryEnd(entry, now)) }));
      const positions = packCalendarIntervals([
        ...plannedLayout.map(({ block, style }) => ({ id: `planned:${block.id}`, ...style })),
        ...loggedLayout.map(({ entry, style }) => ({ id: `recorded:${entry.id}`, ...style })),
      ]);
      const columnCount = Math.max(1, ...Array.from(positions.values(), (position) => position.columnCount));
      // Each card gets >=80px, plus its two 4px gutters and the lane's border.
      const minWidth = Math.max(viewMode === "team" ? 170 : viewMode === "week" ? 130 : 0, columnCount * 88 + 1);
      return { lane, plannedLayout, loggedLayout, positions, minWidth };
    });
    const timeWidth = viewMode === "day" ? 52 : 72;
    const gridTemplateColumns = `${timeWidth}px ${laneLayouts.map(({ minWidth }) => `minmax(${minWidth}px, 1fr)`).join(" ")}`;
    const gridMinWidth = Math.max(viewMode === "team" ? 1080 : viewMode === "week" ? 1040 : 0, timeWidth + laneLayouts.reduce((sum, lane) => sum + lane.minWidth, 0));
    return (
      <div className="max-h-[68dvh] min-h-[380px] flex-1 overflow-auto overscroll-contain" data-testid="calendar-scroll-area">
        <div style={{ minWidth: gridMinWidth }}>
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
            {laneLayouts.map(({ lane, plannedLayout, loggedLayout, positions }) => {
              const draftForLane = draft && dateKey(draft.startsAt) === dateKey(lane.date) && (!lane.userId || !draft.userId || draft.userId === lane.userId) ? draft : null;
              const draftStyle = draftForLane ? clampEventStyle(lane.date, draftForLane.startsAt, draftForLane.endsAt) : null;
              const hasWork = plannedLayout.length > 0 || loggedLayout.length > 0;
              const nowDate = new Date(now);
              const nowMinute = dayMinute(lane.date, nowDate);
              const showNow = dateKey(lane.date) === dateKey(nowDate) && nowMinute >= visibleStartMinutes && nowMinute < visibleEndMinutes;
              return (
                <div key={lane.key} data-day-column data-day-key={dateKey(lane.date)} data-user-id={lane.userId ?? ""} className="relative border-r border-slate-200" style={{ height: hours.length * HOUR_HEIGHT }}>
                  {hours.map((hour) => {
                    const slotValue = `${dateKey(lane.date)}T${String(hour).padStart(2, "0")}:00`;
                    const slotStart = new Date(slotValue);
                    const missingHour = localInput(slotStart) !== slotValue;
                    const clockLabel = timeLabel(new Date(2020, 0, 1, hour));
                    return (
                      // Ref access occurs only when these DOM events run, not while renderGrid builds the slots.
                      // eslint-disable-next-line react-hooks/refs
                      <button key={`${lane.key}-${hour}`} type="button" disabled={missingHour} data-calendar-slot="true" onPointerDown={(event) => beginSlotDrag(event, lane)} onMouseDown={(event) => beginSlotDrag(event, lane)} onClick={(event) => { if (isMobile || event.detail === 0) openComposer({ mode: "scheduled", startAt: slotStart, userId: lane.userId, trigger: event.currentTarget }); }} className="block w-full border-b border-slate-100 px-2 text-left text-[11px] text-transparent transition hover:bg-cyan-50 hover:text-cyan-700 disabled:bg-slate-100 disabled:text-slate-500" style={{ height: HOUR_HEIGHT }} aria-label={missingHour ? `${clockLabel} does not occur on ${lane.label}; clocks move forward` : `Schedule work ${lane.label} ${timeLabel(slotStart)}`}>{missingHour ? "Clocks move forward" : isMobile ? "Tap to add" : "Drag to add"}</button>
                    );
                  })}
                  {!hasWork && <div data-testid="calendar-empty-day-hint" className="pointer-events-none absolute left-3 right-3 top-4 rounded-2xl border border-dashed border-slate-200 bg-white/70 p-3 text-xs text-slate-400">{isMobile ? "Tap a time to schedule work." : "Drag to schedule work, log time, or mark yourself unavailable."}</div>}
                  {draftForLane && draftStyle && (
                    <div className={`pointer-events-none absolute left-1 right-1 z-20 overflow-hidden rounded-xl border border-dashed px-1.5 text-xs shadow-sm ${draftStyle.height < 34 ? "py-0" : "py-0.5"} ${draftForLane.kind === "selection" ? "border-cyan-500 bg-cyan-100/85 text-cyan-950" : "border-slate-400 bg-white/90 text-slate-800"}`} style={draftStyle}>
                      <p className="truncate font-bold leading-4">{draftForLane.kind === "resize" ? "Resize block" : draftForLane.kind === "move" ? "Move block here" : "New work block"}</p>
                      {draftStyle.height >= 34 && <p className="truncate text-[10px] leading-3">{timeRangeLabel(draftForLane.startsAt, draftForLane.endsAt)}</p>}
                    </div>
                  )}
                  {plannedLayout.map(({ block, style }) => renderBlock(block, lane, style, positions.get(`planned:${block.id}`)!))}
                  {loggedLayout.map(({ entry, style }) => {
                    const tiny = style.height < 34;
                    const color = entry.source === "manual" ? "border-amber-200 bg-amber-50 text-amber-800" : entry.source === "calendar" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-700";
                    const title = entry.taskId || "Logged time";
                    const displayGuidance = intervalDisplayGuidance(entry.startedAt, entryEnd(entry, now));
                    const rangeDescription = `${timeLabel(entry.startedAt)} to ${timeLabel(entryEnd(entry, now))}${displayGuidance ? `. ${displayGuidance}` : ""}`;
                    const rangeId = `calendar-entry-time-${entry.id}-${lane.key}`;
                    const hoverDescription = `${title} · ${rangeDescription}`;
                    const content = <><p className="truncate font-bold leading-4">{title}</p>{!tiny && <p className="truncate text-[10px] leading-3">{timeRangeLabel(entry.startedAt, entryEnd(entry, now))}</p>}<span id={rangeId} className="sr-only">{rangeDescription}</span></>;
                    return <article key={entry.id} title={hoverDescription} aria-describedby={rangeId} className={`absolute overflow-hidden rounded-xl border px-1.5 text-xs shadow-sm ${tiny ? "py-0" : "py-0.5"} ${color}`} style={{ ...style, ...packedHorizontalStyle(positions.get(`recorded:${entry.id}`)!) }}>{entry.userId === session?.sub ? <a href={entry.stoppedAt ? "/activity" : "/dashboard"} aria-label={entry.stoppedAt ? `Review ${title} in Activity` : `Go to timer for ${title}`} aria-describedby={rangeId} title={hoverDescription} className="block h-full rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600">{content}</a> : content}</article>;
                  })}
                  {showNow && <div data-testid="calendar-now-marker" role="note" aria-label={`Current time ${timeLabel(nowDate)}`} className="pointer-events-none absolute inset-x-0 z-30 border-t border-cyan-600" style={{ top: (nowMinute - visibleStartMinutes) / 60 * HOUR_HEIGHT }}><span aria-hidden="true" className="absolute right-1 -translate-y-1/2 rounded bg-white px-1 text-[10px] font-semibold text-cyan-800">Now {timeLabel(nowDate)}</span></div>}
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
  const selectedDisplayGuidance = selectedBlock ? intervalDisplayGuidance(selectedBlock.block.startsAt, selectedBlock.block.endsAt) : null;
  const composerConflicts = composerMode !== "calendar" ? conflictsForRange(new Date(eventStart), new Date(eventEnd), eventUserId ?? session?.sub, editingBlock?.id) : [];
  const startClockHint = clockChangeHint(eventStart, editingBlock?.startsAt);
  const endClockHint = clockChangeHint(eventEnd, editingBlock?.endsAt);
  const editingStructureLocked = Boolean(editingBlock && !canChangeBlockStructure(editingBlock));
  const popoverStyle = draft && !isMobile && mounted ? {
    left: Math.min(Math.max(16, draft.x + 14), Math.max(16, window.innerWidth - 384)),
    top: Math.min(Math.max(16, draft.y + 14), Math.max(16, window.innerHeight - 320)),
  } : undefined;
  const selectedStyle = selectedBlock && !isMobile && mounted ? {
    left: Math.min(Math.max(16, selectedBlock.x + 14), Math.max(16, window.innerWidth - 400)),
    top: Math.min(Math.max(16, selectedBlock.y + 14), Math.max(16, window.innerHeight - 380)),
  } : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {!composerOpen && !draft && !selectedBlock && renderScheduleSaveNotice()}
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            <button disabled={savingEvent || savingBatch || Boolean(pendingScheduleSave)} onClick={(event) => openComposer({ mode: "scheduled", trigger: event.currentTarget })} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"><CalendarPlus className="h-4 w-4" /> Schedule work</button>
            <button disabled={savingEvent || savingBatch || Boolean(pendingScheduleSave)} onClick={(event) => openComposer({ mode: "calendar", trigger: event.currentTarget })} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> Log completed time</button>
            <button disabled={savingEvent || savingBatch || Boolean(pendingScheduleSave)} onClick={(event) => openComposer({ mode: "unavailable", trigger: event.currentTarget })} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-slate-400 hover:text-slate-950 disabled:opacity-50"><Bell className="h-4 w-4" /> Mark unavailable</button>
          </div>
        </div>
      </div>

      {!loadError && !loading && (upcomingBlocks.length > 0 || missedBlocks.length > 0) && (
        <details className="rounded-2xl border border-slate-200 bg-white p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Schedule reminders ({upcomingBlocks.length + missedBlocks.length})</summary><div className="mt-3 grid gap-3 lg:grid-cols-2">
          {upcomingBlocks.length > 0 && <div className="rounded-[24px] border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900"><div className="flex items-center gap-2 font-bold"><Bell className="h-4 w-4" /> Starting soon</div>{upcomingBlocks.map((block) => <p key={block.id} className="mt-2">{block.title} starts at {timeLabel(block.startsAt)}.</p>)}</div>}
          {missedBlocks.length > 0 && <div className="rounded-[24px] border border-amber-100 bg-amber-50 p-4 text-sm text-amber-900"><div className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" /> Missed planned work</div><div className="mt-2 space-y-2">{missedBlocks.map((block) => <div key={block.id} className="flex flex-wrap items-center justify-between gap-2"><span>{block.title} · {timeLabel(block.startsAt)}</span><span className="flex gap-2">{canRecordBlockTime(block) && <button className="font-bold underline" onClick={() => logCompletedBlock(block)}>Log it</button>}<button className="font-bold underline" onClick={() => moveToNextOpenSlot(block)}>Reschedule</button><button className="font-bold underline" onClick={() => skipBlock(block)}>Skip</button></span></div>)}</div></div>}
        </div></details>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-visible rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">{mounted ? (viewMode === "week" ? weekRangeLabel : viewMode === "team" || viewMode === "day" ? `${currentDate.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}${viewMode === "team" ? " · Team" : ""}` : `${currentDate.toLocaleString("default", { month: "long" })} ${currentDate.getFullYear()}`) : "Loading..."}</h2>
            <p className="text-sm text-slate-500">{viewMode === "team" ? "Team schedule" : viewMode === "week" ? "Drag a time range to schedule work." : viewMode === "day" ? "Tap a time to schedule work." : "Planned and logged work this month. Use + on a date to add work."}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex flex-wrap rounded-2xl bg-slate-100 p-1">
              <button onClick={() => setViewMode("day")} aria-pressed={viewMode === "day"} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-bold transition ${viewMode === "day" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"}`}>Day</button>
              <button aria-pressed={viewMode === "week"} onClick={() => setViewMode("week")} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-bold transition ${viewMode === "week" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"}`}><CalendarDays className="h-4 w-4" />Week</button>
              {isManager && <button aria-pressed={viewMode === "team"} onClick={() => setViewMode("team")} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-bold transition ${viewMode === "team" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"}`}><UsersRound className="h-4 w-4" />Team</button>}
              <button aria-pressed={viewMode === "month"} onClick={() => setViewMode("month")} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-bold transition ${viewMode === "month" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"}`}><LayoutGrid className="h-4 w-4" />Month</button>
            </div>
            <label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-600">Go to date<input ref={calendarDateRef} type="date" value={dateKey(currentDate)} aria-invalid={Boolean(navigationError) || undefined} aria-describedby={navigationError ? "calendar-navigation-error" : undefined} onChange={(event) => jumpToDate(event.target.value)} className="h-10 min-w-0 rounded-xl border border-slate-200 bg-white px-2 text-sm font-normal text-slate-700" /></label>
            <details className="min-w-0 max-w-full"><summary className="cursor-pointer rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Calendar hours</summary><div className="mt-2 grid w-64 max-w-full grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-3">
            <select aria-label="Visible start hour" value={visibleStartHour} onChange={(event) => setVisibleStartHour(Number(event.target.value))} className="h-10 min-w-0 rounded-xl border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 sm:text-sm">{Array.from({ length: 24 }, (_, i) => i).map((hour) => <option key={hour} value={hour} disabled={hour >= visibleEndHour}>{timeLabel(new Date(2020, 0, 1, hour))}</option>)}</select>
            <select aria-label="Visible end hour" value={visibleEndHour} onChange={(event) => setVisibleEndHour(Number(event.target.value))} className="h-10 min-w-0 rounded-xl border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 sm:text-sm">{Array.from({ length: 24 }, (_, i) => i + 1).map((hour) => <option key={hour} value={hour} disabled={hour <= visibleStartHour}>{hour === 24 ? "Midnight" : timeLabel(new Date(2020, 0, 1, hour))}</option>)}</select>
            <button onClick={saveWorkingHours} disabled={savingHours} className="col-span-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">{savingHours ? "Saving..." : "Save hours"}</button></div></details>
            <div role="group" aria-label="Calendar navigation" className="inline-flex shrink-0 flex-nowrap items-center gap-2">
              <button onClick={() => navigateToDate(viewMode === "month" ? new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1) : addDays(currentDate, viewMode === "team" || viewMode === "day" ? -1 : -7))} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" aria-label="Previous period"><ChevronLeft className="h-5 w-5" /></button>
              <button onClick={() => navigateToDate(new Date())} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Today</button>
              <button onClick={() => navigateToDate(viewMode === "month" ? new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1) : addDays(currentDate, viewMode === "team" || viewMode === "day" ? 1 : 7))} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" aria-label="Next period"><ChevronRight className="h-5 w-5" /></button>
            </div>
          </div>
        </div>

        {navigationError && <p id="calendar-navigation-error" role="alert" className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-900">{navigationError}</p>}
        <p data-testid="calendar-timezone-cue" className="border-b border-slate-100 px-5 py-2 text-xs text-slate-500">Times shown in browser timezone {browserTimezone}{browserTimezone !== userTimezone ? ` · Account timezone ${userTimezone}` : ""}</p>
        {viewMode === "month" && <p className="border-b border-slate-100 px-5 py-2 text-xs text-slate-500">Daily totals split overnight entries across days. Time after breaks is allocated proportionally across the entry&apos;s time range.</p>}
        {loadError ? <div role="alert" className="m-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"><p>Could not load your calendar. Check your connection and try again.</p><button ref={calendarRetryRef} type="button" onClick={() => void fetchData()} disabled={loading} className="mt-3 font-semibold underline">{loading ? "Retrying..." : "Retry calendar"}</button></div> : loading || !mounted ? <div className="p-10 text-center text-slate-500">Loading calendar...</div> : viewMode === "month" ? (
          <div className="max-h-[68dvh] min-h-0 flex-1 overflow-auto">
            <div className="grid min-w-[700px] grid-cols-7 bg-slate-50 text-center text-xs font-bold uppercase tracking-wider text-slate-500">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="border-b border-slate-200 py-3">{day}</div>)}</div>
            <div className="grid min-h-full min-w-[700px] grid-cols-7 auto-rows-[minmax(155px,1fr)]">
              {monthDays.map((cell, index) => {
                if (!cell) return <div key={`empty-${index}`} className="border-b border-r border-slate-100 bg-slate-50/60" />;
                const cellDate = new Date(`${cell.dateStr}T00:00`);
                const lane = { key: cell.dateStr, label: cell.dateStr, date: cellDate, userId: session?.sub };
                const blocksForDay = blocksForLane(lane).sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
                const entriesForDay = entriesForLane(lane);
                const totalSeconds = entriesForDay.reduce((sum, entry) => sum + loggedSecondsForDay(cellDate, entry), 0);
                const isToday = cell.dateStr === dateKey(new Date());
                const expanded = expandedMonthDays.has(cell.dateStr);
                const dateLabel = cellDate.toLocaleDateString(undefined, { month: "long", day: "numeric" });
                return <div key={cell.dateStr} onDoubleClick={(event) => {
                  if ((event.target as HTMLElement).closest("button")) return;
                  openComposer({ dateStr: cell.dateStr, mode: "scheduled", trigger: event.currentTarget.querySelector<HTMLElement>("[data-calendar-add]") ?? undefined });
                }} className={`border-b border-r border-slate-100 p-2 ${isToday ? "bg-cyan-50" : "bg-white"}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${isToday ? "bg-cyan-600 text-white" : "text-slate-500"}`}>{cell.dayNumber}</span>
                    <button data-calendar-add onClick={(event) => openComposer({ dateStr: cell.dateStr, mode: "scheduled", trigger: event.currentTarget })} className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-cyan-700" aria-label={`Add calendar event on ${dateLabel}`}><Plus className="h-3 w-3" /></button>
                  </div>
                  <div id={`calendar-events-${cell.dateStr}`} className="space-y-1.5">
                    {(expanded ? blocksForDay : blocksForDay.slice(0, 3)).map((block) => <button key={block.id} type="button" data-calendar-block-id={block.id} onClick={(event) => {
                      popoverReturnFocusRef.current = event.currentTarget;
                      const bounds = event.currentTarget.getBoundingClientRect();
                      setSelectedBlock({ block, x: bounds.left, y: bounds.top });
                    }} aria-label={`${block.title} ${statusLabel(block)} ${timeLabel(block.startsAt)} to ${timeLabel(block.endsAt)}`} className={`block w-full rounded-xl border px-2 py-1.5 text-left text-xs transition focus:outline-none focus:ring-2 focus:ring-cyan-500 ${blockClasses(block)}`}>
                      <span className="flex items-center justify-between gap-2"><span className="truncate font-semibold">{block.title}</span><span className="text-[9px] font-bold uppercase">{statusLabel(block)}</span></span>
                      <span className="mt-1 block text-[10px]">{timeLabel(block.startsAt)} - {timeLabel(block.endsAt)}</span>
                    </button>)}
                  </div>
                  {blocksForDay.length > 3 && <button type="button" aria-expanded={expanded} aria-controls={`calendar-events-${cell.dateStr}`} aria-label={expanded ? `Show fewer events on ${dateLabel}` : `Show ${blocksForDay.length - 3} more events on ${dateLabel}`} onClick={() => setExpandedMonthDays((current) => {
                    const next = new Set(current);
                    if (next.has(cell.dateStr)) next.delete(cell.dateStr); else next.add(cell.dateStr);
                    return next;
                  })} className="mt-2 rounded-lg px-1 py-1 text-xs font-semibold text-cyan-700 underline">{expanded ? "Show fewer" : `+${blocksForDay.length - 3} more`}</button>}
                  {totalSeconds > 0 && <div className="mt-1.5 flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700"><span className="flex items-center gap-1"><Clock className="h-3 w-3" />Logged</span><strong>{formatHours(totalSeconds)}</strong></div>}
                </div>;
              })}
            </div>
          </div>
        ) : renderGrid()}
      </div>

      {draft && !composerOpen && !dragState && (
        <CalendarPopover onClose={closeSelection} returnFocusRef={popoverReturnFocusRef} className={`fixed z-[110] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-4 text-slate-950 shadow ${isMobile ? "inset-x-3 bottom-3" : "w-[22rem]"}`} style={popoverStyle} label={draft.kind === "selection" ? "Create calendar work block" : draft.kind === "resize" ? "Resize scheduled work" : "Move scheduled work"}>
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">{draft.kind === "selection" ? "Selected time" : draft.kind === "resize" ? "Resize" : "Reschedule"}</p><h3 className="mt-1 text-lg font-semibold">{draft.block?.title ?? "Schedule this time"}</h3><p className="mt-1 text-sm text-slate-500">{draft.startsAt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {timeLabel(draft.startsAt)} - {timeLabel(draft.endsAt)}</p></div><button onClick={() => { setDraft(null); setMovingBlockId(null); }} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Dismiss calendar selection"><X className="h-4 w-4" /></button></div>
          {draft.clockError && <p role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{draft.clockError}</p>}
          {draftConflicts.length > 0 && <div data-testid="calendar-conflict-warning" className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><div className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" />{draftConflicts.length} conflict(s)</div><p className="mt-1">Overlaps {draftConflicts.slice(0, 2).map((conflict) => conflict.label).join(", ")}.</p></div>}
          <div className="mt-3">{renderScheduleSaveNotice()}</div>
          {draft.kind === "selection" ? (
            <fieldset disabled={savingBatch || Boolean(pendingScheduleSave) || Boolean(draft.clockError)} className="mt-4 min-w-0 space-y-3 border-0 p-0 disabled:opacity-60">
              <input aria-label="Work title" value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} className="h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500" placeholder="Work title" />
              <div className="flex flex-wrap gap-2">
                <button onClick={() => createQuickDraft()} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">{savingBatch ? "Saving..." : "Save plan"}</button>
                <button onClick={() => openComposerFromDraft("calendar")} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Log completed</button>
                <button onClick={() => openComposerFromDraft("unavailable")} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Unavailable</button>
              </div>
              {draftConflicts.length > 0 && <div className="flex flex-wrap gap-2 text-xs">
                <button onClick={() => { const next = findNextOpenSlot(draft.endsAt, minuteDuration(draft.startsAt, draft.endsAt), draft.userId ?? session?.sub); if (next) setDraft({ ...draft, ...next }); }} className="font-bold text-cyan-700 underline">Move next open</button>
                <button onClick={() => createQuickDraft({ shorten: true })} className="font-bold text-cyan-700 underline">Shorten</button>
                {draftConflicts.some((conflict) => conflict.kind === "planned") && <button onClick={() => createQuickDraft({ replace: true })} className="font-bold text-cyan-700 underline">Replace planned</button>}
              </div>}
              <button onClick={() => openComposerFromDraft("scheduled")} className="text-xs font-bold text-slate-500 underline">Plan work</button>
            </fieldset>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2"><button onClick={applyDraftMove} disabled={reschedulingBlock || Boolean(draft.clockError)} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{reschedulingBlock ? "Saving..." : draft.kind === "resize" ? "Resize block" : "Move block"}</button>{draft.block && <button disabled={Boolean(draft.clockError)} onClick={() => { if (draft.clockError) return; openComposer({ mode: "scheduled", block: draft.block }); setDraft(null); setMovingBlockId(null); }} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60">Edit details</button>}</div>
          )}
        </CalendarPopover>
      )}

      {selectedBlock && !composerOpen && (
        <CalendarPopover key={selectedBlock.block.id} onClose={closeBlockActions} returnFocusRef={popoverReturnFocusRef} className={`fixed z-[110] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-4 text-slate-950 shadow ${isMobile ? "inset-x-3 bottom-3" : "w-[23rem]"}`} style={selectedStyle} label="Scheduled work actions">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">{statusLabel(selectedBlock.block)}</p><h3 className="mt-1 text-lg font-semibold">{selectedBlock.block.title}</h3><p className="mt-1 text-sm text-slate-500">{timeLabel(selectedBlock.block.startsAt)} - {timeLabel(selectedBlock.block.endsAt)}</p></div><button onClick={() => setSelectedBlock(null)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close scheduled work actions"><X className="h-4 w-4" /></button></div>
          {selectedDisplayGuidance && <p className="mt-2 text-xs text-slate-600">{selectedDisplayGuidance}</p>}
          {selectedBlockConflicts.length > 0 && <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><AlertTriangle className="mr-1 inline h-4 w-4" />Overlaps {selectedBlockConflicts.length} item(s).</div>}
          {renderBlockTimeGuidance(selectedBlock.block)}
          <div className="mt-3">{renderScheduleSaveNotice()}</div>
          {canEditBlockDetails(selectedBlock.block) && <div className="mt-4 grid grid-cols-2 gap-2 text-sm font-semibold">
            {canRecordBlockTime(selectedBlock.block) && <button onClick={() => startBlock(selectedBlock.block)} className="rounded-xl bg-slate-950 px-3 py-2 text-white"><Play className="mr-1 inline h-4 w-4" />Start</button>}
            {canRecordBlockTime(selectedBlock.block) && <button onClick={() => logCompletedBlock(selectedBlock.block)} className="rounded-xl border border-slate-200 px-3 py-2 text-slate-700"><CheckCircle2 className="mr-1 inline h-4 w-4" />Complete</button>}
            <button disabled={savingBatch || Boolean(pendingScheduleSave)} onClick={() => duplicateBlock(selectedBlock.block)} className="rounded-xl border border-slate-200 px-3 py-2 text-slate-700 disabled:opacity-50"><Copy className="mr-1 inline h-4 w-4" />Duplicate</button>
            {canRescheduleBlock(selectedBlock.block) && <button onClick={() => moveToNextOpenSlot(selectedBlock.block)} className="rounded-xl border border-slate-200 px-3 py-2 text-slate-700"><SkipForward className="mr-1 inline h-4 w-4" />Next slot</button>}
            <button onClick={() => openComposer({ mode: isUnavailableBlock(selectedBlock.block) ? "unavailable" : "scheduled", block: selectedBlock.block })} className="rounded-xl border border-slate-200 px-3 py-2 text-slate-700"><Pencil className="mr-1 inline h-4 w-4" />Edit</button>
            {canRescheduleBlock(selectedBlock.block) && !isUnavailableBlock(selectedBlock.block) && <button onClick={() => skipBlock(selectedBlock.block)} className="rounded-xl border border-slate-200 px-3 py-2 text-slate-700">Skip</button>}
            {canChangeBlockStructure(selectedBlock.block) && <button onClick={() => cancelBlock(selectedBlock.block)} className="rounded-xl border border-red-100 px-3 py-2 text-red-700"><Trash2 className="mr-1 inline h-4 w-4" />Cancel</button>}
          </div>}
          {canRescheduleBlock(selectedBlock.block) && <p className="mt-3 text-xs text-slate-500">Keyboard: focus a block, then use arrows to nudge by 15 minutes or days. Hold Shift for one-hour vertical moves.</p>}
        </CalendarPopover>
      )}

      {composerOpen && (
        <ModalDialog label="Calendar event composer" onClose={closeComposer} initialFocusRef={composerTitleRef} returnFocusRef={composerReturnFocusRef} className="inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl rounded-[28px] border border-slate-200 bg-white text-slate-950 shadow-2xl backdrop:bg-slate-950/55 backdrop:backdrop-blur-sm">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-6 sm:py-5"><div><h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{composerMode === "scheduled" ? "Schedule work" : composerMode === "unavailable" ? "Mark unavailable" : "Log completed work"}</h2><p className="mt-1 text-sm text-slate-500">{editingBlock ? "Update this calendar event." : "Set the time and add the details."}</p></div><button onClick={closeComposer} disabled={savingEvent && !savingBatch} className="shrink-0 rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50" aria-label="Close calendar composer"><X className="h-5 w-5" /></button></div>
            <div className="min-h-0 overflow-y-auto overscroll-contain">
            {(pendingScheduleSave || scheduleSaveError || scheduleRecoveryWarning) && <div className="px-4 pt-3 sm:px-6">{renderScheduleSaveNotice()}</div>}
            <fieldset disabled={savingEvent || savingBatch || Boolean(pendingScheduleSave)} className="min-w-0 border-0 p-0">
            <div className="border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
              <div className="flex flex-wrap rounded-2xl bg-slate-100 p-1">
                <button aria-pressed={composerMode === "scheduled"} onClick={() => setComposerMode("scheduled")} className={`rounded-full px-3 py-2 text-sm font-bold transition ${composerMode === "scheduled" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"}`}>Scheduled work</button>
                <button aria-pressed={composerMode === "calendar"} disabled={Boolean(editingBlock && !canRecordBlockTime(editingBlock))} onClick={() => setComposerMode("calendar")} className={`rounded-full px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${composerMode === "calendar" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"}`}>Completed time</button>
                <button aria-pressed={composerMode === "unavailable"} disabled={editingStructureLocked} onClick={() => setComposerMode("unavailable")} className={`rounded-full px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${composerMode === "unavailable" ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"}`}>Unavailable</button>
              </div>
              {editingBlock && renderBlockTimeGuidance(editingBlock)}
              {editingStructureLocked && <p className="mt-2 text-xs text-slate-500">Only the title, notes, and tags can change after time is recorded.</p>}
            </div>
            {composerConflicts.length > 0 && <div className="mx-6 mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mr-2 inline h-4 w-4" />This time overlaps {composerConflicts.length} calendar item(s). Saving will allow the overlap.</div>}
            <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-6 sm:py-5">
              <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">Title<input ref={composerTitleRef} value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} className="h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" placeholder="Client review, proposal writing, design QA" /></label>
              <label className="space-y-1 text-sm font-medium text-slate-700">Project<select disabled={editingStructureLocked} value={eventProjectId} onChange={(event) => setEventProjectId(event.target.value)} className="h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white disabled:opacity-60"><option value="">No project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
              <label className="space-y-1 text-sm font-medium text-slate-700">Work type / rate<select disabled={editingStructureLocked || assigneeActions.loading || assigneeActions.userId !== eventUserId} value={eventActionId} onChange={(event) => setEventActionId(event.target.value)} className="h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white disabled:opacity-60"><option value="">No work type rate</option>{eventActionId && !assigneeActions.rows.some(action => action.id === eventActionId) && <option value={eventActionId}>Saved work type (unchanged)</option>}{assigneeActions.userId === eventUserId && assigneeActions.rows.map((action) => <option key={action.id} value={action.id}>{action.name}{action.hourlyRate != null ? ` ($${action.hourlyRate}/hr)` : ""}</option>)}</select></label>
              {(actionNotice || assigneeActions.error || assigneeActions.loading) && <p role="status" className="text-sm text-slate-600 sm:col-span-2">{assigneeActions.loading ? "Loading this assignee's work types…" : assigneeActions.error || actionNotice}</p>}
              <label className="space-y-1 text-sm font-medium text-slate-700">Work label<input disabled={editingStructureLocked} value={eventTaskId} onChange={(event) => setEventTaskId(event.target.value)} className="h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white disabled:opacity-60" placeholder="Client call, research review, design QA" /></label>
              {isManager && composerMode !== "calendar" && <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">Assignee<select disabled={editingStructureLocked} value={eventUserId ?? session?.sub ?? ""} onChange={(event) => {
                const userId = event.target.value;
                if (userId === eventUserId) return;
                actionReadGeneration.current++;
                setEventUserId(userId);
                setEventActionId("");
                setActionNotice("Work type cleared for the new assignee. Choose their work type or save without a rate.");
                setAssigneeActions({ userId, rows: [], loading: true, error: null });
              }} className="h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white disabled:opacity-60">{members.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}</select></label>}
              <div className="space-y-1">
                <label htmlFor="calendar-event-start" className="text-sm font-medium text-slate-700">Starts</label>
                <input id="calendar-event-start" aria-invalid={startClockHint?.invalid || undefined} aria-describedby={startClockHint ? "calendar-start-clock-hint" : undefined} disabled={editingStructureLocked} type="datetime-local" value={eventStart} onChange={(event) => setEventStart(event.target.value)} className="h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white disabled:opacity-60" />
                {startClockHint && <p id="calendar-start-clock-hint" role={startClockHint.invalid ? "alert" : undefined} className={`text-xs ${startClockHint.invalid ? "text-rose-700" : "text-slate-600"}`}>{startClockHint.message}</p>}
              </div>
              <div className="space-y-1">
                <label htmlFor="calendar-event-end" className="text-sm font-medium text-slate-700">Ends</label>
                <input id="calendar-event-end" aria-invalid={endClockHint?.invalid || undefined} aria-describedby={endClockHint ? "calendar-end-clock-hint" : undefined} disabled={editingStructureLocked} type="datetime-local" value={eventEnd} onChange={(event) => setEventEnd(event.target.value)} className="h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white disabled:opacity-60" />
                {endClockHint && <p id="calendar-end-clock-hint" role={endClockHint.invalid ? "alert" : undefined} className={`text-xs ${endClockHint.invalid ? "text-rose-700" : "text-slate-600"}`}>{endClockHint.message}</p>}
              </div>
              <p className="text-xs text-slate-500 sm:col-span-2">Times are entered in {browserTimezone}.{browserTimezone !== userTimezone ? ` Your account timezone is ${userTimezone}.` : ""}</p>
              {composerMode !== "calendar" && !editingBlock && <><label className="space-y-1 text-sm font-medium text-slate-700">Repeat<Repeat className="ml-1 inline h-3 w-3" /><select value={repeatMode} onChange={(event) => setRepeatMode(event.target.value as RepeatMode)} className="h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white"><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label><label className="space-y-1 text-sm font-medium text-slate-700">Occurrences<input type="number" min={1} max={MAX_REPEAT_COUNT} value={repeatCount} onChange={(event) => setRepeatCount(Number(event.target.value))} className="h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" /></label></>}
              <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">Notes<input value={eventNotes} onChange={(event) => setEventNotes(event.target.value)} className="h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" placeholder="What should happen during this block?" /></label>
              <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">Tags<input value={eventTags} onChange={(event) => setEventTags(event.target.value)} className="h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" placeholder="research, review, billable" /></label>
            </div>
            </fieldset>
            </div>
            <div className="flex shrink-0 flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5"><p className="text-xs text-slate-500">{composerMode === "scheduled" ? "Appears in Calendar and Dashboard." : composerMode === "unavailable" ? "Reserves time without logging work." : "Completed time will appear in Activity."}</p><div className="flex flex-wrap gap-2"><button onClick={closeComposer} disabled={savingEvent && !savingBatch} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:opacity-50">{pendingScheduleSave ? "Close" : "Cancel"}</button><button onClick={saveEvent} disabled={savingEvent || savingBatch || Boolean(pendingScheduleSave)} className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60">{savingEvent || savingBatch ? "Saving..." : composerMode === "scheduled" ? "Save scheduled work" : composerMode === "unavailable" ? "Save unavailable block" : "Log completed work"}</button></div></div>
        </ModalDialog>
      )}
    </div>
  );
}
