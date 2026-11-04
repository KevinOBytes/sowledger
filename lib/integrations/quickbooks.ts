import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { integrationConnections, invoices, type IntegrationProvider } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { buildInvoiceProofPack } from "@/lib/invoice-proof-pack";
import { WorkflowError } from "@/lib/workflow-validation";
import { duplicateInvoiceConflict, hasDuplicateInvoiceLinks } from "@/lib/invoice-client-state";
import { exposeInvoice, lockInvoiceLifecycle } from "@/lib/invoice-lifecycle";
import { integrationFetch, integrationResponseJson, invalidProviderResponse, integrationFailureKind, providerObject, providerString } from "@/lib/integrations/errors";
import { decryptSecret, encryptSecret } from "@/lib/integrations/crypto";
import { abandonUnsentQuickBooksInvoice, assertQuickBooksCurrent, claimQuickBooksInvoice, claimQuickBooksRefresh, confirmQuickBooksInvoice, confirmedQuickBooksReceipt, quickBooksChanged, quickBooksIdentity, quickBooksOwnership } from "@/lib/integrations/quickbooks-operations";
import {
  findSyncRecord,
  getIntegrationConnection,
  markIntegrationError,
  markIntegrationSynced,
  type IntegrationConnection,
  upsertIntegrationConnection,
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
  const response = await integrationFetch(QUICKBOOKS_PROVIDER, QUICKBOOKS_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${env.QUICKBOOKS_CLIENT_ID}:${env.QUICKBOOKS_CLIENT_SECRET}`).toString("base64")}`,
      Accept: "application/json",
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const data = await integrationResponseJson(QUICKBOOKS_PROVIDER, response) as QuickBooksTokenResponse;
  if (data.error || !providerString(data.access_token)
    || (data.refresh_token !== undefined && !providerString(data.refresh_token))
    || (data.expires_in !== undefined && (typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in)))
    || (data.token_type !== undefined && !providerString(data.token_type))) throw invalidProviderResponse(QUICKBOOKS_PROVIDER);
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
  if (!providerString(input.token.access_token) || !providerString(input.token.refresh_token)) throw invalidProviderResponse(QUICKBOOKS_PROVIDER);
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
      connectionGeneration: crypto.randomUUID(),
      realmId: input.realmId,
      environment: env.QUICKBOOKS_ENVIRONMENT === "production" ? "production" : "sandbox",
      customerRefId: null,
      serviceItemRefId: null,
    },
    tokenExpiresAt: expiresAt,
    lastSyncedAt: null,
    lastError: null,
  });
}

export async function ensureQuickBooksAccessToken(connection: IntegrationConnection) {
  quickBooksIdentity(connection);
  await assertQuickBooksCurrent(connection);
  const expiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt).getTime() : 0;
  const encryptedAccessToken = connection.credentials.accessToken;
  if (encryptedAccessToken && expiresAt > Date.now() + 60_000) {
    const token = decryptSecret(encryptedAccessToken);
    if (token) return token;
  }

  const refreshToken = decryptSecret(connection.credentials.refreshToken);
  if (!refreshToken) throw new WorkflowError("QuickBooks refresh token is missing. Reconnect QuickBooks.", 409);
  await claimQuickBooksRefresh(connection);
  await assertQuickBooksCurrent(connection);
  const token = await tokenRequest(new URLSearchParams({ refresh_token: refreshToken, grant_type: "refresh_token" }));
  const nextExpiresAt = new Date(Date.now() + Math.max(60, token.expires_in ?? 3600) * 1000);
  const [updated] = await db
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
    .where(quickBooksOwnership(connection)).returning();
  if (!updated) throw new WorkflowError(quickBooksChanged, 409);
  Object.assign(connection, updated);
  return token.access_token;
}

async function quickBooksFetch<T>(connection: IntegrationConnection, path: string, init?: RequestInit) {
  const { realmId, environment } = quickBooksIdentity(connection);
  const accessToken = await ensureQuickBooksAccessToken(connection);
  await assertQuickBooksCurrent(connection);
  const base = environment === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";
  const response = await integrationFetch(QUICKBOOKS_PROVIDER, `${base}/v3/company/${encodeURIComponent(realmId)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(20_000),
  });
  const data = await integrationResponseJson(QUICKBOOKS_PROVIDER, response, init?.signal);
  return data as T;
}

function stringConfig(connection: IntegrationConnection, key: string) {
  const value = connection.config[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function testQuickBooksConnection(workspaceId: string) {
  const connection = await getIntegrationConnection(workspaceId, QUICKBOOKS_PROVIDER);
  if (!connection || connection.status === "disabled") throw new WorkflowError("QuickBooks is not connected", 404);
  const data = await quickBooksFetch<Record<string, unknown>>(connection, "/companyinfo/1?minorversion=75");
  if (!providerObject(data.CompanyInfo) || !providerString(data.CompanyInfo.Id)) throw invalidProviderResponse(QUICKBOOKS_PROVIDER);
  await markIntegrationSynced(connection);
}

export async function updateQuickBooksConfig(input: { workspaceId: string; customerRefId?: string | null; serviceItemRefId?: string | null }) {
  const connection = await getIntegrationConnection(input.workspaceId, QUICKBOOKS_PROVIDER);
  if (!connection || connection.status === "disabled") throw new WorkflowError("QuickBooks is not connected", 404);
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
    .where(quickBooksOwnership(connection))
    .returning();
  if (!updated) throw new WorkflowError(quickBooksChanged, 409);
  return updated;
}

export async function pushInvoiceToQuickBooks(input: { workspaceId: string; invoiceId: string; customerRefId?: string | null; serviceItemRefId?: string | null }) {
  // Commit the scoped, monotonic-status check before touching credentials or
  // receipts. This is a local perimeter, not an atomic DB/provider export.
  const invoice = await db.transaction(async (tx) => {
    await lockInvoiceLifecycle(tx, input.workspaceId);
    const [current] = await tx.select().from(invoices)
      .where(and(eq(invoices.workspaceId, input.workspaceId), eq(invoices.id, input.invoiceId))).for("update");
    if (!current) throw new WorkflowError("Invoice not found.", 404);
    if (hasDuplicateInvoiceLinks(current.timeEntryIds)) throw new WorkflowError(duplicateInvoiceConflict, 409);
    if (current.status !== "sent" && current.status !== "paid") throw new WorkflowError("Review the invoice and mark it as sent before pushing it to QuickBooks.", 409);
    // Durable even if integration receipts later disappear on disconnect.
    await exposeInvoice(tx, input.workspaceId, current.id, "quickbooks", "QuickBooks invoice push attempted");
    return current;
  }, { isolationLevel: "read committed" });
  const connection = await getIntegrationConnection(input.workspaceId, QUICKBOOKS_PROVIDER);
  if (!connection || connection.status === "disabled") throw new WorkflowError("QuickBooks is not connected", 404);

  const proof = await buildInvoiceProofPack(input.workspaceId, input.invoiceId);
  const customerRefId = input.customerRefId || stringConfig(connection, "customerRefId");
  const serviceItemRefId = input.serviceItemRefId || stringConfig(connection, "serviceItemRefId");
  if (!customerRefId || !serviceItemRefId) {
    throw new WorkflowError("Set QuickBooks customerRefId and serviceItemRefId before pushing invoices.", 400);
  }

  const existing = await findSyncRecord({
    workspaceId: input.workspaceId,
    provider: QUICKBOOKS_PROVIDER,
    resourceType: "invoice",
    resourceId: invoice.id,
  });
  if (existing) {
    await assertQuickBooksCurrent(connection);
    return { externalId: confirmedQuickBooksReceipt(existing, connection), reused: true };
  }

  // Refresh before reserving an invoice: a proven authorization/config failure
  // must not strand an invoice that was never dispatched.
  const accessToken = await ensureQuickBooksAccessToken(connection);
  let reservation: Awaited<ReturnType<typeof claimQuickBooksInvoice>> | undefined;
  let dispatched = false;

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
    reservation = await claimQuickBooksInvoice(connection, invoice.id, payload);
    if (reservation.reused) return { externalId: reservation.externalId, reused: true };
    await assertQuickBooksCurrent(connection);
    const { realmId, environment } = quickBooksIdentity(connection);
    const base = environment === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";
    dispatched = true;
    const response = await integrationFetch(QUICKBOOKS_PROVIDER, `${base}/v3/company/${encodeURIComponent(realmId)}/invoice?minorversion=75&requestid=${encodeURIComponent(String(reservation.record.metadata.requestId))}`, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "Content-Type": "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    const data = await integrationResponseJson(QUICKBOOKS_PROVIDER, response) as QuickBooksInvoiceResponse;
    const externalId = data.Invoice?.Id;
    if (!providerString(externalId)) throw invalidProviderResponse(QUICKBOOKS_PROVIDER);
    await confirmQuickBooksInvoice(reservation.record, externalId, data.Invoice?.DocNumber ?? invoice.number);
    await markIntegrationSynced(connection);
    return { externalId, reused: false };
  } catch (error) {
    if (reservation && !reservation.reused && !dispatched) await abandonUnsentQuickBooksInvoice(reservation.record);
    await markIntegrationError(connection, integrationFailureKind(error));
    throw error;
  }
}
