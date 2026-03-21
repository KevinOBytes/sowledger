import { NextRequest, NextResponse } from "next/server";
import { createMagicLink } from "@/lib/auth";
import { env } from "@/lib/env";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { email?: string };
    if (!body.email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    const token = createMagicLink(body.email);
    const baseUrl = env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
    const verifyUrl = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;

    return NextResponse.json({
      ok: true,
      verifyUrl,
      delivery: env.RESEND_API_KEY ? "configured-resend" : "dry-run",
      from: env.RESEND_LOGIN_FROM,
      note: "Send verifyUrl with Resend from logins@kevinbytes.com in production.",
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
