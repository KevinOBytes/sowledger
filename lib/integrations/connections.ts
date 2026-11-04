import { and, desc, eq, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { WorkflowError } from "@/lib/workflow-validation";
import { integrationFailureSummary, type IntegrationFailureKind } from "@/lib/integrations/errors";
import {
  integrationConnections,
  integrationSyncRecords,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@/lib/db/schema";

export const INTEGRATION_PROVIDERS: IntegrationProvider[] = ["google_calendar", "slack", "quickbooks"];

export type PublicIntegrationConnection = {
  id: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  displayName: string | null;
  externalAccountId: string | null;
  config: Record<string, unknown>;
  tokenExpiresAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type IntegrationConnection = typeof integrationConnections.$inferSelect;

export function integrationConnectionGeneration(connection: IntegrationConnection) {
  const value = connection.config.connectionGeneration;
  return typeof value === "string" && value.length > 0 ? value : null;
}

// A late token refresh or sync result must never resurrect a disconnected
// connection or replace credentials/status saved by a subsequent OAuth flow.
// Google results also belong to the exact calendar/settings snapshot they used.
export async function updateCurrentIntegrationConnection(
  connection: IntegrationConnection,
  updates: Partial<typeof integrationConnections.$inferInsert>,
) {
  const [updated] = await db.update(integrationConnections).set(updates).where(and(
    eq(integrationConnections.id, connection.id),
    eq(integrationConnections.workspaceId, connection.workspaceId),
    eq(integrationConnections.provider, connection.provider),
    ne(integrationConnections.status, "disabled"),
    ...(connection.provider === "google_calendar" ? [
      eq(sql<string>`coalesce(${integrationConnections.config}->>'connectionGeneration', '')`, integrationConnectionGeneration(connection) ?? ""),
      eq(integrationConnections.config, connection.config),
    ] : []),
    ...(connection.provider === "quickbooks" ? [
      eq(integrationConnections.config, connection.config),
      eq(integrationConnections.credentials, connection.credentials),
    ] : []),
  )).returning();
  return updated ?? null;
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toPublicConnection(connection: IntegrationConnection): PublicIntegrationConnection {
  return {
    id: connection.id,
    provider: connection.provider as IntegrationProvider,
    status: connection.status as IntegrationStatus,
    displayName: connection.displayName,
    externalAccountId: connection.externalAccountId,
    config: connection.config ?? {},
    tokenExpiresAt: iso(connection.tokenExpiresAt),
    lastSyncedAt: iso(connection.lastSyncedAt),
    lastError: connection.lastError ? integrationFailureSummary(connection.provider, "unexpected") : null,
    createdAt: iso(connection.createdAt),
    updatedAt: iso(connection.updatedAt),
  };
}

export async function listIntegrationConnections(workspaceId: string) {
  await ensureWorkspaceSchema();
  return db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.workspaceId, workspaceId))
    .orderBy(desc(integrationConnections.updatedAt));
}

export async function getIntegrationConnection(workspaceId: string, provider: IntegrationProvider) {
  await ensureWorkspaceSchema();
  const [connection] = await db
    .select()
    .from(integrationConnections)
    .where(and(eq(integrationConnections.workspaceId, workspaceId), eq(integrationConnections.provider, provider)));
  return connection ?? null;
}

export async function upsertIntegrationConnection(input: {
  workspaceId: string;
  provider: IntegrationProvider;
  createdByUserId: string;
  replaceCreatedByUser?: boolean;
  status?: IntegrationStatus;
  displayName?: string | null;
  externalAccountId?: string | null;
  credentials?: Record<string, string>;
  config?: Record<string, unknown>;
  tokenExpiresAt?: Date | null;
  lastSyncedAt?: Date | null;
  lastError?: IntegrationFailureKind | null;
}) {
  await ensureWorkspaceSchema();
  const existing = await getIntegrationConnection(input.workspaceId, input.provider);
  const updates = {
    ...(input.replaceCreatedByUser ? { createdByUserId: input.createdByUserId } : {}),
    status: input.status ?? "connected",
    displayName: input.displayName ?? existing?.displayName ?? null,
    externalAccountId: input.externalAccountId ?? existing?.externalAccountId ?? null,
    credentials: input.credentials ?? existing?.credentials ?? {},
    config: input.config ?? existing?.config ?? {},
    tokenExpiresAt: input.tokenExpiresAt ?? existing?.tokenExpiresAt ?? null,
    lastSyncedAt: input.lastSyncedAt === undefined ? existing?.lastSyncedAt ?? null : input.lastSyncedAt,
    lastError: input.lastError == null ? null : integrationFailureSummary(input.provider, input.lastError),
    updatedAt: new Date(),
  } satisfies Partial<typeof integrationConnections.$inferInsert>;

  const [connection] = await db
    .insert(integrationConnections)
    .values({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      provider: input.provider,
      createdByUserId: input.createdByUserId,
      ...updates,
    })
    .onConflictDoUpdate({
      target: [integrationConnections.workspaceId, integrationConnections.provider],
      set: updates,
    })
    .returning();
  return connection;
}

export async function markIntegrationError(connection: IntegrationConnection, kind: IntegrationFailureKind) {
  const updated = await updateCurrentIntegrationConnection(connection, { status: "error", lastError: integrationFailureSummary(connection.provider, kind), updatedAt: new Date() });
  return updated ?? connection;
}

export async function markIntegrationSynced(connection: IntegrationConnection) {
  const updated = await updateCurrentIntegrationConnection(connection, { status: "connected", lastError: null, lastSyncedAt: new Date(), updatedAt: new Date() });
  if (!updated && connection.provider === "google_calendar") {
    throw new WorkflowError("Google Calendar settings changed before this sync could be confirmed. Sync again with the current settings.", 409);
  }
  if (!updated && connection.provider === "quickbooks") {
    throw new WorkflowError("QuickBooks connection or credentials changed. Review the current connection before trying again.", 409);
  }
  return updated ?? connection;
}

export async function disconnectIntegration(workspaceId: string, provider: IntegrationProvider) {
  await ensureWorkspaceSchema();
  const [connection] = await db
    .update(integrationConnections)
    .set({ status: "disabled", credentials: {}, lastError: null, updatedAt: new Date() })
    .where(and(eq(integrationConnections.workspaceId, workspaceId), eq(integrationConnections.provider, provider)))
    .returning();
  return connection ?? null;
}

export async function findSyncRecord(input: {
  workspaceId: string;
  provider: IntegrationProvider;
  resourceType: string;
  resourceId: string;
}) {
  const [record] = await db
    .select()
    .from(integrationSyncRecords)
    .where(and(
      eq(integrationSyncRecords.workspaceId, input.workspaceId),
      eq(integrationSyncRecords.provider, input.provider),
      eq(integrationSyncRecords.resourceType, input.resourceType),
      eq(integrationSyncRecords.resourceId, input.resourceId),
    ));
  return record ?? null;
}

export async function findSyncRecordByExternalId(input: {
  workspaceId: string;
  provider: IntegrationProvider;
  externalId: string;
}) {
  const [record] = await db
    .select()
    .from(integrationSyncRecords)
    .where(and(
      eq(integrationSyncRecords.workspaceId, input.workspaceId),
      eq(integrationSyncRecords.provider, input.provider),
      eq(integrationSyncRecords.externalId, input.externalId),
    ));
  return record ?? null;
}

export async function upsertSyncRecord(input: {
  workspaceId: string;
  connectionId: string;
  provider: IntegrationProvider;
  resourceType: string;
  resourceId: string;
  externalId: string;
  externalUrl?: string | null;
  syncStatus?: "synced" | "error" | "deleted";
  metadata?: Record<string, unknown>;
  lastError?: IntegrationFailureKind | null;
}, client: Pick<typeof db, "select" | "insert"> = db) {
  await ensureWorkspaceSchema();
  const [connection] = await client
    .select({ id: integrationConnections.id })
    .from(integrationConnections)
    .where(and(
      eq(integrationConnections.id, input.connectionId),
      eq(integrationConnections.workspaceId, input.workspaceId),
      eq(integrationConnections.provider, input.provider),
    ));
  if (!connection) throw new Error("Integration connection does not belong to this workspace/provider.");

  const values = {
    connectionId: input.connectionId,
    provider: input.provider,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    externalId: input.externalId,
    externalUrl: input.externalUrl ?? null,
    syncStatus: input.syncStatus ?? "synced",
    metadata: input.metadata ?? {},
    lastError: input.lastError == null ? null : integrationFailureSummary(input.provider, input.lastError),
    lastSyncedAt: new Date(),
  } satisfies Partial<typeof integrationSyncRecords.$inferInsert>;

  const [record] = await client
    .insert(integrationSyncRecords)
    .values({ id: crypto.randomUUID(), workspaceId: input.workspaceId, ...values })
    .onConflictDoUpdate({
      target: [
        integrationSyncRecords.workspaceId,
        integrationSyncRecords.provider,
        integrationSyncRecords.resourceType,
        integrationSyncRecords.resourceId,
      ],
      set: values,
    })
    .returning();
  return record;
}
