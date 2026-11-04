import { workflowErrorResponse } from "@/lib/workflow-validation";
import { NextRequest } from "next/server";

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
    const data = await loadExportData(session.workspaceId, params, { actorUserId: session.sub, format });
    return createExportResponse(data, format, `sowledger-${new Date().toISOString().slice(0, 10)}`);
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't export your data. Please try again.", { route: "/api/export/csv", method: "GET" });
  }
}
