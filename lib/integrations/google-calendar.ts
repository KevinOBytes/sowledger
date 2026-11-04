import { createHash } from "node:crypto";
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { integrationConnections, integrationSyncRecords, scheduledWorkBlocks, type IntegrationProvider } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { WorkflowError } from "@/lib/workflow-validation";
import { IntegrationProviderError, integrationFetch, integrationResponseJson, invalidProviderResponse, integrationFailureKind, providerObject, providerString } from "@/lib/integrations/errors";
import { decryptSecret, encryptSecret } from "@/lib/integrations/crypto";
import { isUnavailableScheduledBlock } from "@/lib/scheduled-block-guards";
import {
  findSyncRecord,
  getIntegrationConnection,
  integrationConnectionGeneration,
  markIntegrationError,
  markIntegrationSynced,
  type IntegrationConnection,
  upsertIntegrationConnection,
  upsertSyncRecord,
  updateCurrentIntegrationConnection,
} from "@/lib/integrations/connections";

export const GOOGLE_CALENDAR_PROVIDER: IntegrationProvider = "google_calendar";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
];

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GoogleCalendarEvent = {
  id: string;
  etag?: string;
  status?: string;
  transparency?: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
};

type GoogleEventsResponse = {
  kind?: string;
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  timeZone?: string;
  error?: { message?: string };
};

const MAX_SYNC_PAGES = 40;
const MAX_SYNC_EVENTS = 10_000;
const SYNC_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 10_000;
type RequestBudget = { deadline: number; remaining: number };

class GoogleSyncBusyError extends WorkflowError {
  constructor() { super("Google Calendar is already syncing for this workspace. Wait a moment and try again.", 409); }
}

class GoogleRequestError extends IntegrationProviderError {
  constructor(status: number, readonly reason?: "deleted") { super(GOOGLE_CALENDAR_PROVIDER, status); }
}

function requestSignal(budget?: RequestBudget) {
  const remaining = budget ? budget.deadline - Date.now() : REQUEST_TIMEOUT_MS;
  if (remaining <= 0) throw new IntegrationProviderError(GOOGLE_CALENDAR_PROVIDER, 504, "timeout");
  if (budget && --budget.remaining < 0) throw new WorkflowError("Google Calendar request limit reached. Try a smaller date range.", 409);
  return AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining));
}

export function googleCalendarConfigured() {
  return Boolean(env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET);
}

export function googleCalendarRedirectUri() {
  return env.GOOGLE_CALENDAR_REDIRECT_URI || `${env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/integrations/google-calendar/oauth/callback`;
}

export function buildGoogleCalendarAuthUrl(state: string) {
  if (!env.GOOGLE_CALENDAR_CLIENT_ID) throw new Error("Google Calendar client ID is not configured");
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", env.GOOGLE_CALENDAR_CLIENT_ID);
  url.searchParams.set("redirect_uri", googleCalendarRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url;
}

async function exchangeGoogleToken(body: URLSearchParams, budget?: RequestBudget) {
  const signal = requestSignal(budget);
  const response = await integrationFetch(GOOGLE_CALENDAR_PROVIDER, GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
    signal,
  });
  const data = await integrationResponseJson(GOOGLE_CALENDAR_PROVIDER, response, signal) as GoogleTokenResponse;
  if (data.error || !providerString(data.access_token)
    || (data.refresh_token !== undefined && !providerString(data.refresh_token))
    || (data.expires_in !== undefined && (typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in)))
    || (data.token_type !== undefined && !providerString(data.token_type))) throw invalidProviderResponse(GOOGLE_CALENDAR_PROVIDER);
  return data;
}

export async function exchangeGoogleAuthorizationCode(code: string) {
  if (!env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_CLIENT_SECRET) {
    throw new Error("Google Calendar OAuth is not configured");
  }
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CALENDAR_CLIENT_ID,
    client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
    redirect_uri: googleCalendarRedirectUri(),
    grant_type: "authorization_code",
  });
  return exchangeGoogleToken(body);
}

export async function storeGoogleCalendarConnection(input: {
  workspaceId: string;
  userId: string;
  token: GoogleTokenResponse;
}) {
  // Calendar-only OAuth does not establish that a new access token belongs to
  // the previous account. Never combine it with the old account's refresh token.
  if (!providerString(input.token.access_token) || !providerString(input.token.refresh_token)) throw invalidProviderResponse(GOOGLE_CALENDAR_PROVIDER);
  const refreshToken = input.token.refresh_token;
  const expiresAt = new Date(Date.now() + Math.max(60, input.token.expires_in ?? 3600) * 1000);
  const connection = await upsertIntegrationConnection({
    workspaceId: input.workspaceId,
    provider: GOOGLE_CALENDAR_PROVIDER,
    createdByUserId: input.userId,
    replaceCreatedByUser: true,
    status: "connected",
    displayName: "Google Calendar",
    credentials: {
      accessToken: encryptSecret(input.token.access_token) ?? "",
      refreshToken: encryptSecret(refreshToken) ?? "",
      tokenType: input.token.token_type ?? "Bearer",
    },
    config: {
      connectionGeneration: crypto.randomUUID(),
      calendarId: "primary",
      importBusy: true,
      syncScheduled: true,
    },
    tokenExpiresAt: expiresAt,
    lastSyncedAt: null,
    lastError: null,
  });
  return connection;
}

async function assertCurrentGoogleConnection(connection: IntegrationConnection) {
  const current = await getIntegrationConnection(connection.workspaceId, GOOGLE_CALENDAR_PROVIDER);
  if (!current || current.id !== connection.id || current.status === "disabled" ||
    integrationConnectionGeneration(current) !== integrationConnectionGeneration(connection) || calendarId(current) !== calendarId(connection) ||
    current.config.importBusy !== connection.config.importBusy || current.config.syncScheduled !== connection.config.syncScheduled) {
    throw new WorkflowError("Google Calendar settings changed or the account was disconnected. Reconnect or try again.", 409);
  }
}

export async function ensureGoogleAccessToken(connection: IntegrationConnection, budget?: RequestBudget) {
  await assertCurrentGoogleConnection(connection);
  const expiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt).getTime() : 0;
  const encryptedAccessToken = connection.credentials.accessToken;
  if (encryptedAccessToken && expiresAt > Date.now() + 60_000) {
    const token = decryptSecret(encryptedAccessToken);
    if (token) return token;
  }

  const refreshToken = decryptSecret(connection.credentials.refreshToken);
  if (!refreshToken) throw new WorkflowError("Google Calendar refresh token is missing. Reconnect Google Calendar.", 409);
  if (!env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_CLIENT_SECRET) throw new Error("Google Calendar OAuth is not configured");

  const token = await exchangeGoogleToken(new URLSearchParams({
    client_id: env.GOOGLE_CALENDAR_CLIENT_ID,
    client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }), budget);
  const nextExpiresAt = new Date(Date.now() + Math.max(60, token.expires_in ?? 3600) * 1000);
  const updated = await updateCurrentIntegrationConnection(connection, {
      credentials: {
        ...connection.credentials,
        accessToken: encryptSecret(token.access_token) ?? "",
        refreshToken: encryptSecret(token.refresh_token ?? refreshToken) ?? "",
        tokenType: token.token_type ?? "Bearer",
      },
      tokenExpiresAt: nextExpiresAt,
      status: "connected",
      lastError: null,
      updatedAt: new Date(),
    });
  if (!updated) throw new WorkflowError("Google Calendar settings changed or the account was disconnected during token refresh. Try again.", 409);
  // Reuse the refreshed token during this sync instead of refreshing each page.
  connection.credentials = updated.credentials;
  connection.tokenExpiresAt = updated.tokenExpiresAt;
  return token.access_token;
}

async function googleFetch<T>(connection: IntegrationConnection, path: string, init?: RequestInit, budget?: RequestBudget) {
  const accessToken = await ensureGoogleAccessToken(connection, budget);
  const signal = requestSignal(budget);
  const response = await integrationFetch(GOOGLE_CALENDAR_PROVIDER, `${GOOGLE_CALENDAR_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    // HTTP provenance survives unreadable/untrusted error bodies. Only the
    // existing 410/deleted reconciliation discriminator may be retained.
    let deleted = false;
    if (response.status === 410) {
      try { const data = JSON.parse(await response.text()); deleted = data?.error?.errors?.[0]?.reason === "deleted"; } catch { /* The actual HTTP status remains authoritative. */ }
    }
    throw new GoogleRequestError(response.status, deleted ? "deleted" : undefined);
  }
  if (response.status === 204 && init?.method === "DELETE") return {} as T;
  return await integrationResponseJson(GOOGLE_CALENDAR_PROVIDER, response, signal) as T;
}

function calendarId(connection: IntegrationConnection) {
  const raw = connection.config.calendarId;
  return typeof raw === "string" && raw.trim() ? raw.trim() : "primary";
}

function googleEventForBlock(block: typeof scheduledWorkBlocks.$inferSelect, generation: string) {
  const notes = block.notes ? `\n\n${block.notes}` : "";
  return {
    summary: block.title,
    description: `Scheduled in SOWLedger.${notes}`,
    start: { dateTime: new Date(block.startsAt).toISOString() },
    end: { dateTime: new Date(block.endsAt).toISOString() },
    extendedProperties: {
      private: {
        sowledgerWorkspaceId: block.workspaceId,
        sowledgerBlockId: block.id,
        sowledgerConnectionGeneration: generation,
      },
    },
  };
}

function wallTimeInZone(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  if (!match) throw invalidProviderResponse(GOOGLE_CALENDAR_PROVIDER);
  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  const wall = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  const normalized = new Date(wall);
  if (normalized.getUTCFullYear() !== Number(year) || normalized.getUTCMonth() !== Number(month) - 1 || normalized.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    throw invalidProviderResponse(GOOGLE_CALENDAR_PROVIDER);
  }
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); }
  catch (error) { if (error instanceof RangeError) throw invalidProviderResponse(GOOGLE_CALENDAR_PROVIDER); throw error; }
  let instant = wall;
  for (let attempt = 0; attempt < 6; attempt++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const rendered = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const difference = wall - rendered;
    if (difference === 0) return new Date(instant);
    instant += difference;
  }
  throw invalidProviderResponse(GOOGLE_CALENDAR_PROVIDER);
}

function eventBoundary(value: GoogleCalendarEvent["start"], calendarTimeZone?: string) {
  if (!providerObject(value) || (value.dateTime !== undefined && !providerString(value.dateTime))
    || (value.date !== undefined && !providerString(value.date)) || (value.timeZone !== undefined && !providerString(value.timeZone))) throw invalidProviderResponse(GOOGLE_CALENDAR_PROVIDER);
  if (value?.dateTime) {
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.dateTime)) {
      if (!value.timeZone) throw invalidProviderResponse(GOOGLE_CALENDAR_PROVIDER);
      return wallTimeInZone(value.dateTime, value.timeZone);
    }
    const date = new Date(value.dateTime);
    if (!Number.isFinite(date.getTime())) throw invalidProviderResponse(GOOGLE_CALENDAR_PROVIDER);
    return date;
  }
  if (value?.date) {
    const timeZone = value.timeZone ?? calendarTimeZone;
    if (!timeZone) throw invalidProviderResponse(GOOGLE_CALENDAR_PROVIDER);
    return wallTimeInZone(value.date, timeZone);
  }
  throw invalidProviderResponse(GOOGLE_CALENDAR_PROVIDER);
}

async function readGoogleSnapshot(connection: IntegrationConnection, start: Date, end: Date, budget: RequestBudget) {
  const params = new URLSearchParams({ timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: "true", orderBy: "startTime", showDeleted: "true", maxResults: "250" });
  const events = new Map<string, GoogleCalendarEvent>();
  const pageTokens = new Set<string>();
  let timeZone: string | undefined;
  for (let page = 0; page < MAX_SYNC_PAGES; page++) {
    const data = await googleFetch<GoogleEventsResponse>(connection, `/calendars/${encodeURIComponent(calendarId(connection))}/events?${params}`, undefined, budget);
    if (!data || typeof data !== "object" || Array.isArray(data) || data.kind !== "calendar#events" || (data.items !== undefined && !Array.isArray(data.items)) || (data.nextPageToken !== undefined && typeof data.nextPageToken !== "string")) {
      throw invalidProviderResponse(GOOGLE_CALENDAR_PROVIDER);
    }
    if (data.timeZone !== undefined) {
      if (typeof data.timeZone !== "string" || (timeZone && timeZone !== data.timeZone)) throw invalidProviderResponse(GOOGLE_CALENDAR_PROVIDER);
      timeZone = data.timeZone;
    }
    for (const event of data.items ?? []) {
      if (!event || !providerString(event.id) || events.has(event.id)) throw invalidProviderResponse(GOOGLE_CALENDAR_PROVIDER);
      events.set(event.id, event);
    }
    if (events.size > MAX_SYNC_EVENTS) throw new WorkflowError("Google Calendar event limit exceeded. Use a smaller sync date range.", 409);
    if (!data.nextPageToken) {
      // Validate the entire snapshot before any local writes or stale cleanup.
      return [...events.values()].filter((event) => event.status !== "cancelled" && event.transparency !== "transparent" && !event.extendedProperties?.private?.sowledgerBlockId).map((event) => {
        const startsAt = eventBoundary(event.start, timeZone);
        const endsAt = eventBoundary(event.end, timeZone);
        if (endsAt <= startsAt) throw invalidProviderResponse(GOOGLE_CALENDAR_PROVIDER);
        return { event, startsAt, endsAt };
      });
    }
    if (pageTokens.has(data.nextPageToken)) throw invalidProviderResponse(GOOGLE_CALENDAR_PROVIDER);
    pageTokens.add(data.nextPageToken);
    params.set("pageToken", data.nextPageToken);
  }
  throw new WorkflowError("Google Calendar page limit exceeded. Use a smaller sync date range.", 409);
}

function defaultSyncWindow() {
  const start = new Date();
  start.setDate(start.getDate() - 14);
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setDate(end.getDate() + 60);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export async function testGoogleCalendarConnection(workspaceId: string) {
  const connection = await getIntegrationConnection(workspaceId, GOOGLE_CALENDAR_PROVIDER);
  if (!connection || connection.status === "disabled") throw new WorkflowError("Google Calendar is not connected", 404);
  // calendar.events permits this read; calendarList.get requires another scope.
  const data = await googleFetch<GoogleEventsResponse>(connection, `/calendars/${encodeURIComponent(calendarId(connection))}/events?maxResults=1`);
  if (data.kind !== "calendar#events" || (data.items !== undefined && (!Array.isArray(data.items) || data.items.some((event) => !event || !providerString(event.id))))) throw invalidProviderResponse(GOOGLE_CALENDAR_PROVIDER);
  return true;
}

type SyncInput = { workspaceId: string; userId: string; start?: Date; end?: Date };
type SyncTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type SyncRecord = typeof integrationSyncRecords.$inferSelect;
type ScheduledBlock = typeof scheduledWorkBlocks.$inferSelect;
type OwnedEventState = { state: "ready"; event: GoogleCalendarEvent } | { state: "deleted" } | { state: "unverified" };

function isDeletedEventError(error: unknown) {
  // Other 410 reasons (such as fullSyncRequired) do not prove event absence.
  return error instanceof GoogleRequestError && error.status === 410 && error.reason === "deleted";
}

function googleExportEventId(connection: IntegrationConnection, blockId: string, previousExternalId?: string) {
  const identity = [connection.workspaceId, integrationConnectionGeneration(connection)!, calendarId(connection), blockId];
  if (previousExternalId) identity.push(previousExternalId);
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

function isCurrentOwnedExport(record: SyncRecord, connection: IntegrationConnection) {
  return record.workspaceId === connection.workspaceId && record.connectionId === connection.id
    && record.provider === GOOGLE_CALENDAR_PROVIDER && record.resourceType === "scheduled_work_block"
    && record.metadata.direction === "sowledger_to_google" && record.metadata.calendarId === calendarId(connection)
    && record.metadata.connectionGeneration === integrationConnectionGeneration(connection);
}

async function readOwnedGoogleEvent(connection: IntegrationConnection, block: ScheduledBlock, externalId: string, budget: RequestBudget): Promise<OwnedEventState> {
  let event: GoogleCalendarEvent;
  try {
    event = await googleFetch<GoogleCalendarEvent>(connection, `/calendars/${encodeURIComponent(calendarId(connection))}/events/${encodeURIComponent(externalId)}`, undefined, budget);
  } catch (error) {
    if (isDeletedEventError(error)) return { state: "deleted" };
    // Google also uses 404 for inaccessible calendars. Do not infer deletion.
    if (error instanceof GoogleRequestError && error.status === 404) return { state: "unverified" };
    throw error;
  }
  if (event.id !== externalId) return { state: "unverified" };
  // A deleted event may only retain its ID and cancellation status.
  if (event.status === "cancelled") return { state: "deleted" };
  const ownership = event.extendedProperties?.private;
  if (ownership?.sowledgerWorkspaceId !== block.workspaceId || ownership.sowledgerBlockId !== block.id
    || ownership.sowledgerConnectionGeneration !== integrationConnectionGeneration(connection)
    || typeof event.etag !== "string" || !event.etag.trim()) return { state: "unverified" };
  return { state: "ready", event };
}

async function patchOwnedGoogleEvent(connection: IntegrationConnection, block: ScheduledBlock, externalId: string, budget: RequestBudget): Promise<OwnedEventState> {
  const current = await readOwnedGoogleEvent(connection, block, externalId, budget);
  if (current.state !== "ready") return current;
  try {
    const event = await googleFetch<GoogleCalendarEvent>(connection, `/calendars/${encodeURIComponent(calendarId(connection))}/events/${encodeURIComponent(externalId)}`, {
      method: "PATCH", headers: { "If-Match": current.event.etag! },
      body: JSON.stringify(googleEventForBlock(block, integrationConnectionGeneration(connection)!)),
    }, budget);
    return { state: "ready", event };
  } catch (error) {
    if (isDeletedEventError(error)) return { state: "deleted" };
    if (error instanceof GoogleRequestError && [404, 412].includes(error.status)) return { state: "unverified" };
    throw error;
  }
}

async function markOwnedExportDeleted(record: SyncRecord, client: Pick<typeof db, "update"> = db) {
  const [saved] = await client.update(integrationSyncRecords).set({ syncStatus: "deleted", lastSyncedAt: new Date(), lastError: null }).where(and(
    eq(integrationSyncRecords.id, record.id), eq(integrationSyncRecords.workspaceId, record.workspaceId),
    eq(integrationSyncRecords.connectionId, record.connectionId), eq(integrationSyncRecords.provider, GOOGLE_CALENDAR_PROVIDER),
    eq(integrationSyncRecords.resourceType, "scheduled_work_block"), eq(integrationSyncRecords.resourceId, record.resourceId),
    eq(integrationSyncRecords.externalId, record.externalId),
  )).returning();
  if (!saved) throw new WorkflowError("Google Calendar deletion could not be recorded. Try syncing again.", 409);
  return saved;
}

async function removeCanceledGoogleExport(connection: IntegrationConnection, blockId: string, start: Date, end: Date, budget: RequestBudget) {
  // Commit this receipt independently of the later busy-import transaction.
  // The local block lock keeps a concurrent restore from overtaking deletion.
  return db.transaction(async (receiptTx): Promise<{ outcome: "removed" | "skipped" | "unchanged"; recordId?: string }> => {
    const [block] = await receiptTx.select().from(scheduledWorkBlocks).where(and(
      eq(scheduledWorkBlocks.id, blockId), eq(scheduledWorkBlocks.workspaceId, connection.workspaceId),
      lt(scheduledWorkBlocks.startsAt, end), gt(scheduledWorkBlocks.endsAt, start),
    )).for("update");
    if (!block || !["canceled", "skipped"].includes(block.status)) return { outcome: "unchanged" };
    const recordScope = and(
      eq(integrationSyncRecords.workspaceId, connection.workspaceId), eq(integrationSyncRecords.provider, GOOGLE_CALENDAR_PROVIDER),
      eq(integrationSyncRecords.resourceType, "scheduled_work_block"), eq(integrationSyncRecords.resourceId, block.id),
    );
    let [record] = await receiptTx.select().from(integrationSyncRecords).where(recordScope).for("update");
    let verifiedInitial: OwnedEventState | undefined;
    if (!record) {
      if (block.tags.some(tag => tag.trim().toLowerCase() === "external-calendar")) return { outcome: "unchanged" };
      // A first export can succeed while its response or receipt is lost. Probe
      // only its deterministic current-generation ID, never discover by content.
      const externalId = googleExportEventId(connection, block.id);
      const proof = await readOwnedGoogleEvent(connection, block, externalId, budget);
      // Without a saved receipt, a tombstone/410 proves absence but cannot prove
      // ownership. Do not invent a link from an identifier alone.
      if (proof.state !== "ready") return { outcome: "skipped", recordId: `unlinked:${block.id}` };
      // Persist observed ownership before DELETE. This independent commit keeps
      // the proof available if deletion succeeds but its response is lost.
      await db.insert(integrationSyncRecords).values({
        id: crypto.randomUUID(), workspaceId: connection.workspaceId, connectionId: connection.id,
        provider: GOOGLE_CALENDAR_PROVIDER, resourceType: "scheduled_work_block", resourceId: block.id,
        externalId, externalUrl: proof.event.htmlLink ?? null, syncStatus: "synced", lastSyncedAt: new Date(),
        metadata: { direction: "sowledger_to_google", calendarId: calendarId(connection), connectionGeneration: integrationConnectionGeneration(connection)! },
      }).onConflictDoNothing({ target: [integrationSyncRecords.workspaceId, integrationSyncRecords.provider, integrationSyncRecords.resourceType, integrationSyncRecords.resourceId] }).returning();
      [record] = await receiptTx.select().from(integrationSyncRecords).where(recordScope).for("update");
      if (!record || record.externalId !== externalId || !isCurrentOwnedExport(record, connection)) {
        return { outcome: "skipped", recordId: record?.id ?? `unlinked:${block.id}` };
      }
      verifiedInitial = proof;
    }
    if (record.metadata.direction === "google_busy_to_sowledger") return { outcome: "unchanged" };
    if (!isCurrentOwnedExport(record, connection)) return { outcome: "skipped", recordId: record.id };
    if (record.syncStatus === "deleted") return { outcome: "unchanged" };
    const current = verifiedInitial ?? await readOwnedGoogleEvent(connection, block, record.externalId, budget);
    if (current.state === "unverified") return { outcome: "skipped", recordId: record.id };
    if (current.state === "ready") {
      try {
        await googleFetch(connection, `/calendars/${encodeURIComponent(calendarId(connection))}/events/${encodeURIComponent(record.externalId)}`, {
          method: "DELETE", headers: { "If-Match": current.event.etag! },
        }, budget);
      } catch (error) {
        if (!isDeletedEventError(error)) {
          if (error instanceof GoogleRequestError && [404, 412].includes(error.status)) return { outcome: "skipped", recordId: record.id };
          throw error;
        }
      }
    }
    await markOwnedExportDeleted(record, receiptTx);
    return { outcome: "removed" };
  });
}

async function connectionForSync(workspaceId: string) {
  // This short row lock is released before provider calls. It assigns an
  // explicit identity to an older connection without adopting its old links.
  return db.transaction(async (tx) => {
    const [connection] = await tx.select().from(integrationConnections).where(and(
      eq(integrationConnections.workspaceId, workspaceId), eq(integrationConnections.provider, GOOGLE_CALENDAR_PROVIDER),
    )).for("update");
    if (!connection || connection.status === "disabled") throw new WorkflowError("Google Calendar is not connected", 404);
    if (integrationConnectionGeneration(connection)) return connection;
    const [updated] = await tx.update(integrationConnections).set({
      config: { ...connection.config, connectionGeneration: crypto.randomUUID() }, updatedAt: new Date(),
    }).where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.workspaceId, workspaceId))).returning();
    return updated;
  });
}

export async function syncGoogleCalendar(input: SyncInput) {
  let attemptedConnection: IntegrationConnection | null = null;
  try {
    const completed = await db.transaction(async (tx) => {
      // Serialize snapshot acquisition as well as application. A row lock here
      // would deadlock token refresh, which persists on a separate connection.
      const lock = await tx.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('sowledger:google-calendar-sync'), hashtext(${input.workspaceId})) as acquired`);
      if (!lock.rows[0]?.acquired) throw new GoogleSyncBusyError();
      const connection = await connectionForSync(input.workspaceId);
      attemptedConnection = connection;
      const result = await syncLockedGoogleCalendar(input, connection, tx);
      return { connection, result };
    });
    // No connection-row lock is held here; the generation CAS prevents stale
    // success/error callbacks from reviving a disconnected/reconnected account.
    await markIntegrationSynced(completed.connection);
    return completed.result;
  } catch (error) {
    if (attemptedConnection && !(error instanceof GoogleSyncBusyError)) {
      await markIntegrationError(attemptedConnection, integrationFailureKind(error));
    }
    throw error;
  }
}

async function syncLockedGoogleCalendar(input: SyncInput, connection: IntegrationConnection, tx: SyncTransaction) {
  const { start, end } = input.start && input.end ? { start: input.start, end: input.end } : defaultSyncWindow();
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new WorkflowError("Choose a valid Google Calendar sync date range.", 400);
  if (Boolean(input.start) !== Boolean(input.end)) throw new WorkflowError("Provide both start and end for a Google Calendar sync date range.", 400);
  const calendarKey = calendarId(connection);
  const generation = integrationConnectionGeneration(connection)!;
  const budget: RequestBudget = { deadline: Date.now() + SYNC_TIMEOUT_MS, remaining: 500 };
  const selectedCalendarId = encodeURIComponent(calendarKey);
  const syncScheduled = connection.config.syncScheduled !== false;
  const importBusy = connection.config.importBusy !== false;
  const skippedLinks = new Set<string>();
  let exported = 0;
  let imported = 0;
  let updated = 0;
  let canceled = 0;
  let removed = 0;

    // Fetch every page first. Failed, partial or malformed reads must not remove
    // existing availability, and must not partially import a new snapshot.
    const snapshot = importBusy ? await readGoogleSnapshot(connection, start, end, budget) : [];
    if (syncScheduled) {
      const blocks = await db
        .select()
        .from(scheduledWorkBlocks)
        .where(and(
          eq(scheduledWorkBlocks.workspaceId, input.workspaceId),
          lt(scheduledWorkBlocks.startsAt, end),
          gt(scheduledWorkBlocks.endsAt, start),
        ));

      for (const block of blocks) {
        if (["canceled", "skipped"].includes(block.status)) {
          const deletion = await removeCanceledGoogleExport(connection, block.id, start, end, budget);
          if (deletion.outcome === "removed") removed++;
          else if (deletion.recordId) skippedLinks.add(deletion.recordId);
          continue;
        }
        if (isUnavailableScheduledBlock(block) || !["planned", "in_progress"].includes(block.status)) continue;
        let existing = await findSyncRecord({
          workspaceId: input.workspaceId,
          provider: GOOGLE_CALENDAR_PROVIDER,
          resourceType: "scheduled_work_block",
          resourceId: block.id,
        });
        // Imported events remain provider-owned even if someone edits local tags.
        if (existing?.metadata.direction === "google_busy_to_sowledger") continue;
        if (existing && !isCurrentOwnedExport(existing, connection)) {
          skippedLinks.add(existing.id);
          continue;
        }
        const body = googleEventForBlock(block, generation);
        let event: GoogleCalendarEvent | undefined;
        if (existing?.externalId && existing.syncStatus !== "deleted") {
          const patched = await patchOwnedGoogleEvent(connection, block, existing.externalId, budget);
          if (patched.state === "unverified") { skippedLinks.add(existing.id); continue; }
          if (patched.state === "deleted") existing = await markOwnedExportDeleted(existing);
          else event = patched.event;
        }
        const creating = !event;
        if (!event) {
          // Google accepts client-supplied base32hex IDs. The same logical
          // export gets the same ID even if its response/DB receipt was lost.
          // Restoring a canceled export needs a new ID: Google retains deleted
          // IDs. The durable prior receipt makes that replacement ID stable.
          const eventId = googleExportEventId(connection, block.id, existing?.syncStatus === "deleted" ? existing.externalId : undefined);
          try {
            event = await googleFetch<GoogleCalendarEvent>(connection, `/calendars/${selectedCalendarId}/events`, {
              method: "POST", body: JSON.stringify({ ...body, id: eventId }),
            }, budget);
          } catch (error) {
            if (!(error instanceof GoogleRequestError) || error.status !== 409) throw error;
            const recovered = await patchOwnedGoogleEvent(connection, block, eventId, budget);
            if (recovered.state !== "ready") {
              throw new WorkflowError("Google Calendar event ownership could not be verified. The existing event was left unchanged.", 409);
            }
            event = recovered.event;
          }
        }
        if (!providerString(event.id)) throw invalidProviderResponse(GOOGLE_CALENDAR_PROVIDER);
        // Persist outbound receipts independently: a later import failure must
        // not roll back the identity of an event already saved by Google.
        await upsertSyncRecord({
          workspaceId: input.workspaceId,
          connectionId: connection.id,
          provider: GOOGLE_CALENDAR_PROVIDER,
          resourceType: "scheduled_work_block",
          resourceId: block.id,
          externalId: event.id,
          externalUrl: event.htmlLink ?? null,
          metadata: { direction: "sowledger_to_google", calendarId: calendarKey, connectionGeneration: generation },
        });
        if (creating) exported += 1;
        else updated += 1;
      }
    }

    if (importBusy) {
        const [currentConnection] = await tx.select().from(integrationConnections).where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.workspaceId, input.workspaceId), eq(integrationConnections.provider, GOOGLE_CALENDAR_PROVIDER))).for("update");
        if (!currentConnection || currentConnection.status === "disabled" || currentConnection.config.importBusy === false || calendarId(currentConnection) !== calendarKey || integrationConnectionGeneration(currentConnection) !== generation) throw new WorkflowError("Google Calendar settings changed during synchronization. Try again.", 409);
        const records = await tx.select().from(integrationSyncRecords).where(and(eq(integrationSyncRecords.workspaceId, input.workspaceId), eq(integrationSyncRecords.provider, GOOGLE_CALENDAR_PROVIDER)));
        const recordsByExternalId = new Map(records.map((record) => [record.externalId, record]));
        const resourceIds = records.filter((record) => record.resourceType === "scheduled_work_block").map((record) => record.resourceId);
        const storedBlocks = resourceIds.length > 0 ? await tx.select().from(scheduledWorkBlocks).where(and(eq(scheduledWorkBlocks.workspaceId, input.workspaceId), inArray(scheduledWorkBlocks.id, resourceIds))).for("update") : [];
        const blocksById = new Map(storedBlocks.map((block) => [block.id, block]));
        const belongsToSnapshot = (record: typeof integrationSyncRecords.$inferSelect) => record.connectionId === connection.id
          && record.resourceType === "scheduled_work_block" && record.metadata.direction === "google_busy_to_sowledger" && record.metadata.calendarId === calendarKey && record.metadata.connectionGeneration === generation;
        for (const record of records) {
          if (record.resourceType === "scheduled_work_block" && (record.connectionId !== connection.id || record.metadata.calendarId !== calendarKey || record.metadata.connectionGeneration !== generation)) skippedLinks.add(record.id);
        }
        const activeExternalIds = new Set(snapshot.map(({ event }) => event.id));

        for (const { event, startsAt, endsAt } of snapshot) {
          const existing = recordsByExternalId.get(event.id);
          if (existing && !belongsToSnapshot(existing)) {
            // Legacy links have no calendar identity. Never guess after a
            // calendar switch or change the direction of a provider-owned link.
            skippedLinks.add(existing.id);
            continue;
          }
          const existingBlock = existing ? blocksById.get(existing.resourceId) : undefined;
          if (existing && (!existingBlock || existingBlock.linkedTimeEntryId || !["planned", "canceled"].includes(existingBlock.status))) {
            skippedLinks.add(existing.id);
            continue;
          }
          const values = { title: event.summary ? `Busy: ${event.summary}` : "Busy from Google Calendar", startsAt, endsAt, tags: ["external-calendar", "unavailable"], status: "planned" as const, updatedAt: new Date() };
          let resourceId = existing?.resourceId;
          if (existingBlock) {
            await tx.update(scheduledWorkBlocks).set(values).where(and(eq(scheduledWorkBlocks.id, existingBlock.id), eq(scheduledWorkBlocks.workspaceId, input.workspaceId)));
            updated++;
          } else {
            const [block] = await tx.insert(scheduledWorkBlocks).values({
              id: crypto.randomUUID(), workspaceId: input.workspaceId, userId: currentConnection.createdByUserId,
              notes: "Imported from Google Calendar as unavailable time.", createdByUserId: input.userId, ...values,
            }).returning();
            resourceId = block.id;
            imported++;
          }
          await upsertSyncRecord({
            workspaceId: input.workspaceId, connectionId: connection.id, provider: GOOGLE_CALENDAR_PROVIDER,
            resourceType: "scheduled_work_block", resourceId: resourceId!, externalId: event.id, externalUrl: event.htmlLink ?? null,
            metadata: { direction: "google_busy_to_sowledger", calendarId: calendarKey, connectionGeneration: generation },
          }, tx);
        }

        // Only a complete successful snapshot proves an in-window imported
        // event is gone/moved/free. Keep out-of-window and unproven links intact.
        for (const record of records) {
          if (!belongsToSnapshot(record) || activeExternalIds.has(record.externalId)) continue;
          const block = blocksById.get(record.resourceId);
          if (!block || block.linkedTimeEntryId || !["planned", "canceled"].includes(block.status) || block.endsAt <= start || block.startsAt >= end) continue;
          if (block.status !== "canceled") {
            await tx.update(scheduledWorkBlocks).set({ status: "canceled", updatedAt: new Date() }).where(and(eq(scheduledWorkBlocks.id, block.id), eq(scheduledWorkBlocks.workspaceId, input.workspaceId)));
            canceled++;
          }
          await tx.update(integrationSyncRecords).set({ syncStatus: "deleted", lastSyncedAt: new Date(), lastError: null }).where(and(eq(integrationSyncRecords.id, record.id), eq(integrationSyncRecords.workspaceId, input.workspaceId), eq(integrationSyncRecords.connectionId, connection.id), eq(integrationSyncRecords.provider, GOOGLE_CALENDAR_PROVIDER)));
        }
    }

    return { exported, imported, updated, canceled, removed, skipped: skippedLinks.size,
      warnings: skippedLinks.size > 0 ? ["Some calendar events could not be matched or safely updated and were left unchanged."] : [],
      start: start.toISOString(), end: end.toISOString() };
}
