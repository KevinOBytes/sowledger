import { and, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { clients, invoices, organizations, projects, timeEntries, workspacePeople } from "@/lib/db/schema";

type ClientSession = {
  sub: string;
  email: string;
  workspaceId: string;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function getClientEntitlementIds(session: ClientSession) {
  const email = normalizeEmail(session.email);
  const entitled = new Set<string>();

  const personRows = await db
    .select({ clientId: organizations.clientId })
    .from(workspacePeople)
    .innerJoin(organizations, eq(workspacePeople.organizationId, organizations.id))
    .where(and(
      eq(workspacePeople.workspaceId, session.workspaceId),
      eq(organizations.workspaceId, session.workspaceId),
      eq(workspacePeople.status, "active"),
      eq(workspacePeople.personType, "client"),
      or(eq(workspacePeople.linkedUserId, session.sub), sql`lower(${workspacePeople.email}) = ${email}`),
    ));

  for (const row of personRows) {
    if (row.clientId) entitled.add(row.clientId);
  }

  const directClientRows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.workspaceId, session.workspaceId), sql`lower(${clients.email}) = ${email}`, eq(clients.status, "active")));

  for (const row of directClientRows) {
    entitled.add(row.id);
  }

  return [...entitled];
}

export async function getClientEntitledInvoiceIds(workspaceId: string, clientIds: string[]) {
  if (clientIds.length === 0) return new Set<string>();

  const workspaceInvoices = await db
    .select({ id: invoices.id, projectId: invoices.projectId, timeEntryIds: invoices.timeEntryIds })
    .from(invoices)
    .where(eq(invoices.workspaceId, workspaceId));
  const allInvoiceProjectIds = workspaceInvoices.map((invoice) => invoice.projectId).filter((id): id is string => Boolean(id));
  const allEntryIds = [...new Set(workspaceInvoices.flatMap((invoice) => invoice.timeEntryIds ?? []))];

  const entryRows = allEntryIds.length > 0
    ? await db
      .select({ id: timeEntries.id, projectId: timeEntries.projectId })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.workspaceId, workspaceId),
        inArray(timeEntries.id, allEntryIds),
      ))
    : [];
  const entryById = new Map(entryRows.map((entry) => [entry.id, entry]));

  const allProjectIds = [
    ...new Set([
      ...allInvoiceProjectIds,
      ...entryRows.map((entry) => entry.projectId).filter((id): id is string => Boolean(id)),
    ]),
  ];
  const projectRows = allProjectIds.length > 0
    ? await db
      .select({ id: projects.id, clientId: projects.clientId })
      .from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), inArray(projects.id, allProjectIds)))
    : [];
  const clientByProjectId = new Map(projectRows.map((project) => [project.id, project.clientId]));
  const entitlementSet = new Set(clientIds);

  const invoiceIds = new Set<string>();
  for (const invoice of workspaceInvoices) {
    const linkedEntryIds = invoice.timeEntryIds ?? [];
    const linkedClientIds: string[] = [];

    for (const entryId of linkedEntryIds) {
      const entry = entryById.get(entryId);
      if (!entry?.projectId) {
        linkedClientIds.length = 0;
        linkedClientIds.push("__not_entitled__");
        break;
      }
      const entryClientId = clientByProjectId.get(entry.projectId);
      if (!entryClientId || !entitlementSet.has(entryClientId)) {
        linkedClientIds.length = 0;
        linkedClientIds.push("__not_entitled__");
        break;
      }
      linkedClientIds.push(entryClientId);
    }

    const invoiceProjectClientId = invoice.projectId ? clientByProjectId.get(invoice.projectId) : null;
    if (invoice.projectId && (!invoiceProjectClientId || !entitlementSet.has(invoiceProjectClientId))) {
      continue;
    }

    const provenClientIds = new Set<string>();
    if (invoiceProjectClientId) provenClientIds.add(invoiceProjectClientId);
    for (const clientId of linkedClientIds) provenClientIds.add(clientId);

    if (provenClientIds.size === 1 && !provenClientIds.has("__not_entitled__")) {
      invoiceIds.add(invoice.id);
    }
  }

  return invoiceIds;
}

export async function isInvoiceClientEntitled(workspaceId: string, invoiceId: string, clientIds: string[]) {
  if (clientIds.length === 0) return false;
  const invoiceIds = await getClientEntitledInvoiceIds(workspaceId, clientIds);
  return invoiceIds.has(invoiceId);
}
