import { NextResponse } from "next/server";
import type { IntegrationProvider } from "@/lib/db/schema";
import { WebhookUrlValidationError } from "@/lib/security";
import { classifyWorkflowError, reportUnexpectedRequestFailure, type WorkflowDiagnosticContext } from "@/lib/workflow-validation";

export type IntegrationFailureKind = "upstream" | "unexpected";
const unavailable = "The integration provider could not complete the request. Try again later.";
const invalid = "The integration provider returned an incomplete or invalid response. Review the integration before trying again.";

export class IntegrationProviderError extends Error {
  constructor(readonly provider: IntegrationProvider, readonly status: number, readonly kind: "http" | "payload" | "network" | "timeout" = "http") {
    super(kind === "payload" ? invalid : kind !== "http" || status >= 500 ? unavailable
      : status === 401 ? "The integration's authorization expired or was rejected. Reconnect it and try again."
      : status === 403 ? "The connected account does not have permission for this action. Check its permissions or reconnect it."
      : status === 429 ? "The integration is temporarily rate limited. Wait before trying again."
      : "The integration provider rejected this request. Review the connection settings before trying again.");
  }
}

export function invalidProviderResponse(provider: IntegrationProvider) { return new IntegrationProviderError(provider, 502, "payload"); }
export function integrationFailureKind(error: unknown): IntegrationFailureKind { return error instanceof IntegrationProviderError ? "upstream" : "unexpected"; }
export function integrationFailureSummary(provider: IntegrationProvider, kind: IntegrationFailureKind) {
  if (kind !== "upstream" && kind !== "unexpected") throw new Error("Unknown integration failure kind.");
  switch (provider) {
    case "google_calendar": return "Google Calendar sync failed. Review the connection and try again.";
    case "slack": return "Slack delivery failed. Review the connection and try again.";
    case "quickbooks": return "QuickBooks request failed. Review the connection before trying again.";
  }
}

// Only the actual transport/body-read boundary may classify transport failures.
function transportError(provider: IntegrationProvider, signal?: AbortSignal | null) {
  return new IntegrationProviderError(provider, signal?.aborted && signal.reason instanceof DOMException && signal.reason.name === "TimeoutError" ? 504 : 502,
    signal?.aborted && signal.reason instanceof DOMException && signal.reason.name === "TimeoutError" ? "timeout" : "network");
}
export async function integrationFetch(provider: IntegrationProvider, url: string, init: RequestInit) {
  try { return await fetch(url, init); } catch { throw transportError(provider, init.signal); }
}
export async function integrationResponseText(provider: IntegrationProvider, response: Response, signal?: AbortSignal | null) {
  try { return await response.text(); } catch { throw transportError(provider, signal); }
}
export function providerObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
export function providerString(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
export async function integrationResponseJson(provider: IntegrationProvider, response: Response, signal?: AbortSignal | null) {
  if (!response.ok) throw new IntegrationProviderError(provider, response.status);
  const text = await integrationResponseText(provider, response, signal);
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw invalidProviderResponse(provider); }
  if (!providerObject(data)) throw invalidProviderResponse(provider);
  return data;
}

export function integrationErrorResponse(error: unknown, fallback: string, context: WorkflowDiagnosticContext) {
  if (error instanceof IntegrationProviderError) {
    reportUnexpectedRequestFailure(context, "upstream");
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof WebhookUrlValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  const result = classifyWorkflowError(error, fallback);
  if (result.unexpected) reportUnexpectedRequestFailure(context);
  return NextResponse.json({ error: result.message }, { status: result.status });
}
