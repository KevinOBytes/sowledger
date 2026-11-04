import { createHash } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrationConnections, integrationSyncRecords } from "@/lib/db/schema";
import type { IntegrationConnection } from "@/lib/integrations/connections";
import { WorkflowError } from "@/lib/workflow-validation";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Client = Pick<typeof db, "select" | "insert" | "update" | "delete">;
type Receipt = typeof integrationSyncRecords.$inferSelect;
export const quickBooksChanged = "QuickBooks connection or credentials changed. Review the current connection before trying again.";
export const quickBooksReview = "This invoice has a pending, uncertain, or differently bound QuickBooks export. Reconcile it with the correct company before trying again; no new invoice was sent.";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function quickBooksIdentity(connection: IntegrationConnection) {
  const realmId = typeof connection.config.realmId === "string" ? connection.config.realmId : connection.externalAccountId;
  const environment = connection.config.environment;
  if (!realmId || (environment !== "sandbox" && environment !== "production")) throw new WorkflowError("QuickBooks company/environment is not verified. Reconnect QuickBooks.", 409);
  return { realmId, environment, connectionGeneration: typeof connection.config.connectionGeneration === "string" ? connection.config.connectionGeneration : null };
}

export function quickBooksOwnership(connection: IntegrationConnection) {
  return and(eq(integrationConnections.id, connection.id), eq(integrationConnections.workspaceId, connection.workspaceId),
    eq(integrationConnections.provider, "quickbooks"), ne(integrationConnections.status, "disabled"),
    eq(integrationConnections.config, connection.config), eq(integrationConnections.credentials, connection.credentials));
}

export async function assertQuickBooksCurrent(connection: IntegrationConnection, client: Pick<Client, "select"> = db) {
  const [current] = await client.select().from(integrationConnections).where(quickBooksOwnership(connection));
  if (!current) throw new WorkflowError(quickBooksChanged, 409);
  return current;
}

async function lockConnection(tx: Transaction, connection: IntegrationConnection) {
  const [current] = await tx.select().from(integrationConnections).where(quickBooksOwnership(connection)).for("update");
  if (!current) throw new WorkflowError(quickBooksChanged, 409);
}

const receiptKey = (workspaceId: string, resourceType: string, resourceId: string) => and(
  eq(integrationSyncRecords.workspaceId, workspaceId), eq(integrationSyncRecords.provider, "quickbooks"),
  eq(integrationSyncRecords.resourceType, resourceType), eq(integrationSyncRecords.resourceId, resourceId),
);

function reservation(connection: IntegrationConnection, resourceType: string, resourceId: string, metadata: Record<string, unknown>) {
  const id = crypto.randomUUID();
  return { id, workspaceId: connection.workspaceId, connectionId: connection.id, provider: "quickbooks" as const,
    resourceType, resourceId, externalId: `qb:claim:${id}`, syncStatus: "error" as const,
    metadata: { ...quickBooksIdentity(connection), ...metadata, state: "pending" }, lastSyncedAt: new Date(), lastError: null };
}

export async function claimQuickBooksRefresh(connection: IntegrationConnection) {
  const resourceId = digest([connection.id, quickBooksIdentity(connection), connection.credentials]);
  return db.transaction(async tx => {
    await lockConnection(tx, connection);
    const [claim] = await tx.insert(integrationSyncRecords).values(reservation(connection, "quickbooks_refresh", resourceId, {}))
      .onConflictDoNothing({ target: [integrationSyncRecords.workspaceId, integrationSyncRecords.provider, integrationSyncRecords.resourceType, integrationSyncRecords.resourceId] }).returning();
    if (!claim) throw new WorkflowError("QuickBooks token refresh is already reserved or its result is uncertain. Reconnect QuickBooks to recover safely; no invoice was sent.", 409);
    return claim;
  });
}

export function confirmedQuickBooksReceipt(record: Receipt, connection: IntegrationConnection) {
  const identity = quickBooksIdentity(connection);
  if (record.syncStatus !== "synced" || record.metadata.state !== "confirmed"
    || record.metadata.realmId !== identity.realmId || record.metadata.environment !== identity.environment
    || typeof record.metadata.rawExternalId !== "string" || !record.metadata.rawExternalId.trim()) {
    throw new WorkflowError(quickBooksReview, 409);
  }
  return record.metadata.rawExternalId;
}

export async function claimQuickBooksInvoice(connection: IntegrationConnection, invoiceId: string, payload: unknown) {
  return db.transaction(async tx => {
    await lockConnection(tx, connection);
    const key = receiptKey(connection.workspaceId, "invoice", invoiceId);
    const [existing] = await tx.select().from(integrationSyncRecords).where(key);
    if (existing) return { reused: true as const, externalId: confirmedQuickBooksReceipt(existing, connection), record: existing };
    const values = reservation(connection, "invoice", invoiceId, { requestId: crypto.randomUUID(), payloadDigest: digest(payload) });
    const [record] = await tx.insert(integrationSyncRecords).values(values)
      .onConflictDoNothing({ target: [integrationSyncRecords.workspaceId, integrationSyncRecords.provider, integrationSyncRecords.resourceType, integrationSyncRecords.resourceId] }).returning();
    if (!record) throw new WorkflowError(quickBooksReview, 409);
    return { reused: false as const, record };
  });
}

const ownedClaim = (record: Receipt) => and(receiptKey(record.workspaceId, record.resourceType, record.resourceId),
  eq(integrationSyncRecords.id, record.id), eq(integrationSyncRecords.connectionId, record.connectionId),
  eq(integrationSyncRecords.metadata, record.metadata), eq(integrationSyncRecords.syncStatus, "error"));

export async function confirmQuickBooksInvoice(record: Receipt, rawExternalId: string, docNumber: string) {
  const [saved] = await db.update(integrationSyncRecords).set({
    externalId: `qb:invoice:${digest([record.metadata.environment, record.metadata.realmId, rawExternalId])}`,
    syncStatus: "synced", metadata: { ...record.metadata, state: "confirmed", rawExternalId, docNumber, pushedAt: new Date().toISOString() },
    lastSyncedAt: new Date(), lastError: null,
  }).where(ownedClaim(record)).returning();
  if (!saved) throw new WorkflowError(quickBooksReview, 409);
}

/** Only an owned reservation proven never to have reached invoice dispatch. */
export async function abandonUnsentQuickBooksInvoice(record: Receipt) {
  await db.delete(integrationSyncRecords).where(ownedClaim(record));
}
