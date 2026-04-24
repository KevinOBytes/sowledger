import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { requireRole, requireSession } from "@/lib/auth";
import { generateApiKeyMaterial, normalizeScopes, toPublicApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { apiKeyRequests, apiKeys } from "@/lib/db/schema";

function statusFrom(error: unknown) {
  const err = error as { status?: number; statusCode?: number };
  return err.status ?? err.statusCode ?? 500;
}

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const keys = await db.select().from(apiKeys)
      .where(eq(apiKeys.workspaceId, session.workspaceId))
      .orderBy(desc(apiKeys.createdAt));
    const usage = await db.select().from(apiKeyRequests)
      .where(eq(apiKeyRequests.workspaceId, session.workspaceId))
      .orderBy(desc(apiKeyRequests.createdAt))
      .limit(100);

    return NextResponse.json({ ok: true, keys: keys.map(toPublicApiKey), usage });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: statusFrom(error) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const body = await req.json() as { name?: string; scopes?: string[]; expiresAt?: string | null };
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const scopes = normalizeScopes(body.scopes);
    if (scopes.length === 0) return NextResponse.json({ error: "At least one valid scope is required" }, { status: 400 });
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) return NextResponse.json({ error: "expiresAt must be a valid date" }, { status: 400 });

    const material = generateApiKeyMaterial();
    const [key] = await db.insert(apiKeys).values({
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      name,
      keyHash: material.keyHash,
      keyPrefix: material.keyPrefix,
      scopes,
      createdByUserId: session.sub,
      expiresAt,
    }).returning();

    return NextResponse.json({ ok: true, key: toPublicApiKey(key), rawKey: material.rawKey });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: statusFrom(error) });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const body = await req.json() as { keyId?: string; name?: string; scopes?: string[]; expiresAt?: string | null; rotate?: boolean };
    if (!body.keyId) return NextResponse.json({ error: "keyId is required" }, { status: 400 });

    const [existing] = await db.select().from(apiKeys).where(and(eq(apiKeys.id, body.keyId), eq(apiKeys.workspaceId, session.workspaceId)));
    if (!existing) return NextResponse.json({ error: "API key not found" }, { status: 404 });

    const updates: Partial<typeof apiKeys.$inferInsert> = {};
    let rawKey: string | undefined;
    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.scopes !== undefined) updates.scopes = normalizeScopes(body.scopes);
    if (body.expiresAt !== undefined) updates.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (body.rotate) {
      const material = generateApiKeyMaterial();
      updates.keyHash = material.keyHash;
      updates.keyPrefix = material.keyPrefix;
      updates.lastUsedAt = null;
      rawKey = material.rawKey;
    }

    const [key] = await db.update(apiKeys).set(updates).where(eq(apiKeys.id, body.keyId)).returning();
    return NextResponse.json({ ok: true, key: toPublicApiKey(key), rawKey });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: statusFrom(error) });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    await ensureWorkspaceSchema();

    const keyId = req.nextUrl.searchParams.get("keyId");
    if (!keyId) return NextResponse.json({ error: "keyId is required" }, { status: 400 });

    const [key] = await db.update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.workspaceId, session.workspaceId)))
      .returning();

    if (!key) return NextResponse.json({ error: "API key not found" }, { status: 404 });
    return NextResponse.json({ ok: true, key: toPublicApiKey(key) });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: statusFrom(error) });
  }
}
