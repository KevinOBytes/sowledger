import { NextRequest, NextResponse } from "next/server";
import { integrationErrorResponse } from "@/lib/integrations/errors";

import { requireRole, requireSession } from "@/lib/auth";
import { getIntegrationConnection, toPublicConnection, updateCurrentIntegrationConnection } from "@/lib/integrations/connections";
import { updateQuickBooksConfig } from "@/lib/integrations/quickbooks";
import { updateSlackConfig } from "@/lib/integrations/slack";
import { readRequestJson, WorkflowError } from "@/lib/workflow-validation";

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function asEvents(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((event): event is string => typeof event === "string" && event.trim().length > 0).map((event) => event.trim()).slice(0, 40);
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ provider: string }> }) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const { provider } = await context.params;
    const body = await readRequestJson(req) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);

    if (provider === "quickbooks") {
      const connection = await updateQuickBooksConfig({
        workspaceId: session.workspaceId,
        customerRefId: asString(body.customerRefId),
        serviceItemRefId: asString(body.serviceItemRefId),
      });
      return NextResponse.json({ ok: true, connection: toPublicConnection(connection) });
    }

    if (provider === "slack") {
      const connection = await updateSlackConfig(session.workspaceId, asEvents(body.events));
      return NextResponse.json({ ok: true, connection: toPublicConnection(connection) });
    }

    if (provider === "google_calendar") {
      const connection = await getIntegrationConnection(session.workspaceId, "google_calendar");
      if (!connection || connection.status === "disabled") return NextResponse.json({ error: "Google Calendar is not connected" }, { status: 404 });
      const config = {
        ...connection.config,
        calendarId: body.calendarId === undefined ? asString(connection.config.calendarId) ?? "primary" : asString(body.calendarId) ?? "primary",
        importBusy: asBoolean(body.importBusy, connection.config.importBusy !== false),
        syncScheduled: asBoolean(body.syncScheduled, connection.config.syncScheduled !== false),
      };
      const settingsChanged = config.calendarId !== connection.config.calendarId
        || config.importBusy !== connection.config.importBusy || config.syncScheduled !== connection.config.syncScheduled;
      const updated = await updateCurrentIntegrationConnection(connection, {
          config,
          ...(settingsChanged ? { lastSyncedAt: null } : {}),
          lastError: null,
          updatedAt: new Date(),
        });
      if (!updated) return NextResponse.json({ error: "Google Calendar changed while you were updating settings. Reload it and try again." }, { status: 409 });
      return NextResponse.json({ ok: true, connection: toPublicConnection(updated) });
    }

    return NextResponse.json({ error: "Unsupported integration provider" }, { status: 400 });
  } catch (error) {
    return integrationErrorResponse(error, "We couldn't confirm the integration settings were saved. Reload your integrations before trying again.", { route: "/api/integrations/[provider]/config", method: "PATCH" });
  }
}
