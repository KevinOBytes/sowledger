import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json({ ok: true, session });
  } catch {
    return NextResponse.json({ ok: false, session: null }, { status: 401 });
  }
}
