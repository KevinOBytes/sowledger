import { NextResponse } from "next/server";
import { env } from "@/lib/env";

function hasNeon() {
  return Boolean(env.DATABASE_URL && /neon|postgres/i.test(env.DATABASE_URL));
}

function hasUpstash() {
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}

export async function GET() {
  const checks = {
    appUrl: Boolean(env.NEXT_PUBLIC_APP_URL),
    authCookieSecret: Boolean(env.AUTH_COOKIE_SECRET && env.AUTH_COOKIE_SECRET.length >= 24),
    auditSigningSecret: Boolean(env.AUDIT_SIGNING_SECRET),
    resendApiKey: Boolean(env.RESEND_API_KEY),
    neonPostgres: hasNeon(),
    upstashKv: hasUpstash(),
  };

  const passed = Object.values(checks).every(Boolean);
  return NextResponse.json({
    ok: passed,
    checks,
    deployment: {
      recommendedHost: "vercel",
      registrationMode: env.ALLOW_SELF_REGISTRATION ? "open" : "invite-only",
      bootstrapOwnerMode: env.ALLOW_BOOTSTRAP_OWNER,
    },
  }, { status: passed ? 200 : 503 });
}
