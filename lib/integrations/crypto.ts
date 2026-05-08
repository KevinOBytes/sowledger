import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { env } from "@/lib/env";

const VERSION = "v1";

function encryptionSecret() {
  const secret = env.AUTH_COOKIE_SECRET ?? env.AUDIT_SIGNING_SECRET;
  if (!secret || secret.length < 24) {
    if (env.NODE_ENV === "production") {
      throw new Error("AUTH_COOKIE_SECRET or AUDIT_SIGNING_SECRET must be configured before storing integration credentials");
    }
    return "dev-only-billabled-integration-secret";
  }
  return secret;
}

function key() {
  return createHash("sha256").update(encryptionSecret()).digest();
}

export function encryptSecret(value: string | null | undefined) {
  if (!value) return undefined;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptSecret(value: string | null | undefined) {
  if (!value) return null;
  const [version, ivRaw, tagRaw, encryptedRaw] = value.split(":");
  if (version !== VERSION || !ivRaw || !tagRaw || !encryptedRaw) throw new Error("Unsupported encrypted credential format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
