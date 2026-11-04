import { readRequestJson, workflowErrorResponse, WorkflowError } from "@/lib/workflow-validation";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requireRole, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { onboardingProgress } from "@/lib/db/schema";

const SETUP_STEPS = ["workspace", "project", "schedule", "track", "log", "review", "output", "invite", "integrate"] as const;
type SetupStep = (typeof SETUP_STEPS)[number];

function progressId(workspaceId: string, userId: string) {
  return `${workspaceId}:${userId}`;
}

function normalizeSteps(value: unknown): SetupStep[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(SETUP_STEPS);
  return [...new Set(value.filter((step): step is SetupStep => typeof step === "string" && allowed.has(step)))];
}

function serializeProgress(row: typeof onboardingProgress.$inferSelect | null) {
  return {
    completedSteps: normalizeSteps(row?.completedSteps ?? []),
    skippedAt: row?.skippedAt?.toISOString() ?? null,
    completedAt: row?.completedAt?.toISOString() ?? null,
  };
}

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await ensureWorkspaceSchema();

    const [progress] = await db
      .select()
      .from(onboardingProgress)
      .where(and(eq(onboardingProgress.workspaceId, session.workspaceId), eq(onboardingProgress.userId, session.sub)));

    return NextResponse.json({ ok: true, onboarding: serializeProgress(progress ?? null) });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't load your setup progress. Please try again.", { route: "/api/onboarding", method: "GET" });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);
    await ensureWorkspaceSchema();

    const body = await readRequestJson(req) as {
      completedSteps?: unknown;
      step?: unknown;
      skipped?: boolean;
      completed?: boolean;
      reset?: boolean;
    };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);
    const id = progressId(session.workspaceId, session.sub);
    const now = new Date();

    const [existing] = await db
      .select()
      .from(onboardingProgress)
      .where(and(eq(onboardingProgress.workspaceId, session.workspaceId), eq(onboardingProgress.userId, session.sub)));

    let completedSteps = body.completedSteps !== undefined
      ? normalizeSteps(body.completedSteps)
      : normalizeSteps(existing?.completedSteps ?? []);
    const singleStep = normalizeSteps([body.step]);
    if (singleStep.length) completedSteps = normalizeSteps([...completedSteps, ...singleStep]);
    if (body.reset) completedSteps = [];

    const values = {
      id,
      workspaceId: session.workspaceId,
      userId: session.sub,
      completedSteps,
      skippedAt: body.reset ? null : body.skipped ? now : body.skipped === false ? null : existing?.skippedAt ?? null,
      completedAt: body.reset ? null : body.completed ? now : body.completed === false ? null : existing?.completedAt ?? null,
      updatedAt: now,
    };

    const [progress] = existing
      ? await db
        .update(onboardingProgress)
        .set(values)
        .where(and(eq(onboardingProgress.workspaceId, session.workspaceId), eq(onboardingProgress.userId, session.sub)))
        .returning()
      : await db
        .insert(onboardingProgress)
        .values({ ...values, createdAt: now })
        .returning();

    return NextResponse.json({ ok: true, onboarding: serializeProgress(progress ?? null) });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't confirm your setup progress was saved. Check your setup progress before trying again.", { route: "/api/onboarding", method: "PATCH" });
  }
}
