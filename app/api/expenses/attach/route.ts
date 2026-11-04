import { readRequestJson, workflowErrorResponse, WorkflowError } from "@/lib/workflow-validation";
import { NextRequest, NextResponse, after } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { appendAuditLog, dispatchWebhook, ensurePeriodUnlocked, PeriodLockedError } from "@/lib/security";
import { db } from "@/lib/db";
import { memberships, timeEntries } from "@/lib/db/schema";
import { lockInvoiceLifecycle } from "@/lib/invoice-lifecycle";
import { and, eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const body = await readRequestJson(req) as {
      entryId?: string;
      label?: string;
      amount?: number;
      currency?: string;
      r2Key?: string;
    };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);

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

    const entryId = body.entryId;
    const expense = {
      label: body.label,
      amount: amount,
      currency: (body.currency ?? "USD").toUpperCase(),
      r2Key: body.r2Key,
    };

    const result = await db.transaction(async tx => {
      // Match invoice creation/void/export ordering before taking any row lock.
      await lockInvoiceLifecycle(tx, session.workspaceId);
      const [actor] = await tx.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.workspaceId, session.workspaceId), eq(memberships.userId, session.sub))).for("share");
      if (!actor || !["member", "manager", "owner"].includes(actor.role)) throw new WorkflowError("Your workspace membership cannot attach expenses.", 403);
      const [entry] = await tx.select().from(timeEntries).where(and(eq(timeEntries.id, entryId), eq(timeEntries.workspaceId, session.workspaceId))).for("update");
      if (!entry) throw new WorkflowError("Entry not found", 404);
      if (entry.userId !== session.sub && actor.role === "member") throw new WorkflowError("Cannot add expense to another user's entry", 403);
      if (entry.status === "approved" || entry.status === "invoiced") throw new WorkflowError("Approved or invoiced entries are locked.", 409);
      await ensurePeriodUnlocked(session.workspaceId, entry.startedAt, entry.stoppedAt ?? new Date(), tx);

      const withdrawSubmission = entry.status === "submitted";
      const [saved] = await tx.update(timeEntries).set({ expenses: [...entry.expenses, expense], ...(withdrawSubmission ? { status: "draft" as const } : {}) }).where(and(eq(timeEntries.id, entry.id), eq(timeEntries.workspaceId, session.workspaceId))).returning({ id: timeEntries.id, expenses: timeEntries.expenses });
      if (!saved) throw new WorkflowError("This entry changed. Reload it before attaching the expense.", 409);
      const diff: Record<string, { before: unknown; after: unknown }> = { expense: { before: null, after: expense } };
      if (withdrawSubmission) diff.status = { before: "submitted", after: "draft" };
      await appendAuditLog({ workspaceId: session.workspaceId, timeEntryId: entry.id, actorUserId: session.sub, eventType: "expense_attached", diff }, tx);
      return { entryId: saved.id, expenses: saved.expenses, diff };
    }, { isolationLevel: "read committed" });
    after(async () => { await dispatchWebhook(session.workspaceId, "expense_attached", result.diff); });
    return NextResponse.json({ ok: true, entryId: result.entryId, expenses: result.expenses });
  } catch (error) {
    if (error instanceof PeriodLockedError) return NextResponse.json({ error: error.message }, { status: 409 });
    return workflowErrorResponse(error, "We couldn't confirm the expense was attached. Check the time entry before trying again.", { route: "/api/expenses/attach", method: "POST" });
  }
}
