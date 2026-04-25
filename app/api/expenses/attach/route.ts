import { NextRequest, NextResponse } from "next/server";
import { ForbiddenError, requireSession, requireRole, UnauthorizedError } from "@/lib/auth";
import { appendAuditLog } from "@/lib/security";
import { db } from "@/lib/db";
import { timeEntries } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const body = await req.json() as {
      entryId?: string;
      label?: string;
      amount?: number;
      currency?: string;
      r2Key?: string;
    };

    if (!body.entryId || !body.label || body.amount === undefined || !body.r2Key) {
      return NextResponse.json({ error: "entryId, label, amount, r2Key required" }, { status: 400 });
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "amount must be a positive, finite number" }, { status: 400 });
    }

    if (!/^receipts\/.+\.(pdf|png|jpg|jpeg)$/i.test(body.r2Key)) {
      return NextResponse.json({ error: "r2Key must be in receipts/ and be a supported file extension" }, { status: 400 });
    }

    const [entry] = await db.select().from(timeEntries).where(and(eq(timeEntries.id, body.entryId), eq(timeEntries.workspaceId, session.workspaceId)));
    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    if (entry.userId !== session.sub && session.role === "member") {
      return NextResponse.json({ error: "Cannot add expense to another user's entry" }, { status: 403 });
    }

    const expense = {
      label: body.label,
      amount: amount,
      currency: (body.currency ?? "USD").toUpperCase(),
      r2Key: body.r2Key,
    };

    const newExpenses = [...entry.expenses, expense];

    await db.update(timeEntries).set({ expenses: newExpenses }).where(and(eq(timeEntries.id, entry.id), eq(timeEntries.workspaceId, session.workspaceId)));

    await appendAuditLog({
      workspaceId: session.workspaceId,
      timeEntryId: entry.id,
      actorUserId: session.sub,
      eventType: "expense_attached",
      diff: { expense: { before: null, after: expense } },
    });

    return NextResponse.json({ ok: true, entryId: entry.id, expenses: newExpenses });
  } catch (error) {
    const status = error instanceof UnauthorizedError ? 401 : error instanceof ForbiddenError ? 403 : 500;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
