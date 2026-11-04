import { NextResponse } from "next/server";
import { DateInputError } from "@/lib/date-input";
import { savedDuration, storedDuration, SECOND_UNITS } from "@/lib/time-capacity";
import { UnauthorizedError, ForbiddenError, WorkspaceCapacityError } from "@/lib/auth";

export class WorkflowError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export function classifyWorkflowError(error: unknown, fallback: string) {
  if (error instanceof UnauthorizedError) return { status: 401, message: "Please sign in again.", unexpected: false };
  if (error instanceof ForbiddenError) return { status: 403, message: "Your workspace role cannot perform this action.", unexpected: false };
  if (error instanceof WorkspaceCapacityError) return { status: 402, message: "This workspace is at its member limit. Ask the workspace owner to choose a larger plan, then try the same invitation again.", unexpected: false };
  if (error instanceof WorkflowError) return [400, 402, 403, 404, 409, 422].includes(error.status)
    ? { status: error.status, message: error.message, unexpected: false }
    : { status: 500, message: fallback, unexpected: true };
  if (error instanceof DateInputError) return { status: 400, message: error.message, unexpected: false };
  if ((error as { code?: string })?.code === "40001" || (error as { cause?: { code?: string } })?.cause?.code === "40001") return { status: 409, message: "This record changed while you were reviewing it. Reload it and try again.", unexpected: false };
  return { status: 500, message: fallback, unexpected: true };
}

export type WorkflowDiagnosticContext = { route: "workflow" | `/api/${string}`; method: "GET" | "POST" | "PATCH" | "DELETE" | "UNSPECIFIED" };

/** Call only with code-owned route templates and literal handler methods. */
export function reportUnexpectedRequestFailure(context: WorkflowDiagnosticContext, category: "unexpected" | "upstream" = "unexpected") {
  try { console.error("sowledger_request_failed", { route: context.route, method: context.method, category }); } catch { /* Diagnostics cannot replace a response. */ }
}

export function workflowErrorResponse(error: unknown, fallback: string, context: WorkflowDiagnosticContext = { route: "workflow", method: "UNSPECIFIED" }) {
  const result = classifyWorkflowError(error, fallback);
  if (result.unexpected) reportUnexpectedRequestFailure(context);
  return NextResponse.json({ error: result.message }, { status: result.status });
}

export async function readRequestJson(request: Pick<Request, "json">) {
  try { return await request.json(); }
  catch (error) {
    if (error instanceof SyntaxError) throw new WorkflowError("Send a valid JSON request.", 400);
    throw error;
  }
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
export function editedTimeDuration(entry: { startedAt: Date; stoppedAt: Date; durationSeconds: number | null; accumulatedSeconds: number }, startedAt: Date, stoppedAt: Date) {
  const oldMs = entry.stoppedAt.getTime() - entry.startedAt.getTime();
  const newMs = stoppedAt.getTime() - startedAt.getTime();
  const invalid = () => new WorkflowError("This entry has invalid saved time data. Ask a workspace manager to review it.", 409);
  if (!Number.isSafeInteger(oldMs) || oldMs < 0) throw invalid();
  if (!Number.isSafeInteger(newMs) || newMs < 0) throw new WorkflowError("Choose a valid start and end time.", 400);
  const floor = Math.floor(oldMs / 1000);
  let recorded, pause;
  try { recorded = savedDuration(entry.durationSeconds ?? floor); pause = savedDuration(entry.accumulatedSeconds); } catch { throw invalid(); }
  if (recorded.units > BigInt(Math.ceil(oldMs / 1000)) * SECOND_UNITS) throw invalid();
  if (newMs === oldMs) return { durationSeconds: recorded.seconds, accumulatedSeconds: pause.seconds, adjustmentKind: "preserved" as const };
  const credited = recorded.units > BigInt(floor) * SECOND_UNITS;
  if (credited && (newMs <= 0 || (newMs - oldMs) % 1000 !== 0)) throw new WorkflowError("This entry includes a rounding allocation. Keep its duration unchanged or adjust it by whole seconds to preserve the recorded time.", 400);
  const delta = credited ? (newMs - oldMs) / 1000 : Math.floor(newMs / 1000) - floor;
  const targetUnits = recorded.units + BigInt(delta) * SECOND_UNITS;
  if (targetUnits < BigInt("0")) throw new WorkflowError("The new time range is shorter than this entry's recorded breaks. Choose a longer range.", 400);
  const precision = () => new WorkflowError("This edit cannot preserve the recorded duration at the supported precision. Choose a different duration.", 400);
  let candidate;
  try { candidate = storedDuration(recorded.seconds + delta); } catch { throw precision(); }
  if (candidate.units !== targetUnits || candidate.units > BigInt(Math.ceil(newMs / 1000)) * SECOND_UNITS) throw precision();
  let accumulatedSeconds = pause.seconds;
  if (!credited) {
    const excludedUnits = BigInt(floor) * SECOND_UNITS - recorded.units;
    const excluded = storedDuration(floor - recorded.seconds);
    if (excluded.units !== excludedUnits) throw precision();
    accumulatedSeconds = excluded.seconds;
  }
  return { durationSeconds: candidate.seconds, accumulatedSeconds, adjustmentKind: credited ? "rounding_credit_delta" as const : "floor_delta" as const };
}
