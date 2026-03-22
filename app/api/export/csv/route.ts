import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { toCsv } from "@/lib/security";
import { db } from "@/lib/db";
import { timeEntries } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const entries = await db.select().from(timeEntries).where(eq(timeEntries.workspaceId, session.workspaceId));

    const rows = entries.map((entry) => ({
      id: entry.id,
      userId: entry.userId,
      taskId: entry.taskId,
      projectId: entry.projectId ?? "",
      goalId: entry.goalId ?? "",
      tags: entry.tags.join("|"),
      startedAtUtc: entry.startedAt.toISOString(),
      stoppedAtUtc: entry.stoppedAt ? entry.stoppedAt.toISOString() : "",
      durationSeconds: entry.durationSeconds ?? 0,
      status: entry.status,
      source: entry.source,
      expenses: JSON.stringify(entry.expenses),
    }));

    const csv = toCsv(rows);
    const digest = createHash("sha256").update(csv).digest("hex");
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=timely-${new Date().toISOString().slice(0, 10)}.csv`,
        "x-timely-export-sha256": digest,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 403 });
  }
}
