import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { clients, organizations, projects } from "@/lib/db/schema";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { eq, and } from "drizzle-orm";

function getErrorStatus(error: unknown, fallback = 500): number {
  const err: unknown = error;
  if (err && ((err as Record<string, unknown>).code === "FORBIDDEN" || (err as Record<string, unknown>).status === 403 || (err as Record<string, unknown>).message === "Forbidden")) {
    return 403;
  }
  if (err && ((err as Record<string, unknown>).code === "UNAUTHORIZED" || (err as Record<string, unknown>).status === 401)) {
    return 401;
  }
  return fallback;
}

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await ensureWorkspaceSchema();

    const data = await db.select().from(clients).where(eq(clients.workspaceId, session.workspaceId));
    return NextResponse.json({ ok: true, clients: data });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getErrorStatus(error) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const body = await req.json() as {
      name?: string;
      email?: string;
      address?: string;
      currencyOverride?: string;
    };

    if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const newClient = {
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      name: body.name,
      email: body.email,
      address: body.address,
      currencyOverride: body.currencyOverride,
    };

    const [client] = await db.insert(clients).values(newClient).returning();
    await db.insert(organizations).values({
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      clientId: client.id,
      name: client.name,
      type: "client",
    });
    return NextResponse.json({ ok: true, client });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getErrorStatus(error) });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const body = await req.json() as {
      clientId?: string;
      name?: string;
      email?: string;
      address?: string;
      currencyOverride?: string;
      status?: "active" | "archived";
    };

    if (!body.clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

    const [existing] = await db.select().from(clients).where(and(eq(clients.id, body.clientId), eq(clients.workspaceId, session.workspaceId)));
    if (!existing) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const updates: Partial<typeof clients.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.email !== undefined) updates.email = body.email;
    if (body.address !== undefined) updates.address = body.address;
    if (body.currencyOverride !== undefined) updates.currencyOverride = body.currencyOverride;
    if (body.status !== undefined) updates.status = body.status;

    const [client] = await db.update(clients).set(updates).where(and(eq(clients.id, body.clientId), eq(clients.workspaceId, session.workspaceId))).returning();
    if (body.name !== undefined) {
      await db
        .update(organizations)
        .set({ name: body.name })
        .where(and(eq(organizations.workspaceId, session.workspaceId), eq(organizations.clientId, body.clientId)));
    }
    return NextResponse.json({ ok: true, client });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getErrorStatus(error) });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const clientId = req.nextUrl.searchParams.get("clientId");
    if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

    const [existing] = await db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.workspaceId, session.workspaceId)));
    if (!existing) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    await db.delete(organizations).where(and(eq(organizations.workspaceId, session.workspaceId), eq(organizations.clientId, clientId)));
    await db.delete(clients).where(and(eq(clients.id, clientId), eq(clients.workspaceId, session.workspaceId)));

    // Clear clientId from projects
    await db.update(projects).set({ clientId: null }).where(and(eq(projects.workspaceId, session.workspaceId), eq(projects.clientId, clientId)));

    return NextResponse.json({ ok: true, deletedClientId: clientId });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: getErrorStatus(error) });
  }
}
