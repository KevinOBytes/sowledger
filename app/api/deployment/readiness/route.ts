import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

function hasNeon() {
  return Boolean(env.DATABASE_URL && /neon|postgres/i.test(env.DATABASE_URL));
}

function hasUpstash() {
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}

export async function GET(req: NextRequest) {
  const providedKey = req.headers.get("x-auth-key");
  const detailsAllowed = process.env.NODE_ENV === "development" || Boolean(env.AUTH_SHARED_KEY && providedKey === env.AUTH_SHARED_KEY);
  if (!detailsAllowed) return NextResponse.json({ ok: true, service: "billabled" });

  const checks = {
    appUrl: Boolean(env.NEXT_PUBLIC_APP_URL),
    authCookieSecret: Boolean(env.AUTH_COOKIE_SECRET && env.AUTH_COOKIE_SECRET.length >= 24),
    auditSigningSecret: Boolean(env.AUDIT_SIGNING_SECRET),
    resendApiKey: Boolean(env.RESEND_API_KEY),
    neonPostgres: hasNeon(),
    stripeSecretKey: Boolean(env.STRIPE_SECRET_KEY),
    stripeWebhookSecret: Boolean(env.STRIPE_WEBHOOK_SECRET),
    stripePrices: Boolean(env.STRIPE_PRO_PRICE_ID && env.STRIPE_SMB_PRICE_ID && env.STRIPE_ENTERPRISE_PRICE_ID),
    sentryDsn: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
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
