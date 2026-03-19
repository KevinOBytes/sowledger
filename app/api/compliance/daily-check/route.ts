import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { enforceAuthKey } from "@/lib/security";
import { store } from "@/lib/store";

export async function POST(req: NextRequest) {
  try {
    await enforceAuthKey(req);
    const session = await requireSession();
    requireRole("member", session.role);

    const body = await req.json() as { businessDate?: string; submitted?: boolean };
    const businessDate = body.businessDate ? new Date(body.businessDate) : new Date();
    const key = `${session.workspaceId}:${session.sub}:${businessDate.toISOString().slice(0, 10)}`;

    if (body.submitted ?? true) {
      store.dailySubmissions.add(key);
    } else {
      store.dailySubmissions.delete(key);
    }

    return NextResponse.json({ ok: true, businessDate: businessDate.toISOString(), submitted: body.submitted ?? true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
