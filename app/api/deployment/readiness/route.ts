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

  const requiredChecks = {
    appUrl: Boolean(env.NEXT_PUBLIC_APP_URL),
    authSharedKey: Boolean(env.AUTH_SHARED_KEY),
    cronSecret: Boolean(env.CRON_SECRET),
    authCookieSecret: Boolean(env.AUTH_COOKIE_SECRET && env.AUTH_COOKIE_SECRET.length >= 24),
    auditSigningSecret: Boolean(env.AUDIT_SIGNING_SECRET),
    resendApiKey: Boolean(env.RESEND_API_KEY),
    neonPostgres: hasNeon(),
    stripeSecretKey: Boolean(env.STRIPE_SECRET_KEY),
    stripeWebhookSecret: Boolean(env.STRIPE_WEBHOOK_SECRET),
    stripePrices: Boolean(env.STRIPE_PRO_PRICE_ID && env.STRIPE_SMB_PRICE_ID && env.STRIPE_ENTERPRISE_PRICE_ID),
    upstashKv: hasUpstash(),
  };
  const optionalChecks = {
    sentryDsn: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
    sentryReleaseUpload: Boolean(process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT),
    googleCalendarOAuth: Boolean(env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET),
    slackOAuth: Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET),
    quickBooksOAuth: Boolean(env.QUICKBOOKS_CLIENT_ID && env.QUICKBOOKS_CLIENT_SECRET),
  };

  const passed = Object.values(requiredChecks).every(Boolean);
  return NextResponse.json({
    ok: passed,
    checks: requiredChecks,
    optionalChecks,
    degraded: Object.entries(optionalChecks).filter(([, value]) => !value).map(([key]) => key),
    deployment: {
      recommendedHost: "vercel",
      registrationMode: env.ALLOW_SELF_REGISTRATION ? "open" : "invite-only",
      bootstrapOwnerMode: env.ALLOW_BOOTSTRAP_OWNER,
    },
  }, { status: passed ? 200 : 503 });
}
