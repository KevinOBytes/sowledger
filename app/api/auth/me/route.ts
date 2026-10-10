import { NextResponse } from "next/server";
import { requireSession, UnauthorizedError } from "@/lib/auth";

export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json({ ok: true, session });
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ ok: false, session: null, error: "Please sign in again." }, { status: 401 });
    console.error("Session lookup failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ ok: false, error: "We couldn't load your account. Please try again." }, { status: 503 });
  }
}
