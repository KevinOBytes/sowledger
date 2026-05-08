import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
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
    lastError: connection.lastError,
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
  status?: IntegrationStatus;
  displayName?: string | null;
  externalAccountId?: string | null;
  credentials?: Record<string, string>;
  config?: Record<string, unknown>;
  tokenExpiresAt?: Date | null;
  lastSyncedAt?: Date | null;
  lastError?: string | null;
}) {
  await ensureWorkspaceSchema();
  const existing = await getIntegrationConnection(input.workspaceId, input.provider);
  const updates = {
    status: input.status ?? "connected",
    displayName: input.displayName ?? existing?.displayName ?? null,
    externalAccountId: input.externalAccountId ?? existing?.externalAccountId ?? null,
    credentials: input.credentials ?? existing?.credentials ?? {},
    config: input.config ?? existing?.config ?? {},
    tokenExpiresAt: input.tokenExpiresAt ?? existing?.tokenExpiresAt ?? null,
    lastSyncedAt: input.lastSyncedAt ?? existing?.lastSyncedAt ?? null,
    lastError: input.lastError ?? null,
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

export async function markIntegrationError(connection: IntegrationConnection, message: string) {
  const [updated] = await db
    .update(integrationConnections)
    .set({ status: "error", lastError: message.slice(0, 1000), updatedAt: new Date() })
    .where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.workspaceId, connection.workspaceId)))
    .returning();
  return updated ?? connection;
}

export async function markIntegrationSynced(connection: IntegrationConnection) {
  const [updated] = await db
    .update(integrationConnections)
    .set({ status: "connected", lastError: null, lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.workspaceId, connection.workspaceId)))
    .returning();
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
  lastError?: string | null;
}) {
  await ensureWorkspaceSchema();
  const [connection] = await db
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
    lastError: input.lastError ?? null,
    lastSyncedAt: new Date(),
  } satisfies Partial<typeof integrationSyncRecords.$inferInsert>;

  const [record] = await db
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
