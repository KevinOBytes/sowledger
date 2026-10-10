import { createHash } from "node:crypto";
import { and, asc, eq, inArray, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { auditLogs, invoices, projects, scheduledWorkBlocks, timeEntries, users } from "@/lib/db/schema";
import { isUnavailableScheduledBlock } from "@/lib/scheduled-block-guards";
import { timeEntryAmountCents } from "@/lib/invoice-amount";

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };

function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function hours(seconds: number) {
  return Number((seconds / 3600).toFixed(2));
}

function sourceLabel(source: string) {
  if (source === "web") return "Timer";
  if (source === "calendar") return "Calendar";
  if (source === "manual") return "Manual";
  return source;
}

export type InvoiceProofPack = {
  invoice: {
    id: string;
    number: string;
    projectId: string | null;
    projectName: string;
    amount: number;
    status: string;
    dueDate: string | null;
    createdAt: string | null;
  };
  totals: {
    amount: number;
    entryCount: number;
    actualSeconds: number;
    actualHours: number;
    plannedSeconds: number;
    plannedHours: number;
    auditEventCount: number;
  };
  sourceMix: Array<{ source: string; label: string; seconds: number; hours: number; count: number }>;
  entries: Array<{
    id: string;
    userId: string;
    userEmail: string;
    projectId: string | null;
    projectName: string;
    scheduledBlockId: string | null;
    taskId: string;
    description: string | null;
    startedAt: string | null;
    stoppedAt: string | null;
    durationSeconds: number;
    hours: number;
    hourlyRate: number | null;
    amount: number;
    status: string;
    source: string;
    tags: string[];
  }>;
  plannedBlocks: Array<{
    id: string;
    title: string;
    startsAt: string | null;
    endsAt: string | null;
    plannedSeconds: number;
    status: string;
  }>;
  auditEvents: Array<{
    id: string;
    timeEntryId: string;
    actorUserId: string;
    eventType: string;
    diff: JsonValue;
    signature: string;
    createdAt: string | null;
  }>;
};

export type InvoiceProofPackResult = {
  proofPack: InvoiceProofPack;
  digest: string;
};

export async function buildInvoiceProofPack(workspaceId: string, invoiceId: string, client: Pick<typeof db, "select"> = db): Promise<InvoiceProofPackResult | null> {
  await ensureWorkspaceSchema();

  const [invoice] = await client
    .select()
    .from(invoices)
    .where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.id, invoiceId)));

  if (!invoice) return null;

  const entryIds = Array.isArray(invoice.timeEntryIds) ? invoice.timeEntryIds : [];
  const linkedEntries = entryIds.length > 0
    ? await client
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.workspaceId, workspaceId), inArray(timeEntries.id, entryIds))).orderBy(asc(timeEntries.id))
    : [];

  const projectIds = [...new Set([
    invoice.projectId,
    ...linkedEntries.map((entry) => entry.projectId),
  ].filter((value): value is string => Boolean(value)))];
  const userIds = [...new Set(linkedEntries.map((entry) => entry.userId))];
  const scheduledBlockIds = [...new Set(linkedEntries.map((entry) => entry.scheduledBlockId).filter((value): value is string => Boolean(value)))];

  const [workspaceProjects, workspaceUsers, workspaceBlocks, workspaceAuditLogs] = await Promise.all([
    projectIds.length > 0 ? client.select().from(projects).where(and(eq(projects.workspaceId, workspaceId), inArray(projects.id, projectIds))) : Promise.resolve([]),
    userIds.length > 0 ? client.select().from(users).where(inArray(users.id, userIds)) : Promise.resolve([]),
    scheduledBlockIds.length > 0 ? client.select().from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.workspaceId, workspaceId), inArray(scheduledWorkBlocks.id, scheduledBlockIds))).orderBy(asc(scheduledWorkBlocks.id)) : Promise.resolve([]),
    entryIds.length > 0
      ? client.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, workspaceId), inArray(auditLogs.timeEntryId, [...entryIds, invoiceId]), ne(auditLogs.eventType, "client_invoice_signed_off"))).orderBy(asc(auditLogs.createdAt), asc(auditLogs.id))
      : client.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, workspaceId), eq(auditLogs.timeEntryId, invoiceId), ne(auditLogs.eventType, "client_invoice_signed_off"))).orderBy(asc(auditLogs.createdAt), asc(auditLogs.id)),
  ]);

  const projectsById = new Map(workspaceProjects.map((project) => [project.id, project]));
  const usersById = new Map(workspaceUsers.map((user) => [user.id, user]));

  const actualSeconds = linkedEntries.reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0);
  const workBlocks = workspaceBlocks.filter((block) => block.status !== "canceled" && !isUnavailableScheduledBlock(block) && !/^busy(?:\b|:)/i.test(block.title.trim()) && !block.tags.some((tag) => tag.toLowerCase() === "busy"));
  const plannedSeconds = workBlocks.reduce((sum, block) => {
    return sum + Math.max(0, Math.floor((new Date(block.endsAt).getTime() - new Date(block.startsAt).getTime()) / 1000));
  }, 0);

  const sourceStats = new Map<string, { seconds: number; count: number }>();
  for (const entry of linkedEntries) {
    const current = sourceStats.get(entry.source) ?? { seconds: 0, count: 0 };
    current.seconds += entry.durationSeconds ?? 0;
    current.count += 1;
    sourceStats.set(entry.source, current);
  }

  const proofPack: InvoiceProofPack = {
    invoice: {
      id: invoice.id,
      number: invoice.number,
      projectId: invoice.projectId,
      projectName: invoice.projectId ? projectsById.get(invoice.projectId)?.name ?? "Unknown project" : "General Workspace",
      amount: invoice.amount,
      status: invoice.status,
      dueDate: iso(invoice.dueDate),
      createdAt: iso(invoice.createdAt),
    },
    totals: {
      amount: invoice.amount,
      entryCount: linkedEntries.length,
      actualSeconds,
      actualHours: hours(actualSeconds),
      plannedSeconds,
      plannedHours: hours(plannedSeconds),
      auditEventCount: workspaceAuditLogs.length,
    },
    sourceMix: [...sourceStats.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([source, value]) => ({
      source,
      label: sourceLabel(source),
      seconds: value.seconds,
      hours: hours(value.seconds),
      count: value.count,
    })),
    entries: linkedEntries.map((entry) => {
      const project = entry.projectId ? projectsById.get(entry.projectId) : null;
      const durationSeconds = entry.durationSeconds ?? 0;
      return {
        id: entry.id,
        userId: entry.userId,
        userEmail: usersById.get(entry.userId)?.email ?? "Unknown user",
        projectId: entry.projectId,
        projectName: project?.name ?? "General",
        scheduledBlockId: entry.scheduledBlockId,
        taskId: entry.taskId,
        description: entry.description,
        startedAt: iso(entry.startedAt),
        stoppedAt: iso(entry.stoppedAt),
        durationSeconds,
        hours: hours(durationSeconds),
        hourlyRate: entry.hourlyRate,
        amount: timeEntryAmountCents(durationSeconds, entry.hourlyRate ?? 0) / 100,
        status: entry.status,
        source: entry.source,
        tags: Array.isArray(entry.tags) ? entry.tags : [],
      };
    }),
    plannedBlocks: workBlocks.map((block) => {
      const planned = Math.max(0, Math.floor((new Date(block.endsAt).getTime() - new Date(block.startsAt).getTime()) / 1000));
      return {
        id: block.id,
        title: block.title,
        startsAt: iso(block.startsAt),
        endsAt: iso(block.endsAt),
        plannedSeconds: planned,
        status: block.status,
      };
    }),
    auditEvents: workspaceAuditLogs.map((event) => ({
      id: event.id,
      timeEntryId: event.timeEntryId,
      actorUserId: event.actorUserId,
      eventType: event.eventType,
      diff: event.diff as JsonValue,
      signature: event.signature,
      createdAt: iso(event.createdAt),
    })),
  };

  return {
    proofPack,
    digest: createHash("sha256").update(stableJson(proofPack)).digest("hex"),
  };
}
