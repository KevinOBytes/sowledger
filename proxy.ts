import { NextRequest, NextResponse } from "next/server";

const AUTH_COOKIE_NAME = "billabled_session";

const PUBLIC_PREFIXES = [
  "/login",
  "/support",
  "/logo.png",
  "/manifest.webmanifest",
  "/api/auth/",
  "/api/deployment/readiness",
  "/api/health",
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
];

const memoryCounters = new Map<string, { count: number; resetAt: number }>();

function addSecurityHeaders(response: NextResponse) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  return response;
}

function clientIdentifier(req: NextRequest) {
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = req.headers.get("x-real-ip")?.trim();
  const sessionPrefix = req.cookies.get(AUTH_COOKIE_NAME)?.value?.slice(0, 18);
  return forwardedFor || realIp || sessionPrefix || "anonymous";
}

async function incrementWithUpstash(key: string, windowSeconds: number) {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;

  const safeKey = encodeURIComponent(key);
  const headers = { Authorization: `Bearer ${token}` };
  const response = await fetch(`${url.replace(/\/$/, "")}/incr/${safeKey}`, { headers, cache: "no-store" });
  if (!response.ok) throw new Error("Rate limit store unavailable");
  const data = await response.json() as { result?: number };
  const count = Number(data.result ?? 1);
  if (count === 1) {
    await fetch(`${url.replace(/\/$/, "")}/expire/${safeKey}/${windowSeconds}`, { headers, cache: "no-store" }).catch(() => null);
  }
  return count;
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

  const key = `billabled:${rule.name}:${clientIdentifier(req)}`;
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

  // Allow public paths without a session.
  if (pathname === "/" || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
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
