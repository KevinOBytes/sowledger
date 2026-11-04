import { NextRequest, NextResponse } from "next/server";
import { rateLimitIdentity } from "./lib/rate-limit-identity";
const AUTH_COOKIE_NAME = "sowledger_session";
const PUBLIC_PREFIXES = [
  "/login",
  "/support",
  "/security",
  "/privacy",
  "/terms",
  "/billing-policy",
  "/contact",
  "/monitoring",
  "/logo.png",
  "/manifest.webmanifest",
  "/api/auth/",
  "/api/cron/",
  "/api/deployment/readiness",
  "/api/health",
  "/api/integrations/google-calendar/oauth/callback",
  "/api/integrations/quickbooks/oauth/callback",
  "/api/integrations/slack/oauth/callback",
  "/api/stripe/webhook",
  "/api/test/",
  "/api/v1/",
  "/api/webhooks/stripe",
  "/_next/",
  "/favicon.ico",
];

type RateLimitRule = {
  name: string;
  windowSeconds: number;
  maxRequests: number;
  matches: (pathname: string) => boolean;
};

const RATE_LIMIT_RULES: RateLimitRule[] = [
  { name: "auth", windowSeconds: 300, maxRequests: 8, matches: (path) => path === "/api/auth/request-link" },
  { name: "public-api", windowSeconds: 60, maxRequests: 120, matches: (path) => path.startsWith("/api/v1/") },
  { name: "checkout", windowSeconds: 60, maxRequests: 12, matches: (path) => path === "/api/stripe/checkout" },
  { name: "api-keys", windowSeconds: 60, maxRequests: 30, matches: (path) => path.startsWith("/api/settings/api-keys") },
  { name: "exports", windowSeconds: 300, maxRequests: 20, matches: (path) => path.startsWith("/api/export/") },
  { name: "integrations", windowSeconds: 60, maxRequests: 60, matches: (path) => path.startsWith("/api/integrations/") },
];

const memoryCounters = new Map<string, { count: number; resetAt: number }>();

// Increment and expiry must be one operation. Repair older counters whose
// separate expiry request failed, without extending an existing fixed window.
const INCREMENT_WITH_EXPIRY = `
local count = redis.call("INCR", KEYS[1])
if count == 1 or redis.call("TTL", KEYS[1]) < 0 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return count
`;

function addSecurityHeaders(response: NextResponse) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  return response;
}

async function incrementWithUpstash(key: string, windowSeconds: number) {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;

  const response = await fetch(url.replace(/\/$/, ""), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(["EVAL", INCREMENT_WITH_EXPIRY, 1, key, windowSeconds]),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Rate limit store unavailable");
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || "error" in data || !("result" in data) ||
    typeof data.result !== "number" || !Number.isSafeInteger(data.result) || data.result < 1) {
    throw new Error("Rate limit store returned an invalid count");
  }
  return data.result;
}

function incrementInMemory(key: string, windowSeconds: number) {
  const now = Date.now();
  const current = memoryCounters.get(key);
  if (!current || current.resetAt <= now) {
    memoryCounters.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return 1;
  }
  const next = { ...current, count: current.count + 1 };
  memoryCounters.set(key, next);
  return next.count;
}

async function rateLimit(req: NextRequest, pathname: string) {
  const rule = RATE_LIMIT_RULES.find((item) => item.matches(pathname));
  if (!rule) return null;

  const key = `sowledger:${rule.name}:${rateLimitIdentity(req.headers, req.cookies.get(AUTH_COOKIE_NAME)?.value)}`;
  let count: number;
  try {
    count = await incrementWithUpstash(key, rule.windowSeconds) ?? incrementInMemory(key, rule.windowSeconds);
  } catch {
    count = incrementInMemory(key, rule.windowSeconds);
  }

  if (count <= rule.maxRequests) return null;
  return addSecurityHeaders(NextResponse.json(
    { error: "Too many requests. Please wait and try again." },
    {
      status: 429,
      headers: {
        "Retry-After": String(rule.windowSeconds),
        "X-RateLimit-Limit": String(rule.maxRequests),
        "X-RateLimit-Remaining": "0",
      },
    },
  ));
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const limited = await rateLimit(req, pathname);
  if (limited) return limited;

  const isPublicAudienceRoute = pathname === "/for" || pathname.startsWith("/for/");

  // Allow public paths without a session.
  if (["/", "/sitemap.xml", "/robots.txt", "/opengraph-image"].includes(pathname) || isPublicAudienceRoute || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return addSecurityHeaders(NextResponse.next());
  }

  const hasSession = Boolean(req.cookies.get(AUTH_COOKIE_NAME)?.value);
  if (!hasSession) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return addSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  return addSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
