import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";
import { rateLimitIdentity } from "../lib/rate-limit-identity";

const secret = "isolated-rate-limit-test-secret-not-a-credential";
function token(sub: string, exp = Date.now() + 60000, signingSecret = secret) {
  const raw = Buffer.from(JSON.stringify({ sub, workspaceId: "test", email: `${sub}@example.com`, exp })).toString("base64url");
  return `${raw}.${createHmac("sha256", signingSecret).update(raw).digest("hex")}`;
}

test("rate limiting rejects cookie/header rotation without breaking signed-member buckets", async () => {
  const keys = ["AUTH_COOKIE_SECRET", "VERCEL", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.AUTH_COOKIE_SECRET = secret;
  process.env.VERCEL = "1";
  try {
    const request = (cookie: string, spoofedIp: string, trustedIp = "192.0.2.10") => new NextRequest("https://sowledger.example/api/auth/request-link", {
      headers: { cookie: `sowledger_session=${cookie}`, "x-vercel-forwarded-for": trustedIp, "x-forwarded-for": spoofedIp, "x-real-ip": spoofedIp },
    });
    for (let i = 0; i < 8; i++) assert.equal((await proxy(request(`forged-${i}`, `198.51.100.${i}`))).status, 200);
    const blocked = await proxy(request("new-forged-cookie", "203.0.113.20"));
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("Retry-After"), "300");
    assert.equal((await proxy(request("", "203.0.113.21"))).status, 429);
    assert.equal((await proxy(request(token("forged", undefined, "wrong-secret"), "203.0.113.22"))).status, 429);
    assert.equal((await proxy(request(token("expired", Date.now() - 1), "203.0.113.23"))).status, 429);
    assert.equal((await proxy(request("", "203.0.113.24", "192.0.2.11"))).status, 200);

    // Legitimate signed members behind the same IP do not consume each other's allowance.
    for (let i = 0; i < 8; i++) assert.equal((await proxy(request(token("member-a", Date.now() + 60000 + i), "192.0.2.10"))).status, 200);
    assert.equal((await proxy(request(token("member-a"), "192.0.2.10"))).status, 429);
    assert.equal((await proxy(request(token("member-b"), "192.0.2.10"))).status, 200);

    const headers = (ip: string) => new Headers({ "x-vercel-forwarded-for": ip, "x-forwarded-for": ip, "x-real-ip": ip });
    const canonical = token("member-a");
    const [raw, mac] = canonical.split(".");
    for (const alternate of [`${raw}.${mac.toUpperCase()}`, `${canonical}.extra`, `${canonical}not-hex`]) {
      assert.equal(rateLimitIdentity(headers("192.0.2.10"), alternate), "ip:192.0.2.10");
    }
    // Database-backed auth-repairs coverage separately proves these alternate
    // forms cannot authenticate, so they cannot use a protected endpoint.
    assert.equal(rateLimitIdentity(headers("2001:db8::1")), rateLimitIdentity(headers("2001:0db8:0000:0000:0000:0000:0000:0001")));
    assert.equal(rateLimitIdentity(headers("192.0.2.1, 192.0.2.2")), "anonymous");
    assert.equal(rateLimitIdentity(headers("not-an-ip")), "anonymous");
    delete process.env.VERCEL;
    for (let i = 0; i < 8; i++) assert.equal((await proxy(request(`untrusted-${i}`, `198.51.100.${i}`, `192.0.2.${i}`))).status, 200);
    assert.equal((await proxy(request("another-cookie", "198.51.100.99", "192.0.2.99"))).status, 429);
    delete process.env.AUTH_COOKIE_SECRET;
    assert.equal(rateLimitIdentity(headers("192.0.2.1"), token("member-c")), "anonymous");

    for (const pathname of ["/robots.txt", "/sitemap.xml", "/opengraph-image", "/for/seo-consultants"]) {
      assert.equal((await proxy(new NextRequest(`https://sowledger.example${pathname}`))).status, 200);
    }
    for (const pathname of ["/dashboard", "/robots.txt/private", "/opengraph-image/private"]) {
      assert.equal((await proxy(new NextRequest(`https://sowledger.example${pathname}`))).status, 307);
    }
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
