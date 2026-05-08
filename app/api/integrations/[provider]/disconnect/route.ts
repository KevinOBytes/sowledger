import { NextResponse } from "next/server";

import { requireRole, requireSession } from "@/lib/auth";
import { disconnectIntegration, INTEGRATION_PROVIDERS, toPublicConnection } from "@/lib/integrations/connections";
import type { IntegrationProvider } from "@/lib/db/schema";

export async function POST(_req: Request, context: { params: Promise<{ provider: string }> }) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const { provider } = await context.params;
    if (!INTEGRATION_PROVIDERS.includes(provider as IntegrationProvider)) {
      return NextResponse.json({ error: "Unsupported integration provider" }, { status: 400 });
    }
    const connection = await disconnectIntegration(session.workspaceId, provider as IntegrationProvider);
    return NextResponse.json({ ok: true, connection: connection ? toPublicConnection(connection) : null });
  } catch (error) {
    const err = error as { status?: number };
    return NextResponse.json({ error: (error as Error).message }, { status: err.status ?? 403 });
  }
}
