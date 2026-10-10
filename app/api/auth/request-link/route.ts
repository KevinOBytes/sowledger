import { NextRequest, NextResponse } from "next/server";
import { checkMagicLinkEligibility, createMagicLink, ForbiddenError, UnauthorizedError } from "@/lib/auth";
import { getAppOrigin } from "@/lib/app-url";
import { env } from "@/lib/env";
import { isValidEmail } from "@/lib/validators";
import { Resend } from "resend";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as { email?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) {
      return NextResponse.json({ error: "Enter your email address." }, { status: 400 });
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    const eligibility = await checkMagicLinkEligibility(email);
    if (!eligibility.eligible) {
      return NextResponse.json({ error: eligibility.error }, { status: 403 });
    }

    const token = await createMagicLink(email);
    const baseUrl = getAppOrigin(env.NEXT_PUBLIC_APP_URL, req.nextUrl.origin);
    const verifyUrl = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;

    if (env.RESEND_API_KEY) {
      const resend = new Resend(env.RESEND_API_KEY);
      const delivery = await resend.emails.send({
        from: env.RESEND_LOGIN_FROM,
        to: email,
        subject: "Sign in to SOWLedger",
        html: `<p>Use this link to sign in to SOWLedger. It expires in 20 minutes.</p><p><a href="${verifyUrl}">Sign in to SOWLedger</a></p><p>If you didn't request this email, you can ignore it.</p>`,
      });
      if (delivery.error || !delivery.data?.id) {
        console.error("Sign-in email was not accepted", { providerError: delivery.error?.name ?? "missing_message_id" });
        return NextResponse.json({ error: "We couldn't send your sign-in email. Please try again in a few minutes." }, { status: 503 });
      }
      return NextResponse.json({ ok: true, delivery: "configured-resend" });
    }

    // Fallback for local dev only if RESEND_API_KEY is not set
    if (env.NODE_ENV !== "production") {
      return NextResponse.json({
        ok: true,
        verifyUrl,
        delivery: "dry-run",
        from: env.RESEND_LOGIN_FROM,
        note: "Local development sign-in link. No email was sent.",
      });
    }

    return NextResponse.json({
      error: "Sign-in email is temporarily unavailable. Please try again later.",
    }, { status: 503 });
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Sign-in request failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "We couldn't start sign-in. Please try again in a few minutes." }, { status: 503 });
  }
}
