import { NextRequest, NextResponse } from "next/server";
import { createMagicLink } from "@/lib/auth";
import { env } from "@/lib/env";
import { Resend } from "resend";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { email?: string };
    if (!body.email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    const token = await createMagicLink(body.email);
    const baseUrl = env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
    const verifyUrl = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;

    if (env.RESEND_API_KEY) {
      const resend = new Resend(env.RESEND_API_KEY);
      await resend.emails.send({
        from: env.RESEND_LOGIN_FROM,
        to: body.email,
        subject: "Sign in to Billabled",
        html: `<p>Click the link below to sign in:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
      });
      return NextResponse.json({ ok: true, delivery: "configured-resend" });
    }

    // Fallback for local dev if RESEND_API_KEY is not set
    return NextResponse.json({
      ok: true,
      verifyUrl,
      delivery: "dry-run",
      from: env.RESEND_LOGIN_FROM,
      note: "Send verifyUrl with Resend from logins@kevinbytes.com in production.",
    });
  } catch (error: any) {
    const errorMsg = error.cause ? `${error.message} | Cause: ${error.cause.message}` : error.message;
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
