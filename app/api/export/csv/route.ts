import { NextRequest, NextResponse } from "next/server";

import { requireRole, requireSession } from "@/lib/auth";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { createExportResponse, loadExportData } from "@/lib/export-data";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const params = Object.fromEntries(req.nextUrl.searchParams.entries());
    const format = params.format === "json" ? "json" : "csv";
    const data = await loadExportData(session.workspaceId, params);
    return createExportResponse(data, format, `billabled-${new Date().toISOString().slice(0, 10)}`);
  } catch (error) {
    const status = (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode ?? 403;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
