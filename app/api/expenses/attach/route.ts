import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { appendAuditLog, enforceAuthKey } from "@/lib/security";
import { store } from "@/lib/store";

export async function POST(req: NextRequest) {
  try {
    await enforceAuthKey(req);
    const session = await requireSession();
    requireRole("member", session.role);

    const body = await req.json() as {
      entryId?: string;
      label?: string;
      amount?: number;
      currency?: string;
      r2Key?: string;
    };

    if (!body.entryId || !body.label || !body.amount || !body.r2Key) {
      return NextResponse.json({ error: "entryId, label, amount, r2Key required" }, { status: 400 });
    }
    if (!/^receipts\/.+\.(pdf|png|jpg|jpeg)$/i.test(body.r2Key)) {
      return NextResponse.json({ error: "r2Key must be in receipts/ and be a supported file extension" }, { status: 400 });
    }

    const entry = store.entries.get(body.entryId);
    if (!entry || entry.workspaceId !== session.workspaceId) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    if (entry.userId !== session.sub && session.role === "member") {
      return NextResponse.json({ error: "Cannot add expense to another user's entry" }, { status: 403 });
    }

    const expense = {
      label: body.label,
      amount: Number(body.amount),
      currency: (body.currency ?? "USD").toUpperCase(),
      r2Key: body.r2Key,
    };

    entry.expenses.push(expense);

    await appendAuditLog({
      workspaceId: session.workspaceId,
      timeEntryId: entry.id,
      actorUserId: session.sub,
      eventType: "expense_attached",
      diff: { expense: { before: null, after: expense } },
    });

    return NextResponse.json({ ok: true, entryId: entry.id, expenses: entry.expenses });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
