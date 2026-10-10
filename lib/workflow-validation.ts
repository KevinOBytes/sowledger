import { NextResponse } from "next/server";

export class WorkflowError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export function workflowErrorResponse(error: unknown, fallback: string) {
  if (error instanceof WorkflowError) return NextResponse.json({ error: error.message }, { status: error.status });
  if ((error as { code?: string })?.code === "40001" || (error as { cause?: { code?: string } })?.cause?.code === "40001") return NextResponse.json({ error: "This record changed while you were reviewing it. Reload it and try again." }, { status: 409 });
  const status = (error as { status?: number; statusCode?: number })?.status ?? (error as { statusCode?: number })?.statusCode;
  if (status === 401 || status === 403) return NextResponse.json({ error: status === 401 ? "Please sign in again." : "Your workspace role cannot perform this action." }, { status });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "Send a valid JSON request." }, { status: 400 });
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export function entryIdsFrom(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100
    || value.some((id) => typeof id !== "string" || !id.trim() || id.length > 255)
    || new Set(value).size !== value.length) {
    throw new WorkflowError("Select between 1 and 100 different time entries.", 400);
  }
  return value as string[];
}

/** Preserve net time, including recorded breaks and deliberate daily-limit trims. */
export function editedTimeDuration(entry: { startedAt: Date; stoppedAt: Date; durationSeconds: number | null }, startedAt: Date, stoppedAt: Date) {
  const elapsed = Math.max(0, Math.floor((entry.stoppedAt.getTime() - entry.startedAt.getTime()) / 1000));
  const recorded = entry.durationSeconds ?? elapsed;
  if (!Number.isFinite(recorded) || recorded < 0 || recorded > elapsed) {
    throw new WorkflowError("This entry has an invalid duration. Ask a workspace manager to review it.", 409);
  }
  if (startedAt.getTime() === entry.startedAt.getTime() && stoppedAt.getTime() === entry.stoppedAt.getTime()) {
    return { durationSeconds: recorded, excludedSeconds: elapsed - recorded };
  }
  const nextElapsed = Math.floor((stoppedAt.getTime() - startedAt.getTime()) / 1000);
  const excludedSeconds = elapsed - recorded;
  if (nextElapsed < excludedSeconds) throw new WorkflowError("The new time range is shorter than this entry's recorded breaks. Choose a longer range.", 400);
  return { durationSeconds: nextElapsed - excludedSeconds, excludedSeconds };
}
