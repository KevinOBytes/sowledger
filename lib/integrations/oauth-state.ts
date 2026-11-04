import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";
import type { IntegrationProvider } from "@/lib/db/schema";

export type IntegrationOAuthState = {
  provider: IntegrationProvider;
  workspaceId: string;
  userId: string;
  returnTo: string;
  exp: number;
};

export class IntegrationOAuthStateError extends Error {
  constructor() { super("Integration setup was not completed. Start the connection again."); }
}

function stateSecret() {
  const secret = env.AUTH_COOKIE_SECRET;
  if (!secret || secret.length < 24) throw new Error("AUTH_COOKIE_SECRET must be configured for integration OAuth state");
  return secret;
}

function sign(raw: string) {
  return createHmac("sha256", stateSecret()).update(raw).digest("hex");
}

export function createIntegrationOAuthState(input: Omit<IntegrationOAuthState, "exp">) {
  const payload: IntegrationOAuthState = {
    ...input,
    exp: Date.now() + 10 * 60 * 1000,
  };
  const raw = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${raw}.${sign(raw)}`;
}

export function verifyIntegrationOAuthState(state: string, expectedProvider: IntegrationProvider) {
  const segments = state.split(".");
  const [raw, signature] = segments;
  if (segments.length !== 2 || !raw || !/^[A-Za-z0-9_-]+$/.test(raw) || !/^[a-f0-9]{64}$/.test(signature ?? "")) throw new IntegrationOAuthStateError();
  const expected = sign(raw);
  const givenBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (givenBuffer.length !== expectedBuffer.length || !timingSafeEqual(givenBuffer, expectedBuffer)) {
    throw new IntegrationOAuthStateError();
  }
  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")); } catch { throw new IntegrationOAuthStateError(); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new IntegrationOAuthStateError();
  const value = payload as Partial<IntegrationOAuthState>;
  if (value.provider !== expectedProvider || typeof value.workspaceId !== "string" || !value.workspaceId.trim()
    || typeof value.userId !== "string" || !value.userId.trim() || typeof value.returnTo !== "string"
    || typeof value.exp !== "number" || !Number.isFinite(value.exp) || value.exp <= Date.now()) throw new IntegrationOAuthStateError();
  return value as IntegrationOAuthState;
}
