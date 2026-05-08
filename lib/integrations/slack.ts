import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { integrationConnections, type IntegrationProvider } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { validateWebhookUrl } from "@/lib/security";
import { decryptSecret, encryptSecret } from "@/lib/integrations/crypto";
import {
  getIntegrationConnection,
  markIntegrationError,
  markIntegrationSynced,
  type IntegrationConnection,
  upsertIntegrationConnection,
} from "@/lib/integrations/connections";

export const SLACK_PROVIDER: IntegrationProvider = "slack";

const SLACK_AUTH_URL = "https://slack.com/oauth/v2/authorize";
const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";

export function slackConfigured() {
  return Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET);
}

export function slackRedirectUri() {
  return env.SLACK_REDIRECT_URI || `${env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/integrations/slack/oauth/callback`;
}

export function buildSlackAuthUrl(state: string) {
  if (!env.SLACK_CLIENT_ID) throw new Error("Slack client ID is not configured");
  const url = new URL(SLACK_AUTH_URL);
  url.searchParams.set("client_id", env.SLACK_CLIENT_ID);
  url.searchParams.set("scope", "incoming-webhook");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", slackRedirectUri());
  return url;
}

type SlackOAuthResponse = {
  ok: boolean;
  error?: string;
  team?: { id?: string; name?: string };
  incoming_webhook?: {
    channel?: string;
    channel_id?: string;
    configuration_url?: string;
    url?: string;
  };
};

export async function exchangeSlackAuthorizationCode(code: string) {
  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) throw new Error("Slack OAuth is not configured");
  const response = await fetch(SLACK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      redirect_uri: slackRedirectUri(),
    }),
    cache: "no-store",
  });
  const data = await response.json() as SlackOAuthResponse;
  if (!response.ok || !data.ok) throw new Error(data.error || "Slack authorization failed");
  if (!data.incoming_webhook?.url) throw new Error("Slack did not return an incoming webhook URL");
  return data;
}

export async function storeSlackOAuthConnection(input: { workspaceId: string; userId: string; oauth: SlackOAuthResponse }) {
  return upsertIntegrationConnection({
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER,
    createdByUserId: input.userId,
    status: "connected",
    displayName: input.oauth.team?.name ? `Slack: ${input.oauth.team.name}` : "Slack alerts",
    externalAccountId: input.oauth.team?.id ?? null,
    credentials: { webhookUrl: encryptSecret(input.oauth.incoming_webhook?.url) ?? "" },
    config: {
      teamName: input.oauth.team?.name ?? null,
      channel: input.oauth.incoming_webhook?.channel ?? null,
      channelId: input.oauth.incoming_webhook?.channel_id ?? null,
      configurationUrl: input.oauth.incoming_webhook?.configuration_url ?? null,
      events: ["scheduled_block.reminder", "scheduled_block.missed", "time_entry.created", "invoice.created"],
    },
    lastError: null,
  });
}

export async function storeSlackWebhookConnection(input: { workspaceId: string; userId: string; webhookUrl: string; channelLabel?: string | null }) {
  const url = await validateWebhookUrl(input.webhookUrl);
  if (!url.startsWith("https://hooks.slack.com/")) throw new Error("Slack webhook URL must start with https://hooks.slack.com/");
  return upsertIntegrationConnection({
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER,
    createdByUserId: input.userId,
    status: "connected",
    displayName: input.channelLabel ? `Slack: ${input.channelLabel}` : "Slack alerts",
    credentials: { webhookUrl: encryptSecret(url) ?? "" },
    config: {
      channel: input.channelLabel ?? null,
      events: ["scheduled_block.reminder", "scheduled_block.missed", "time_entry.created", "invoice.created"],
      manualWebhook: true,
    },
    lastError: null,
  });
}

function slackWebhookUrl(connection: IntegrationConnection) {
  const url = decryptSecret(connection.credentials.webhookUrl);
  if (!url) throw new Error("Slack webhook URL is missing. Reconnect Slack.");
  return url;
}

function subscribed(connection: IntegrationConnection, eventType: string) {
  const events = Array.isArray(connection.config.events) ? connection.config.events : [];
  return events.length === 0 || events.includes("*") || events.includes(eventType);
}

export async function sendSlackMessage(connection: IntegrationConnection, text: string, blocks?: unknown[]) {
  const response = await fetch(slackWebhookUrl(connection), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, blocks }),
    cache: "no-store",
  });
  const body = await response.text();
  if (!response.ok || body.trim() !== "ok") throw new Error(body || `Slack returned ${response.status}`);
  await markIntegrationSynced(connection);
  return true;
}

export async function testSlackConnection(workspaceId: string) {
  const connection = await getIntegrationConnection(workspaceId, SLACK_PROVIDER);
  if (!connection || connection.status === "disabled") throw new Error("Slack is not connected");
  await sendSlackMessage(connection, "Billabled Slack alerts are connected.");
}

export async function notifySlack(workspaceId: string, eventType: string, payload: { title: string; body?: string; url?: string }) {
  const connection = await getIntegrationConnection(workspaceId, SLACK_PROVIDER);
  if (!connection || connection.status !== "connected" || !subscribed(connection, eventType)) return;
  try {
    await sendSlackMessage(connection, payload.body ? `${payload.title}\n${payload.body}` : payload.title, [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${payload.title}*${payload.body ? `\n${payload.body}` : ""}` },
      },
      ...(payload.url ? [{ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open in Billabled" }, url: payload.url }] }] : []),
    ]);
  } catch (error) {
    await markIntegrationError(connection, error instanceof Error ? error.message : "Slack notification failed");
  }
}

export async function updateSlackConfig(workspaceId: string, events: string[]) {
  const connection = await getIntegrationConnection(workspaceId, SLACK_PROVIDER);
  if (!connection) throw new Error("Slack is not connected");
  const [updated] = await db
    .update(integrationConnections)
    .set({ config: { ...connection.config, events }, updatedAt: new Date(), lastError: null })
    .where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.workspaceId, workspaceId)))
    .returning();
  return updated;
}
