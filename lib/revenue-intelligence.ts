import { and, eq, gte, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { invoices, projects, scheduledWorkBlocks, timeEntries } from "@/lib/db/schema";

type IntelligenceScope = "mine" | "team";
type Severity = "low" | "medium" | "high";

export type RevenueIntelligenceOptions = {
  scope?: IntelligenceScope;
  userId?: string;
  projectId?: string | null;
  start?: string | null;
  end?: string | null;
};

export type IntelligenceItem = {
  id: string;
  type: string;
  severity: Severity;
  projectId?: string | null;
  projectName?: string;
  title: string;
  reason: string;
  notes: string;
  amount?: number;
  amountAtRisk?: number;
  leakAmount?: number;
  recoverableAmount?: number;
  plannedHours?: number;
  actualHours?: number;
  missingHours?: number;
  hours?: number;
};

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function endExclusive(value?: string | null) {
  const date = parseDate(value);
  if (!date) return null;
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) date.setDate(date.getDate() + 1);
  return date;
}

function hours(seconds: number) {
  return Number((seconds / 3600).toFixed(2));
}

function money(value: number) {
  return Number(value.toFixed(2));
}

function entryAmount(entry: typeof timeEntries.$inferSelect) {
  return ((entry.durationSeconds ?? 0) / 3600) * (entry.hourlyRate ?? 0);
}

function severityFor(percent: number): Severity {
  if (percent >= 100) return "high";
  if (percent >= 80) return "medium";
  return "low";
}

export async function buildRevenueIntelligence(workspaceId: string, options: RevenueIntelligenceOptions = {}) {
  await ensureWorkspaceSchema();

  const start = parseDate(options.start);
  const end = endExclusive(options.end);
  const projectId = options.projectId || null;
  const personalUserId = options.scope === "team" ? null : options.userId ?? null;

  const entryFilters = [eq(timeEntries.workspaceId, workspaceId)];
  const scheduleFilters = [eq(scheduledWorkBlocks.workspaceId, workspaceId)];
  const invoiceFilters = [eq(invoices.workspaceId, workspaceId)];
  if (projectId) {
    entryFilters.push(eq(timeEntries.projectId, projectId));
    scheduleFilters.push(eq(scheduledWorkBlocks.projectId, projectId));
    invoiceFilters.push(eq(invoices.projectId, projectId));
  }
  if (personalUserId) {
    entryFilters.push(eq(timeEntries.userId, personalUserId));
    scheduleFilters.push(eq(scheduledWorkBlocks.userId, personalUserId));
  }
  if (start) {
    entryFilters.push(gte(timeEntries.startedAt, start));
    scheduleFilters.push(gte(scheduledWorkBlocks.startsAt, start));
    invoiceFilters.push(gte(invoices.createdAt, start));
  }
  if (end) {
    entryFilters.push(lt(timeEntries.startedAt, end));
    scheduleFilters.push(lt(scheduledWorkBlocks.startsAt, end));
    invoiceFilters.push(lt(invoices.createdAt, end));
  }

  const [workspaceProjects, workspaceEntries, workspaceInvoices, workspaceSchedule] = await Promise.all([
    db.select().from(projects).where(projectId ? and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)) : eq(projects.workspaceId, workspaceId)),
    db.select().from(timeEntries).where(and(...entryFilters)),
    db.select().from(invoices).where(and(...invoiceFilters)),
    db.select().from(scheduledWorkBlocks).where(and(...scheduleFilters)),
  ]);

  const projectsById = new Map(workspaceProjects.map((project) => [project.id, project]));
  const entriesByProject = new Map<string, typeof workspaceEntries>();
  for (const entry of workspaceEntries) {
    const key = entry.projectId ?? "workspace";
    entriesByProject.set(key, [...(entriesByProject.get(key) ?? []), entry]);
  }

  const scheduledByProject = new Map<string, typeof workspaceSchedule>();
  for (const block of workspaceSchedule) {
    const key = block.projectId ?? "workspace";
    scheduledByProject.set(key, [...(scheduledByProject.get(key) ?? []), block]);
  }

  const retainerRisks: IntelligenceItem[] = [];
  const recoveryOpportunities: IntelligenceItem[] = [];

  for (const project of workspaceProjects) {
    const projectEntries = entriesByProject.get(project.id) ?? [];
    const projectSchedule = scheduledByProject.get(project.id) ?? [];
    const actualSeconds = projectEntries.reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0);
    const plannedSeconds = projectSchedule.reduce((sum, block) => sum + Math.max(0, (new Date(block.endsAt).getTime() - new Date(block.startsAt).getTime()) / 1000), 0);
    const unbilledApproved = projectEntries
      .filter((entry) => entry.status === "approved" && entry.hourlyRate && entry.durationSeconds)
      .reduce((sum, entry) => sum + entryAmount(entry), 0);
    const missingRateCount = projectEntries.filter((entry) => entry.status !== "invoiced" && (entry.durationSeconds ?? 0) > 0 && !entry.hourlyRate).length;
    const missedBlocks = projectSchedule.filter((block) => block.status === "planned" && new Date(block.endsAt).getTime() < Date.now());
    const budgetBasis = project.budgetType === "hours"
      ? hours(actualSeconds)
      : project.budgetType === "fees"
        ? projectEntries.reduce((sum, entry) => sum + entryAmount(entry), 0)
        : 0;
    const budgetPercent = project.budgetAmount && project.budgetType !== "none" ? (budgetBasis / project.budgetAmount) * 100 : 0;

    if (budgetPercent >= Math.max(70, project.budgetAlertThreshold ?? 80)) {
      retainerRisks.push({
        id: `budget-${project.id}`,
        type: "budget_burn",
        severity: severityFor(budgetPercent),
        projectId: project.id,
        projectName: project.name,
        title: `${project.name} is at ${Math.round(budgetPercent)}% of budget`,
        reason: project.budgetType === "hours" ? "Tracked hours are consuming the project budget." : "Billable value is consuming the fee budget.",
        notes: "Review scope before approving more work against this budget.",
        amountAtRisk: project.budgetType === "fees" ? money(Math.max(0, budgetBasis - (project.budgetAmount ?? 0))) : undefined,
        leakAmount: project.budgetType === "fees" ? money(budgetBasis) : undefined,
        plannedHours: hours(plannedSeconds),
        actualHours: hours(actualSeconds),
      });
    }

    if (unbilledApproved > 0) {
      retainerRisks.push({
        id: `unbilled-${project.id}`,
        type: "approved_unbilled",
        severity: unbilledApproved >= 1000 ? "high" : "medium",
        projectId: project.id,
        projectName: project.name,
        title: `${project.name} has approved time not invoiced`,
        reason: "Approved billable work is ready to convert into invoice proof.",
        notes: "Generate an invoice proof pack before the next client update.",
        amountAtRisk: money(unbilledApproved),
        recoverableAmount: money(unbilledApproved),
        actualHours: hours(actualSeconds),
      });
    }

    if (missingRateCount > 0 || missedBlocks.length > 0) {
      retainerRisks.push({
        id: `leak-${project.id}`,
        type: "leak_indicators",
        severity: missedBlocks.length > 2 || missingRateCount > 2 ? "high" : "medium",
        projectId: project.id,
        projectName: project.name,
        title: `${project.name} has billing leakage indicators`,
        reason: `${missingRateCount} entries need rates and ${missedBlocks.length} scheduled blocks have not been reconciled.`,
        notes: "Resolve missing rates and reconcile scheduled work before approving the next invoice.",
        missingHours: hours(missedBlocks.reduce((sum, block) => sum + Math.max(0, (new Date(block.endsAt).getTime() - new Date(block.startsAt).getTime()) / 1000), 0)),
        actualHours: hours(actualSeconds),
      });
    }
  }

  const now = Date.now();
  for (const block of workspaceSchedule) {
    if (block.status !== "planned" || new Date(block.endsAt).getTime() >= now) continue;
    const linked = workspaceEntries.some((entry) => entry.scheduledBlockId === block.id);
    if (linked) continue;
    const plannedSeconds = Math.max(0, Math.floor((new Date(block.endsAt).getTime() - new Date(block.startsAt).getTime()) / 1000));
    recoveryOpportunities.push({
      id: `missed-block-${block.id}`,
      type: "missed_scheduled_work",
      severity: plannedSeconds >= 7200 ? "high" : "medium",
      projectId: block.projectId,
      projectName: block.projectId ? projectsById.get(block.projectId)?.name ?? "Unknown project" : "General Workspace",
      title: `Scheduled work was not logged: ${block.title}`,
      reason: "This planned block ended without a linked completed time entry.",
      notes: "Confirm whether this work happened and log or skip it.",
      missingHours: hours(plannedSeconds),
      plannedHours: hours(plannedSeconds),
    });
  }

  for (const entry of workspaceEntries) {
    const durationSeconds = entry.durationSeconds ?? 0;
    if (entry.status === "approved" && entry.hourlyRate && durationSeconds > 0) {
      const amount = money(entryAmount(entry));
      recoveryOpportunities.push({
        id: `approved-${entry.id}`,
        type: "approved_uninvoiced_entry",
        severity: amount >= 1000 ? "high" : "medium",
        projectId: entry.projectId,
        projectName: entry.projectId ? projectsById.get(entry.projectId)?.name ?? "Unknown project" : "General Workspace",
        title: "Approved billable time is ready to invoice",
        reason: entry.description || "Approved entry has not been included in an invoice yet.",
        notes: "Select this entry in Invoices to generate a proof pack.",
        recoverableAmount: amount,
        hours: hours(durationSeconds),
      });
    }

    if (entry.status !== "invoiced" && durationSeconds > 0 && !entry.hourlyRate) {
      recoveryOpportunities.push({
        id: `missing-rate-${entry.id}`,
        type: "missing_rate",
        severity: "medium",
        projectId: entry.projectId,
        projectName: entry.projectId ? projectsById.get(entry.projectId)?.name ?? "Unknown project" : "General Workspace",
        title: "Logged work is missing a billable rate",
        reason: entry.description || "A completed entry cannot become billable value until it has a rate.",
        notes: "Add or correct the rate before approval and invoicing.",
        hours: hours(durationSeconds),
      });
    }
  }

  const totalLoggedSeconds = workspaceEntries.reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0);
  const approvedUninvoicedValue = workspaceEntries
    .filter((entry) => entry.status === "approved" && entry.hourlyRate && entry.durationSeconds)
    .reduce((sum, entry) => sum + entryAmount(entry), 0);
  const invoicedValue = workspaceInvoices.reduce((sum, invoice) => sum + invoice.amount, 0);

  return {
    ok: true,
    scope: options.scope ?? "mine",
    summary: {
      totalLoggedHours: hours(totalLoggedSeconds),
      approvedUninvoicedValue: money(approvedUninvoicedValue),
      invoicedValue: money(invoicedValue),
      retainerRiskCount: retainerRisks.length,
      recoveryOpportunityCount: recoveryOpportunities.length,
      missingRateCount: workspaceEntries.filter((entry) => entry.status !== "invoiced" && (entry.durationSeconds ?? 0) > 0 && !entry.hourlyRate).length,
      missedScheduledBlockCount: recoveryOpportunities.filter((item) => item.type === "missed_scheduled_work").length,
    },
    retainerRisks: retainerRisks.slice(0, 12),
    recoveryOpportunities: recoveryOpportunities.slice(0, 16),
  };
}
