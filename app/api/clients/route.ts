import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { clients } from "@/lib/db/schema";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { eq } from "drizzle-orm";
import { readRequestJson, workflowErrorResponse } from "@/lib/workflow-validation";
import { createWorkspaceClient, updateWorkspaceClient } from "@/lib/client-mutations";
import { deleteUnreferencedWorkspaceClient } from "@/lib/client-history";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await ensureWorkspaceSchema();

    const data = await db.select().from(clients).where(eq(clients.workspaceId, session.workspaceId));
    return NextResponse.json({ ok: true, clients: data });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't load your clients. Please try again.", { route: "/api/clients", method: "GET" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const client = await createWorkspaceClient(session.workspaceId, await readRequestJson(req));
    return NextResponse.json({ ok: true, client });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't confirm the client was saved. Check your client list before trying again.", { route: "/api/clients", method: "POST" });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const client = await updateWorkspaceClient(session.workspaceId, await readRequestJson(req));
    return NextResponse.json({ ok: true, client });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't save this client. Please try again.", { route: "/api/clients", method: "PATCH" });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const clientId = req.nextUrl.searchParams.get("clientId");
    if (!clientId?.trim() || clientId.length > 255) return NextResponse.json({ error: "Choose a valid client." }, { status: 400 });
    await deleteUnreferencedWorkspaceClient(session.workspaceId, clientId);

    return NextResponse.json({ ok: true, deletedClientId: clientId });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't confirm the client was deleted. Refresh your client list before trying again.", { route: "/api/clients", method: "DELETE" });
  }
}
