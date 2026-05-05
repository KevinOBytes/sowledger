import { NextRequest, NextResponse } from "next/server";

import { requireRole, requireSession } from "@/lib/auth";
import { buildRevenueIntelligence } from "@/lib/revenue-intelligence";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const scope = req.nextUrl.searchParams.get("scope") === "team" ? "team" : "mine";
    if (scope === "team") requireRole("manager", session.role);
    else requireRole("member", session.role);

    const result = await buildRevenueIntelligence(session.workspaceId, {
      scope,
      userId: scope === "mine" ? session.sub : undefined,
      projectId: req.nextUrl.searchParams.get("projectId"),
      start: req.nextUrl.searchParams.get("start"),
      end: req.nextUrl.searchParams.get("end"),
    });

    return NextResponse.json(result);
  } catch (error) {
    const status = (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode ?? 403;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
