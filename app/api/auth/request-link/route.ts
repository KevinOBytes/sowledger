import { NextRequest, NextResponse } from "next/server";
import { createMagicLink } from "@/lib/auth";
import { env } from "@/lib/env";
import { Resend } from "resend";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { email?: string };
    const email = body.email?.trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    const token = await createMagicLink(email);
    const baseUrl = env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
    const verifyUrl = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;

    if (env.RESEND_API_KEY) {
      const resend = new Resend(env.RESEND_API_KEY);
      await resend.emails.send({
        from: env.RESEND_LOGIN_FROM,
        to: email,
        subject: "Sign in to Billabled",
        html: `<p>Click the link below to sign in:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
      });
      return NextResponse.json({ ok: true, delivery: "configured-resend" });
    }

    // Fallback for local dev only if RESEND_API_KEY is not set
    if (env.NODE_ENV !== "production") {
      return NextResponse.json({
        ok: true,
        verifyUrl,
        delivery: "dry-run",
        from: env.RESEND_LOGIN_FROM,
        note: "Send verifyUrl with Resend from logins@kevinbytes.com in production.",
      });
    }

    return NextResponse.json({
      error: "Email delivery is not configured",
    }, { status: 503 });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
