import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiKeyRequests, apiKeys } from "@/lib/db/schema";
import { env } from "@/lib/env";

export const API_SCOPES = [
  "read:clients",
  "write:clients",
  "read:projects",
  "write:projects",
  "read:tags",
  "write:tags",
  "read:tasks",
  "write:tasks",
  "read:schedule",
  "write:schedule",
  "read:time",
  "write:time",
  "read:analytics",
  "read:invoices",
  "export:data",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];
export type ApiKeyContext = {
  id: string;
  workspaceId: string;
  scopes: string[];
  name: string;
};

function hashInput(rawKey: string) {
  if (env.NODE_ENV === "production" && !env.AUTH_COOKIE_SECRET) {
    throw new Error("AUTH_COOKIE_SECRET must be configured before API keys can be used in production");
  }
  const pepper = env.AUTH_COOKIE_SECRET ?? "dev-api-key-pepper";
  return createHash("sha256").update(`${pepper}:${rawKey}`).digest("hex");
}

function getBearerToken(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

export function generateApiKeyMaterial() {
  const secret = randomBytes(32).toString("base64url");
  const rawKey = `blb_${secret}`;
  return {
    rawKey,
    keyHash: hashInput(rawKey),
    keyPrefix: rawKey.slice(0, 12),
  };
}

export function normalizeScopes(scopes: unknown): ApiScope[] {
  if (!Array.isArray(scopes)) return [];
  const allowed = new Set<string>(API_SCOPES);
  return [...new Set(scopes.filter((scope): scope is ApiScope => typeof scope === "string" && allowed.has(scope)))];
}

export async function authenticateApiKey(req: NextRequest): Promise<ApiKeyContext> {
  const token = getBearerToken(req);
  if (!token) throw new UnauthorizedError("Missing API key bearer token");

  const keyHash = hashInput(token);
  const [key] = await db.select().from(apiKeys).where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)));
  if (!key) throw new UnauthorizedError("Invalid API key");
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) {
    throw new UnauthorizedError("API key expired");
  }

  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));

  return {
    id: key.id,
    workspaceId: key.workspaceId,
    name: key.name,
    scopes: Array.isArray(key.scopes) ? key.scopes : [],
  };
}

export function requireApiScope(context: ApiKeyContext, scope: ApiScope) {
  if (!context.scopes.includes(scope)) {
    throw new ForbiddenError(`Missing API scope: ${scope}`);
  }
}

function safeIpHash(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "";
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("hex");
}

export async function recordApiKeyRequest(context: ApiKeyContext | null, req: NextRequest, status: number) {
  if (!context) return;
  await db.insert(apiKeyRequests).values({
    id: crypto.randomUUID(),
    workspaceId: context.workspaceId,
    apiKeyId: context.id,
    method: req.method,
    path: req.nextUrl.pathname + req.nextUrl.search,
    status,
    ipHash: safeIpHash(req),
    userAgent: (req.headers.get("user-agent") ?? "").slice(0, 512) || null,
  });
}

export function toPublicApiKey(key: typeof apiKeys.$inferSelect) {
  return {
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    scopes: key.scopes,
    createdByUserId: key.createdByUserId,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
    revokedAt: key.revokedAt,
    createdAt: key.createdAt,
  };
}

export function safeCompare(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
