import { and, eq, gte, lte, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import { integrationConnections, scheduledWorkBlocks, type IntegrationProvider } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/integrations/crypto";
import {
  findSyncRecordByExternalId,
  findSyncRecord,
  getIntegrationConnection,
  markIntegrationError,
  markIntegrationSynced,
  type IntegrationConnection,
  upsertIntegrationConnection,
  upsertSyncRecord,
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
  summary?: string;
  description?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
};

type GoogleEventsResponse = {
  items?: GoogleCalendarEvent[];
  error?: { message?: string };
};

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

async function exchangeGoogleToken(body: URLSearchParams) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const data = await response.json() as GoogleTokenResponse;
  if (!response.ok || data.error || !data.access_token) {
    throw new Error(data.error_description || data.error || "Google token exchange failed");
  }
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
  existingRefreshToken?: string | null;
}) {
  const refreshToken = input.token.refresh_token ?? input.existingRefreshToken ?? null;
  const expiresAt = new Date(Date.now() + Math.max(60, input.token.expires_in ?? 3600) * 1000);
  const connection = await upsertIntegrationConnection({
    workspaceId: input.workspaceId,
    provider: GOOGLE_CALENDAR_PROVIDER,
    createdByUserId: input.userId,
    status: "connected",
    displayName: "Google Calendar",
    credentials: {
      accessToken: encryptSecret(input.token.access_token) ?? "",
      refreshToken: encryptSecret(refreshToken) ?? "",
      tokenType: input.token.token_type ?? "Bearer",
    },
    config: {
      calendarId: "primary",
      importBusy: true,
      syncScheduled: true,
    },
    tokenExpiresAt: expiresAt,
    lastError: null,
  });
  return connection;
}

export async function ensureGoogleAccessToken(connection: IntegrationConnection) {
  const expiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt).getTime() : 0;
  const encryptedAccessToken = connection.credentials.accessToken;
  if (encryptedAccessToken && expiresAt > Date.now() + 60_000) {
    const token = decryptSecret(encryptedAccessToken);
    if (token) return token;
  }

  const refreshToken = decryptSecret(connection.credentials.refreshToken);
  if (!refreshToken) throw new Error("Google Calendar refresh token is missing. Reconnect Google Calendar.");
  if (!env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_CLIENT_SECRET) throw new Error("Google Calendar OAuth is not configured");

  const token = await exchangeGoogleToken(new URLSearchParams({
    client_id: env.GOOGLE_CALENDAR_CLIENT_ID,
    client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }));
  const nextExpiresAt = new Date(Date.now() + Math.max(60, token.expires_in ?? 3600) * 1000);
  await db
    .update(integrationConnections)
    .set({
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
    })
    .where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.workspaceId, connection.workspaceId)));
  return token.access_token;
}

async function googleFetch<T>(connection: IntegrationConnection, path: string, init?: RequestInit) {
  const accessToken = await ensureGoogleAccessToken(connection);
  const response = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await response.text();
  const data = (text ? JSON.parse(text) : {}) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message || `Google Calendar request failed with ${response.status}`);
  return data;
}

function calendarId(connection: IntegrationConnection) {
  const raw = connection.config.calendarId;
  return typeof raw === "string" && raw.trim() ? raw.trim() : "primary";
}

function googleEventForBlock(block: typeof scheduledWorkBlocks.$inferSelect) {
  const notes = block.notes ? `\n\n${block.notes}` : "";
  return {
    summary: block.title,
    description: `Scheduled in Billabled.${notes}`,
    start: { dateTime: new Date(block.startsAt).toISOString() },
    end: { dateTime: new Date(block.endsAt).toISOString() },
    extendedProperties: {
      private: {
        billabledWorkspaceId: block.workspaceId,
        billabledBlockId: block.id,
      },
    },
  };
}

function eventStart(event: GoogleCalendarEvent) {
  if (event.start?.dateTime) return new Date(event.start.dateTime);
  if (event.start?.date) return new Date(`${event.start.date}T00:00:00`);
  return null;
}

function eventEnd(event: GoogleCalendarEvent) {
  if (event.end?.dateTime) return new Date(event.end.dateTime);
  if (event.end?.date) return new Date(`${event.end.date}T00:00:00`);
  return null;
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
  if (!connection || connection.status === "disabled") throw new Error("Google Calendar is not connected");
  await googleFetch(connection, `/users/me/calendarList/${encodeURIComponent(calendarId(connection))}`);
  return true;
}

export async function syncGoogleCalendar(input: { workspaceId: string; userId: string; start?: Date; end?: Date }) {
  const connection = await getIntegrationConnection(input.workspaceId, GOOGLE_CALENDAR_PROVIDER);
  if (!connection || connection.status === "disabled") throw new Error("Google Calendar is not connected");
  const { start, end } = input.start && input.end ? { start: input.start, end: input.end } : defaultSyncWindow();
  const selectedCalendarId = encodeURIComponent(calendarId(connection));
  const syncScheduled = connection.config.syncScheduled !== false;
  const importBusy = connection.config.importBusy !== false;
  let exported = 0;
  let imported = 0;
  let updated = 0;

  try {
    if (syncScheduled) {
      const blocks = await db
        .select()
        .from(scheduledWorkBlocks)
        .where(and(
          eq(scheduledWorkBlocks.workspaceId, input.workspaceId),
          gte(scheduledWorkBlocks.startsAt, start),
          lte(scheduledWorkBlocks.startsAt, end),
          ne(scheduledWorkBlocks.status, "canceled"),
        ));

      for (const block of blocks) {
        const body = googleEventForBlock(block);
        const existing = await findSyncRecord({
          workspaceId: input.workspaceId,
          provider: GOOGLE_CALENDAR_PROVIDER,
          resourceType: "scheduled_work_block",
          resourceId: block.id,
        });
        const event = existing?.externalId
          ? await googleFetch<GoogleCalendarEvent>(connection, `/calendars/${selectedCalendarId}/events/${encodeURIComponent(existing.externalId)}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          })
          : await googleFetch<GoogleCalendarEvent>(connection, `/calendars/${selectedCalendarId}/events`, {
            method: "POST",
            body: JSON.stringify(body),
          });
        await upsertSyncRecord({
          workspaceId: input.workspaceId,
          connectionId: connection.id,
          provider: GOOGLE_CALENDAR_PROVIDER,
          resourceType: "scheduled_work_block",
          resourceId: block.id,
          externalId: event.id,
          externalUrl: event.htmlLink ?? null,
          metadata: { direction: "billabled_to_google" },
        });
        if (existing) updated += 1;
        else exported += 1;
      }
    }

    if (importBusy) {
      const params = new URLSearchParams({
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        showDeleted: "false",
        maxResults: "100",
      });
      const data = await googleFetch<GoogleEventsResponse>(connection, `/calendars/${selectedCalendarId}/events?${params.toString()}`);
      for (const event of data.items ?? []) {
        if (!event.id || event.extendedProperties?.private?.billabledBlockId) continue;
        const startsAt = eventStart(event);
        const endsAt = eventEnd(event);
        if (!startsAt || !endsAt || endsAt <= startsAt) continue;
        const existing = await findSyncRecordByExternalId({ workspaceId: input.workspaceId, provider: GOOGLE_CALENDAR_PROVIDER, externalId: event.id });
        if (existing) {
          await db
            .update(scheduledWorkBlocks)
            .set({
              title: event.summary ? `Busy: ${event.summary}` : "Busy from Google Calendar",
              startsAt,
              endsAt,
              tags: ["external-calendar", "unavailable"],
              updatedAt: new Date(),
            })
            .where(and(eq(scheduledWorkBlocks.id, existing.resourceId), eq(scheduledWorkBlocks.workspaceId, input.workspaceId)));
          updated += 1;
          continue;
        }

        const [block] = await db
          .insert(scheduledWorkBlocks)
          .values({
            id: crypto.randomUUID(),
            workspaceId: input.workspaceId,
            userId: connection.createdByUserId,
            title: event.summary ? `Busy: ${event.summary}` : "Busy from Google Calendar",
            notes: "Imported from Google Calendar as unavailable time.",
            tags: ["external-calendar", "unavailable"],
            startsAt,
            endsAt,
            status: "planned",
            createdByUserId: input.userId,
          })
          .returning();
        await upsertSyncRecord({
          workspaceId: input.workspaceId,
          connectionId: connection.id,
          provider: GOOGLE_CALENDAR_PROVIDER,
          resourceType: "scheduled_work_block",
          resourceId: block.id,
          externalId: event.id,
          externalUrl: event.htmlLink ?? null,
          metadata: { direction: "google_busy_to_billabled" },
        });
        imported += 1;
      }
    }

    await markIntegrationSynced(connection);
    return { exported, imported, updated, start: start.toISOString(), end: end.toISOString() };
  } catch (error) {
    await markIntegrationError(connection, error instanceof Error ? error.message : "Google Calendar sync failed");
    throw error;
  }
}
