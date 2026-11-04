const authErrors = { UnauthorizedError: class extends Error {}, ForbiddenError: class extends Error {}, WorkspaceCapacityError: class extends Error {} };
/* eslint-disable @typescript-eslint/no-explicit-any -- Imported actual modules are evaluated with controlled external boundaries. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";
import { writerFixture } from "./helpers/time-capacity-fixtures";

const native = createRequire(import.meta.url);
function load(file: string, dependencies: Record<string, unknown> = {}): Record<string, any> {
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", code)((key: string) => {
    if (key in dependencies) return dependencies[key];
    if (key === "@/lib/auth") return authErrors;
    if (key === "@/lib/db") return { db: {} };
    if (key === "next/server") return { NextResponse: { json: Response.json } };
    if (key === "@/lib/date-input") return { DateInputError: class extends Error {} };
    if (key === "@/lib/time-capacity") return load("lib/time-capacity.ts");
    if (key === "@/lib/db/schema") return { timeEntries: {} };
    return native(key);
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const workflow = load("lib/workflow-validation.ts");
const start = new Date("2026-10-02T00:00:00.000Z");
const shifted = (ms: number) => new Date(start.getTime() + ms);
const row = (ms: number, durationSeconds: number | null, accumulatedSeconds = 0) => ({ startedAt: start, stoppedAt: shifted(ms), durationSeconds, accumulatedSeconds });

for (const [ms, seconds] of [[1900, 2], [500, 1], [1900, 1.5]]) {
  test(`saved rounding allocation ${ms}ms/${seconds}s survives metadata and equal-length date/phase moves`, () => {
    for (const shift of [0, 123, 86400000]) {
      const result = workflow.editedTimeDuration(row(ms, seconds, 0.25), shifted(shift), shifted(ms + shift));
      assert.equal(result.durationSeconds, seconds);
      assert.equal(result.accumulatedSeconds, 0.25);
    }
  });
  test(`saved rounding allocation ${ms}ms/${seconds}s carries exact whole-second deltas`, () => {
    assert.equal(workflow.editedTimeDuration(row(ms, seconds), start, shifted(ms + 1000)).durationSeconds, seconds + 1);
    if (ms > 1000) assert.equal(workflow.editedTimeDuration(row(ms, seconds), start, shifted(ms - 1000)).durationSeconds, seconds - 1);
    for (const length of [0, 1000, 1800, 2000, 2100]) if ((length - ms) % 1000 !== 0) {
      assert.throws(() => workflow.editedTimeDuration(row(ms, seconds), start, shifted(length)), (e: any) => e.status === 400 && /rounding allocation/.test(e.message));
    }
  });
}
test("ordinary edits preserve floor/exclusions, zero and stopped-null fallback", () => {
  for (const length of [3100, 3200]) assert.equal(workflow.editedTimeDuration(row(2100, 2), start, shifted(length)).durationSeconds, 3);
  assert.deepEqual(workflow.editedTimeDuration(row(3600900, 3000, 12), start, shifted(4200100)), { durationSeconds: 3600, accumulatedSeconds: 600, adjustmentKind: "floor_delta" });
  assert.equal(workflow.editedTimeDuration(row(3600000, 3000), start, shifted(600000)).durationSeconds, 0);
  assert.throws(() => workflow.editedTimeDuration(row(3600000, 3000), start, shifted(599000)), (e: any) => e.status === 400);
  for (const [ms, want] of [[0, 0], [500, 0], [1500, 1]]) assert.equal(workflow.editedTimeDuration(row(0, 0), start, shifted(ms)).durationSeconds, want);
  assert.equal(workflow.editedTimeDuration(row(3600000, null), start, shifted(3600000)).durationSeconds, 3600);
});
test("invalid saved data fails409; changed storage that loses the integer delta fails400", () => {
  for (const saved of [row(0, 1), row(1900, 3), row(1000, NaN), row(1000, -1), row(1000, 1, Infinity), row(1000, 1, -1)]) {
    assert.throws(() => workflow.editedTimeDuration(saved, saved.startedAt, saved.stoppedAt), (e: any) => e.status === 409);
  }
  assert.equal(workflow.editedTimeDuration(row(1000, 0.2), shifted(123), shifted(1123)).durationSeconds, 0.20000000298023224);
  assert.throws(() => workflow.editedTimeDuration(row(1000, 0.2), start, shifted(2000)), (e: any) => e.status === 400 && /precision/.test(e.message));
  // Same floor delta, but inferred exclusion0.8 is not the exact complement
  // of stored real0.2; do not silently change the pause field while writing it.
  assert.throws(() => workflow.editedTimeDuration(row(1000, 0.2), start, shifted(1100)), (e: any) => e.status === 400 && /precision/.test(e.message));
});

test("exact float32 values and namespaced signed key are stable; invalid numbers refuse", () => {
  const cap = load("lib/time-capacity.ts");
  assert.equal(cap.capacityLockKey({ workspaceId: "workspace", userId: "user" }), BigInt("-7397201993736930893"));
  assert.equal(cap.storedDuration(0.2).seconds, 0.20000000298023224);
  assert.equal(cap.storedDuration(2 ** -149).units, BigInt("1"));
  assert.equal(cap.storedDuration(1).units, BigInt("1") << BigInt("149"));
  for (const n of [NaN, Infinity, -1, 2 ** -150, 1e40]) assert.throws(() => cap.storedDuration(n));
});
test("capacity body cannot run before awaited lock and explicit Read Committed transaction", async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = [];
  const tx = { execute: async (query: unknown) => {
    const rendered = new (native("drizzle-orm/pg-core").PgDialect)().sqlToQuery(query);
    assert.equal(rendered.sql, "select pg_advisory_xact_lock($1::bigint)");
    assert.deepEqual(rendered.params, ["-7397201993736930893"]);
    calls.push("lock"); await pending;
  } };
  const cap = load("lib/time-capacity.ts", { "@/lib/db": { db: { transaction: async (body: any, config: unknown) => {
    assert.deepEqual(config, { isolationLevel: "read committed" });
    return body(tx);
  } } } });
  const result = cap.withTimeCapacity({ workspaceId: "workspace", userId: "user" }, async (context: any) => { assert.equal(context.tx, tx); calls.push("body"); return 7; });
  await Promise.resolve();
  assert.deepEqual(calls, ["lock"]);
  release();
  assert.equal(await result, 7);
  assert.deepEqual(calls, ["lock", "body"]);
});

test("exact replacement admits overfull nonincrease but never a destination increase or double subtraction", async () => {
  const f = writerFixture(), cap = f.load("lib/time-capacity.ts");
  const parent = f.entry({ durationSeconds: 90000 });
  const identity = { workspaceId: "workspace", userId: "actor" };
  for (const next of [90000, 89999]) await cap.withTimeCapacity(identity, (context: any) => cap.assertBucketReplacement(context, { before: [parent], after: [{ ...parent, durationSeconds: next }] }));
  await assert.rejects(cap.withTimeCapacity(identity, (context: any) => cap.assertBucketReplacement(context, { before: [parent], after: [{ ...parent, durationSeconds: 90001 }] })), cap.TimeCapacityError);
  const target = shifted(86400000); f.entry({ id: "destination", startedAt: target, durationSeconds: 86400 });
  await assert.rejects(cap.withTimeCapacity(identity, (context: any) => cap.assertBucketReplacement(context, { before: [parent], after: [{ ...parent, startedAt: target, durationSeconds: 1 }] })), cap.TimeCapacityError);
  await assert.rejects(cap.withTimeCapacity(identity, (context: any) => cap.assertBucketReplacement(context, { before: [{ ...parent, userId: "foreign" }], after: [] })), cap.TimeDataError);
});
test("individual fractional rows cannot disappear into a rounded real total; bad saved values fail closed", async () => {
  const f = writerFixture(), cap = f.load("lib/time-capacity.ts");
  f.entry({ durationSeconds: 86400 });
  for (let index = 0; index < 128; index++) f.entry({ id: `tiny-${index}`, durationSeconds: 2 ** -149 });
  const identity = { workspaceId: "workspace", userId: "actor" };
  const total = await cap.withTimeCapacity(identity, (context: any) => cap.readBucketTotals(context, [start]));
  assert.equal(total.get("2026-10-02"), BigInt(86400) * (BigInt(1) << BigInt(149)) + BigInt(128));
  await assert.rejects(cap.withTimeCapacity(identity, (context: any) => cap.assertBucketReplacement(context, { before: [], after: [{ id: "new", ...identity, startedAt: start, durationSeconds: 2 ** -149 }] })), cap.TimeCapacityError);
  for (const invalid of [NaN, Infinity, -0.25]) {
    f.rows.timeEntries[1].durationSeconds = invalid;
    await assert.rejects(cap.withTimeCapacity(identity, (context: any) => cap.readBucketTotals(context, [start])), cap.TimeDataError);
  }
});
test("UTC bucket dates preserve years0-99 and extended signed years", async () => {
  for (const date of ["0012-01-02T12:00:00Z", "0099-12-31T12:00:00Z", "+010000-01-01T12:00:00Z", "-000001-01-01T12:00:00Z"]) {
    const f = writerFixture(), cap = f.load("lib/time-capacity.ts");
    f.entry({ startedAt: new Date(date), durationSeconds: 1 });
    const totals = await cap.withTimeCapacity({ workspaceId: "workspace", userId: "actor" }, (context: any) => cap.readBucketTotals(context, [new Date(date)]));
    assert.equal(totals.get(new Date(date).toISOString().split("T")[0]), BigInt(1) << BigInt(149));
  }
});
test("stop uses exact floor capacity and canonical fitting does not invent a capacity trim", async () => {
  for (const [used, desired, want, trim] of [[86399.5, 1, 0, 1], [86399.5, 0.25, 0, 0.25], [86398.5, 0.25, 0.25, 0], [0, 0.2, 0.20000000298023224, 0]]) {
    const f = writerFixture(), cap = f.load("lib/time-capacity.ts");
    const original = f.entry({ durationSeconds: null }); f.entry({ id: "prior", durationSeconds: used });
    const result = await cap.withTimeCapacity({ workspaceId: "workspace", userId: "actor" }, (context: any) => cap.fitStoppedSegments(context, { originalEntry: original, segments: [{ startedAt: start, stoppedAt: shifted(1000), durationSeconds: desired }] }));
    assert.equal(result.segments[0]?.durationSeconds ?? 0, want); assert.equal(result.trimmedSeconds, trim);
  }
});
test("repeated credited whole-second and date edits return exactly to saved values", () => {
  let saved = row(1900, 1.5, 0.25);
  for (let index = 0; index < 20; index++) {
    const longer = workflow.editedTimeDuration(saved, start, shifted(2900));
    const back = workflow.editedTimeDuration({ ...saved, ...longer, stoppedAt: shifted(2900) }, start, shifted(1900));
    saved = { ...saved, ...back };
  }
  assert.equal(saved.durationSeconds, 1.5); assert.equal(saved.accumulatedSeconds, 0.25);
  const moved = workflow.editedTimeDuration(saved, shifted(86400000), shifted(86401900));
  const reversed = workflow.editedTimeDuration({ ...saved, ...moved, startedAt: shifted(86400000), stoppedAt: shifted(86401900) }, start, shifted(1900));
  assert.equal(reversed.durationSeconds, 1.5); assert.equal(reversed.accumulatedSeconds, 0.25);
});
