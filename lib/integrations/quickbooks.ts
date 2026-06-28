import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { integrationConnections, invoices, type IntegrationProvider } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { buildInvoiceProofPack } from "@/lib/invoice-proof-pack";
import { decryptSecret, encryptSecret } from "@/lib/integrations/crypto";
import {
  findSyncRecord,
  getIntegrationConnection,
  markIntegrationError,
  markIntegrationSynced,
  type IntegrationConnection,
  upsertIntegrationConnection,
  upsertSyncRecord,
} from "@/lib/integrations/connections";

export const QUICKBOOKS_PROVIDER: IntegrationProvider = "quickbooks";

const QUICKBOOKS_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QUICKBOOKS_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export function quickBooksConfigured() {
  return Boolean(env.QUICKBOOKS_CLIENT_ID && env.QUICKBOOKS_CLIENT_SECRET);
}

export function quickBooksRedirectUri() {
  return env.QUICKBOOKS_REDIRECT_URI || `${env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/integrations/quickbooks/oauth/callback`;
}

export function quickBooksApiBase() {
  return env.QUICKBOOKS_ENVIRONMENT === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

export function buildQuickBooksAuthUrl(state: string) {
  if (!env.QUICKBOOKS_CLIENT_ID) throw new Error("QuickBooks client ID is not configured");
  const url = new URL(QUICKBOOKS_AUTH_URL);
  url.searchParams.set("client_id", env.QUICKBOOKS_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "com.intuit.quickbooks.accounting");
  url.searchParams.set("redirect_uri", quickBooksRedirectUri());
  url.searchParams.set("state", state);
  return url;
}

type QuickBooksTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  x_refresh_token_expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type QuickBooksInvoiceResponse = {
  Invoice?: {
    Id?: string;
    DocNumber?: string;
    MetaData?: { LastUpdatedTime?: string };
  };
  Fault?: { Error?: Array<{ Message?: string; Detail?: string }> };
};

async function tokenRequest(body: URLSearchParams) {
  if (!env.QUICKBOOKS_CLIENT_ID || !env.QUICKBOOKS_CLIENT_SECRET) throw new Error("QuickBooks OAuth is not configured");
  const response = await fetch(QUICKBOOKS_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${env.QUICKBOOKS_CLIENT_ID}:${env.QUICKBOOKS_CLIENT_SECRET}`).toString("base64")}`,
      Accept: "application/json",
    },
    body,
    cache: "no-store",
  });
  const data = await response.json() as QuickBooksTokenResponse;
  if (!response.ok || data.error || !data.access_token) {
    throw new Error(data.error_description || data.error || "QuickBooks token request failed");
  }
  return data;
}

export async function exchangeQuickBooksAuthorizationCode(code: string) {
  return tokenRequest(new URLSearchParams({
    code,
    redirect_uri: quickBooksRedirectUri(),
    grant_type: "authorization_code",
  }));
}

export async function storeQuickBooksConnection(input: { workspaceId: string; userId: string; realmId: string; token: QuickBooksTokenResponse }) {
  const expiresAt = new Date(Date.now() + Math.max(60, input.token.expires_in ?? 3600) * 1000);
  return upsertIntegrationConnection({
    workspaceId: input.workspaceId,
    provider: QUICKBOOKS_PROVIDER,
    createdByUserId: input.userId,
    status: "connected",
    displayName: "QuickBooks Online",
    externalAccountId: input.realmId,
    credentials: {
      accessToken: encryptSecret(input.token.access_token) ?? "",
      refreshToken: encryptSecret(input.token.refresh_token) ?? "",
      tokenType: input.token.token_type ?? "Bearer",
    },
    config: {
      realmId: input.realmId,
      environment: env.QUICKBOOKS_ENVIRONMENT === "production" ? "production" : "sandbox",
      customerRefId: null,
      serviceItemRefId: null,
    },
    tokenExpiresAt: expiresAt,
    lastError: null,
  });
}

export async function ensureQuickBooksAccessToken(connection: IntegrationConnection) {
  const expiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt).getTime() : 0;
  const encryptedAccessToken = connection.credentials.accessToken;
  if (encryptedAccessToken && expiresAt > Date.now() + 60_000) {
    const token = decryptSecret(encryptedAccessToken);
    if (token) return token;
  }

  const refreshToken = decryptSecret(connection.credentials.refreshToken);
  if (!refreshToken) throw new Error("QuickBooks refresh token is missing. Reconnect QuickBooks.");
  const token = await tokenRequest(new URLSearchParams({ refresh_token: refreshToken, grant_type: "refresh_token" }));
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

async function quickBooksFetch<T>(connection: IntegrationConnection, path: string, init?: RequestInit) {
  const realmId = typeof connection.config.realmId === "string" ? connection.config.realmId : connection.externalAccountId;
  if (!realmId) throw new Error("QuickBooks realm ID is missing. Reconnect QuickBooks.");
  const accessToken = await ensureQuickBooksAccessToken(connection);
  const response = await fetch(`${quickBooksApiBase()}/v3/company/${encodeURIComponent(realmId)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const data = await response.json() as T & { Fault?: { Error?: Array<{ Message?: string; Detail?: string }> } };
  if (!response.ok) {
    const fault = data.Fault?.Error?.[0];
    throw new Error(fault?.Detail || fault?.Message || `QuickBooks request failed with ${response.status}`);
  }
  return data as T;
}

function stringConfig(connection: IntegrationConnection, key: string) {
  const value = connection.config[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function testQuickBooksConnection(workspaceId: string) {
  const connection = await getIntegrationConnection(workspaceId, QUICKBOOKS_PROVIDER);
  if (!connection || connection.status === "disabled") throw new Error("QuickBooks is not connected");
  await quickBooksFetch(connection, "/companyinfo/1?minorversion=75");
  await markIntegrationSynced(connection);
}

export async function updateQuickBooksConfig(input: { workspaceId: string; customerRefId?: string | null; serviceItemRefId?: string | null }) {
  const connection = await getIntegrationConnection(input.workspaceId, QUICKBOOKS_PROVIDER);
  if (!connection) throw new Error("QuickBooks is not connected");
  const [updated] = await db
    .update(integrationConnections)
    .set({
      config: {
        ...connection.config,
        customerRefId: input.customerRefId ?? connection.config.customerRefId ?? null,
        serviceItemRefId: input.serviceItemRefId ?? connection.config.serviceItemRefId ?? null,
      },
      updatedAt: new Date(),
      lastError: null,
    })
    .where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.workspaceId, input.workspaceId)))
    .returning();
  return updated;
}

export async function pushInvoiceToQuickBooks(input: { workspaceId: string; invoiceId: string; customerRefId?: string | null; serviceItemRefId?: string | null }) {
  const connection = await getIntegrationConnection(input.workspaceId, QUICKBOOKS_PROVIDER);
  if (!connection || connection.status === "disabled") throw new Error("QuickBooks is not connected");
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.workspaceId, input.workspaceId), eq(invoices.id, input.invoiceId)));
  if (!invoice) throw new Error("Invoice not found");

  const proof = await buildInvoiceProofPack(input.workspaceId, input.invoiceId);
  const customerRefId = input.customerRefId || stringConfig(connection, "customerRefId");
  const serviceItemRefId = input.serviceItemRefId || stringConfig(connection, "serviceItemRefId");
  if (!customerRefId || !serviceItemRefId) {
    throw new Error("Set QuickBooks customerRefId and serviceItemRefId before pushing invoices.");
  }

  const existing = await findSyncRecord({
    workspaceId: input.workspaceId,
    provider: QUICKBOOKS_PROVIDER,
    resourceType: "invoice",
    resourceId: invoice.id,
  });
  if (existing?.externalId) return { externalId: existing.externalId, reused: true };

  try {
    const description = [
      `SOWLedger invoice ${invoice.number}`,
      proof ? `Proof digest: ${proof.digest}` : null,
      proof ? `${proof.proofPack.totals.actualHours} actual hours across ${proof.proofPack.totals.entryCount} entries` : null,
    ].filter(Boolean).join("\n");
    const payload = {
      DocNumber: invoice.number,
      DueDate: invoice.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : undefined,
      CustomerRef: { value: customerRefId },
      Line: [
        {
          DetailType: "SalesItemLineDetail",
          Amount: Number(invoice.amount.toFixed(2)),
          Description: description.slice(0, 4000),
          SalesItemLineDetail: {
            ItemRef: { value: serviceItemRefId },
          },
        },
      ],
      PrivateNote: proof ? `SOWLedger proof digest ${proof.digest}` : "Created from SOWLedger.",
    };
    const data = await quickBooksFetch<QuickBooksInvoiceResponse>(connection, "/invoice?minorversion=75", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const externalId = data.Invoice?.Id;
    if (!externalId) throw new Error(data.Fault?.Error?.[0]?.Detail || "QuickBooks did not return an invoice ID");
    await upsertSyncRecord({
      workspaceId: input.workspaceId,
      connectionId: connection.id,
      provider: QUICKBOOKS_PROVIDER,
      resourceType: "invoice",
      resourceId: invoice.id,
      externalId,
      metadata: { docNumber: data.Invoice?.DocNumber ?? invoice.number, pushedAt: new Date().toISOString() },
    });
    await markIntegrationSynced(connection);
    return { externalId, reused: false };
  } catch (error) {
    await markIntegrationError(connection, error instanceof Error ? error.message : "QuickBooks push failed");
    throw error;
  }
}
