import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requireRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { integrationConnections } from "@/lib/db/schema";
import { getIntegrationConnection, toPublicConnection } from "@/lib/integrations/connections";
import { updateQuickBooksConfig } from "@/lib/integrations/quickbooks";
import { updateSlackConfig } from "@/lib/integrations/slack";

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
    const body = await req.json() as Record<string, unknown>;

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
      if (!connection) return NextResponse.json({ error: "Google Calendar is not connected" }, { status: 404 });
      const [updated] = await db.update(integrationConnections)
        .set({
          config: {
            ...connection.config,
            calendarId: asString(body.calendarId) ?? "primary",
            importBusy: asBoolean(body.importBusy, connection.config.importBusy !== false),
            syncScheduled: asBoolean(body.syncScheduled, connection.config.syncScheduled !== false),
          },
          lastError: null,
          updatedAt: new Date(),
        })
        .where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.workspaceId, session.workspaceId)))
        .returning();
      return NextResponse.json({ ok: true, connection: toPublicConnection(updated) });
    }

    return NextResponse.json({ error: "Unsupported integration provider" }, { status: 400 });
  } catch (error) {
    const err = error as { status?: number };
    return NextResponse.json({ error: (error as Error).message }, { status: err.status ?? 400 });
  }
}
