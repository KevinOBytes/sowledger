import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

// This only chooses a rate-limit bucket. Route handlers still authenticate the
// session, re-check membership and enforce workspace/role authorization.
function signedSubject(token: string | undefined, secret: string | undefined) {
  if (!token || token.length > 4096 || !secret || secret.length < 24) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[a-f0-9]{64}$/.test(parts[1])) return null;
  const expected = createHmac("sha256", secret).update(parts[0]).digest();
  if (!timingSafeEqual(Buffer.from(parts[1], "hex"), expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (typeof payload.sub !== "string" || !payload.sub || typeof payload.workspaceId !== "string" || !payload.workspaceId ||
      typeof payload.email !== "string" || !payload.email || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
    // Renewed cookies for the same member must not create fresh allowances.
    return createHash("sha256").update(JSON.stringify([payload.sub, payload.workspaceId])).digest("hex");
  } catch {
    return null;
  }
}

export function rateLimitIdentity(headers: Headers, token?: string) {
  const subject = signedSubject(token, process.env.AUTH_COOKIE_SECRET);
  if (subject) return `session:${subject}`;

  // Vercel supplies this value at its trusted ingress. On other hosts, arbitrary
  // forwarded headers are untrusted; unknown clients share a conservative bucket.
  // https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for
  const ip = process.env.VERCEL === "1" ? headers.get("x-vercel-forwarded-for")?.trim() : undefined;
  if (ip && isIP(ip)) {
    const normalized = isIP(ip) === 6 ? new URL(`http://[${ip}]/`).hostname : ip;
    return `ip:${normalized}`;
  }
  return "anonymous";
}
