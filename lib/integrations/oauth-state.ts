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
  const [raw, signature] = state.split(".");
  if (!raw || !signature) throw new Error("Invalid OAuth state");
  const expected = sign(raw);
  const givenBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (givenBuffer.length !== expectedBuffer.length || !timingSafeEqual(givenBuffer, expectedBuffer)) {
    throw new Error("Invalid OAuth state signature");
  }
  const payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as IntegrationOAuthState;
  if (payload.provider !== expectedProvider) throw new Error("OAuth provider mismatch");
  if (payload.exp < Date.now()) throw new Error("OAuth state expired");
  return payload;
}
