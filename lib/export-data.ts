import { createHash } from "node:crypto";
import { and, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import {
  apiKeyRequests,
  auditLogs,
  clients,
  goals,
  invoices,
  memberships,
  projectTasks,
  projects,
  scheduledWorkBlocks,
  timeEntries,
  users,
  workspaces,
  workspaceTags as workspaceTagsTable,
} from "@/lib/db/schema";
import { toCsv } from "@/lib/security";

export type ExportFilters = {
  projectId?: string | null;
  start?: string | null;
  end?: string | null;
  userId?: string | null;
  status?: string | null;
  source?: string | null;
  include?: string | null;
  layout?: string | null;
};

type TimeEntryStatus = "draft" | "submitted" | "approved" | "invoiced";
type TimeEntrySource = "web" | "calendar" | "manual";

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseEndDate(value?: string | null) {
  const date = parseDate(value);
  if (!date) return null;
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) date.setDate(date.getDate() + 1);
  return date;
}

function includedSet(include?: string | null) {
  if (!include || include === "all") return null;
  return new Set(include.split(",").map((item) => item.trim()).filter(Boolean));
}

export async function loadExportData(workspaceId: string, filters: ExportFilters = {}) {
  await ensureWorkspaceSchema();

  const include = includedSet(filters.include);
  const wants = (key: string) => !include || include.has(key);
  const start = parseDate(filters.start);
  const end = parseEndDate(filters.end);

  const timeFilters = [eq(timeEntries.workspaceId, workspaceId)];
  if (filters.projectId) timeFilters.push(eq(timeEntries.projectId, filters.projectId));
  if (filters.userId) timeFilters.push(eq(timeEntries.userId, filters.userId));
  if (filters.status && ["draft", "submitted", "approved", "invoiced"].includes(filters.status)) {
    timeFilters.push(eq(timeEntries.status, filters.status as TimeEntryStatus));
  }
  if (filters.source === "scheduled") {
    timeFilters.push(isNotNull(timeEntries.scheduledBlockId));
  } else if (filters.source === "timer") {
    timeFilters.push(eq(timeEntries.source, "web"));
  } else if (filters.source && ["web", "calendar", "manual"].includes(filters.source)) {
    timeFilters.push(eq(timeEntries.source, filters.source as TimeEntrySource));
  }
  if (start) timeFilters.push(gte(timeEntries.startedAt, start));
  if (end) timeFilters.push(lt(timeEntries.startedAt, end));

  const projectFilter = filters.projectId ? and(eq(projects.workspaceId, workspaceId), eq(projects.id, filters.projectId)) : eq(projects.workspaceId, workspaceId);
  const taskFilter = filters.projectId ? and(eq(projectTasks.workspaceId, workspaceId), eq(projectTasks.projectId, filters.projectId)) : eq(projectTasks.workspaceId, workspaceId);
  const scheduleFilters = [eq(scheduledWorkBlocks.workspaceId, workspaceId)];
  if (filters.projectId) scheduleFilters.push(eq(scheduledWorkBlocks.projectId, filters.projectId));
  if (filters.userId) scheduleFilters.push(eq(scheduledWorkBlocks.userId, filters.userId));
  if (start) scheduleFilters.push(gte(scheduledWorkBlocks.startsAt, start));
  if (end) scheduleFilters.push(lt(scheduledWorkBlocks.startsAt, end));

  const [workspace] = wants("workspace") ? await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)) : [null];
  const workspaceClients = wants("clients") ? await db.select().from(clients).where(eq(clients.workspaceId, workspaceId)) : [];
  const workspaceProjects = wants("projects") ? await db.select().from(projects).where(projectFilter) : [];
  const workspaceTasks = wants("tasks") ? await db.select().from(projectTasks).where(taskFilter) : [];
  const workspaceSchedule = wants("schedule") ? await db.select().from(scheduledWorkBlocks).where(and(...scheduleFilters)) : [];
  const workspaceEntries = wants("timeEntries") ? await db.select().from(timeEntries).where(and(...timeFilters)) : [];
  const workspaceGoals = wants("goals") ? await db.select().from(goals).where(eq(goals.workspaceId, workspaceId)) : [];
  const workspaceTags = wants("tags") ? await db.select().from(workspaceTagsTable).where(eq(workspaceTagsTable.workspaceId, workspaceId)) : [];
  const workspaceInvoices = wants("invoices") ? await db.select().from(invoices).where(eq(invoices.workspaceId, workspaceId)) : [];
  const workspaceAuditLogs = wants("auditLogs") ? await db.select().from(auditLogs).where(eq(auditLogs.workspaceId, workspaceId)) : [];
  const workspaceApiRequests = wants("apiUsage") ? await db.select().from(apiKeyRequests).where(eq(apiKeyRequests.workspaceId, workspaceId)) : [];
  const workspaceMemberships = wants("memberships") ? await db.select().from(memberships).where(eq(memberships.workspaceId, workspaceId)) : [];
  const memberIds = workspaceMemberships.map((membership) => membership.userId);
  const workspaceUsers = wants("users") && memberIds.length > 0 ? await db.select().from(users).where(inArray(users.id, memberIds)) : [];

  return {
    exportedAt: new Date().toISOString(),
    filters,
    workspace,
    users: workspaceUsers,
    memberships: workspaceMemberships,
    clients: workspaceClients,
    projects: workspaceProjects,
    projectTasks: workspaceTasks,
    scheduledWorkBlocks: workspaceSchedule,
    timeEntries: workspaceEntries,
    tags: workspaceTags,
    goals: workspaceGoals,
    invoices: workspaceInvoices,
    auditLogs: workspaceAuditLogs,
    apiKeyUsage: workspaceApiRequests.map((request) => ({ ...request, ipHash: request.ipHash ? "redacted" : null })),
  };
}

export function exportRows(data: Awaited<ReturnType<typeof loadExportData>>) {
  const projectsById = new Map(data.projects.map((project) => [project.id, project]));
  const usersById = new Map(data.users.map((user) => [user.id, user]));
  return data.timeEntries.map((entry) => {
    const project = entry.projectId ? projectsById.get(entry.projectId) : null;
    const user = usersById.get(entry.userId);
    return {
      id: entry.id,
      userId: entry.userId,
      userEmail: user?.email ?? "",
      taskId: entry.taskId,
      projectId: entry.projectId ?? "",
      projectName: project?.name ?? "",
      scheduledBlockId: entry.scheduledBlockId ?? "",
      tags: entry.tags.join("|"),
      startedAtUtc: entry.startedAt.toISOString(),
      stoppedAtUtc: entry.stoppedAt ? entry.stoppedAt.toISOString() : "",
      durationSeconds: entry.durationSeconds ?? 0,
      status: entry.status,
      source: entry.source,
      action: entry.action ?? "",
      hourlyRate: entry.hourlyRate ?? "",
      expenses: JSON.stringify(entry.expenses),
    };
  });
}

export function exportSummaryRows(data: Awaited<ReturnType<typeof loadExportData>>) {
  const detailedRows = exportRows(data);
  const grouped = new Map<string, {
    date: string;
    userEmail: string;
    projectName: string;
    status: string;
    source: string;
    entryCount: number;
    totalDurationSeconds: number;
    totalHours: number;
  }>();

  for (const row of detailedRows) {
    const date = row.startedAtUtc.slice(0, 10);
    const key = [date, row.userEmail, row.projectName, row.status, row.source].join("|");
    const existing = grouped.get(key) ?? {
      date,
      userEmail: row.userEmail,
      projectName: row.projectName,
      status: row.status,
      source: row.source,
      entryCount: 0,
      totalDurationSeconds: 0,
      totalHours: 0,
    };
    existing.entryCount += 1;
    existing.totalDurationSeconds += Number(row.durationSeconds) || 0;
    existing.totalHours = Number((existing.totalDurationSeconds / 3600).toFixed(2));
    grouped.set(key, existing);
  }

  return [...grouped.values()].sort((left, right) => {
    if (left.date === right.date) return left.userEmail.localeCompare(right.userEmail);
    return left.date.localeCompare(right.date);
  });
}

export function createExportResponse(data: Awaited<ReturnType<typeof loadExportData>>, format: "csv" | "json", filenameBase: string) {
  const layout = data.filters.layout === "summary" ? "summary" : "detailed";
  const body = format === "json" ? JSON.stringify(data, null, 2) : toCsv(layout === "summary" ? exportSummaryRows(data) : exportRows(data));
  const digest = createHash("sha256").update(body).digest("hex");
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=${filenameBase}.${format}`,
      "x-billabled-export-sha256": digest,
    },
  });
}
