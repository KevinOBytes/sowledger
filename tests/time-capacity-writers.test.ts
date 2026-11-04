/* eslint-disable @typescript-eslint/no-explicit-any -- Inspect JSON/controlled imported module contracts. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { serialize } from "node:v8";
import { writerFixture, at } from "./helpers/time-capacity-fixtures";

const routes = { manual: "app/api/timer/manual/route.ts", edit: "app/api/timer/edit/route.ts", split: "app/api/timer/split/route.ts", stop: "app/api/timer/stop/route.ts", import: "app/api/integrations/calendar/import/route.ts", api: "app/api/v1/[resource]/route.ts" };
const range = { startedAt: at().toISOString(), stoppedAt: new Date(at().getTime() + 300000).toISOString() };
test("edit validates saved interval before requested dates/defaults and produces no side effects", async () => {
  for (const saved of [
    { startedAt: new Date(NaN), stoppedAt: at() },
    { startedAt: at(), stoppedAt: new Date(NaN) },
    { startedAt: new Date(NaN), stoppedAt: new Date(NaN) },
    { startedAt: new Date(at().getTime() + 1000), stoppedAt: at() },
  ]) for (const requested of [{}, { startedAt: range.startedAt }, { stoppedAt: range.stoppedAt }, { startedAt: "not-a-date", stoppedAt: "bad" }]) {
    const f = writerFixture(); f.entry({ ...saved }); const before = structuredClone(f.rows);
    const response = await f.request(routes.edit, { entryId: "entry", ...requested }, "PATCH");
    assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: "Saved time data is invalid. Ask a workspace manager to review it." });
    assert.deepEqual(serialize(f.rows), serialize(before)); assert.equal(f.callbacks.length, 0); assert.equal(f.rows.auditLogs.length, 0);
    assert.ok(!f.calls.some(value => value.endsWith(":capacity")));
  }
  const f = writerFixture(); f.entry(); const before = structuredClone(f.rows);
  const response = await f.request(routes.edit, { entryId: "entry", startedAt: "bad" }, "PATCH");
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: "Choose a valid start and end time." }); assert.deepEqual(f.rows, before); assert.equal(f.callbacks.length, 0);
  const running = writerFixture(); running.entry({ stoppedAt: null });
  const stopFirst = await running.request(routes.edit, { entryId: "entry" }, "PATCH");
  assert.equal(stopFirst.status, 409); assert.deepEqual(await stopFirst.json(), { error: "Stop the timer before editing its time." }); assert.equal(running.callbacks.length, 0); assert.equal(running.rows.auditLogs.length, 0);
});
function setup(writer: keyof typeof routes) {
  const f = writerFixture();
  let body: any = { ...range };
  let method = "POST";
  if (writer === "edit") { f.entry({ durationSeconds: 300, stoppedAt: new Date(at().getTime() + 300000) }); body = { entryId: "entry", stoppedAt: new Date(at().getTime() + 600000).toISOString() }; method = "PATCH"; }
  if (writer === "split") { f.entry({ startedAt: at("2026-10-01T23:55:00Z"), stoppedAt: at("2026-10-02T00:05:00Z"), durationSeconds: 600 }); body = { entryId: "entry", fractionSeconds: 300 }; }
  if (writer === "stop") { f.entry({ durationSeconds: null, stoppedAt: null }); body = { entryId: "entry", endedAt: range.stoppedAt }; }
  if (writer === "import") body = { events: [{ id: "provider-id", title: "Work", startsAt: range.startedAt, endsAt: range.stoppedAt }] };
  if (writer === "api") body.userId = "actor";
  return { f, body, send: () => f.request(routes[writer], body, method) };
}
for (const writer of Object.keys(routes) as Array<keyof typeof routes>) {
  test(`${writer}: holds owner capacity before reads/writes and keeps safe unknown failure atomic`, async () => {
    for (const fault of ["count", "period", "lock"]) {
      const { f, send } = setup(writer);
      const before = structuredClone(f.rows);
      f.fail(fault);
      const response = await send();
      assert.equal(response.status, 500, `${writer}/${fault}: ${await response.clone().text()}`);
      assert.doesNotMatch(await response.text(), /private|SQL|secret/);
      assert.deepEqual(f.rows, before);
      assert.equal(f.callbacks.length, 0);
      if (writer === "api") assert.deepEqual(f.usage, [500]);
      assert.equal(f.calls.filter(value => value.startsWith("transaction:"))[0], 'transaction:{"isolationLevel":"read committed"}');
    }
  });
  test(`${writer}: rejects/stop-trims an already-full destination`, async () => {
    const { f, send } = setup(writer);
    f.entry({ id: "full", durationSeconds: 86400 });
    const before = structuredClone(f.rows);
    const response = await send();
    assert.equal(response.status, writer === "stop" ? 200 : writer === "import" ? 409 : 400, await response.clone().text());
    if (writer === "stop") assert.equal((await response.json()).durationSeconds, 0);
    else { assert.deepEqual(f.rows, before); assert.equal(f.callbacks.length, 0); }
  });
  test(`${writer}: actual locked-period refusal has deliberate status and hides stored reasons`, async () => {
    const { f, send } = setup(writer);
    f.rows.lockPeriods.push({ workspaceId: "workspace", periodStart: new Date("2026-10-01Z"), periodEnd: new Date("2026-10-04Z"), reason: "private billing text" });
    const before = structuredClone(f.rows); const response = await send();
    assert.equal(response.status, writer === "stop" ? 403 : 409);
    assert.doesNotMatch(await response.text(), /private billing text/); assert.deepEqual(f.rows, before); assert.equal(f.callbacks.length, 0);
  });
}
test("edit rechecks actor membership and fresh recorded owner after waiting", async () => {
  for (const change of ["owner", "revoked", "demoted"]) {
    const { f, send } = setup("edit");
    f.rows.timeEntries[0].userId = "former-staff";
    if (change === "owner") f.onEntryLock(() => { f.rows.timeEntries[0].userId = "other"; });
    else if (change === "revoked") f.rows.memberships = [];
    else f.rows.memberships[0].role = "member";
    const response = await send();
    assert.equal(response.status, change === "owner" ? 409 : 403, await response.clone().text());
    assert.equal(f.callbacks.length, 0);
  }
});
test("split refuses independently rounded decimal children, conserves quarters", async () => {
  for (const fraction of [0.2, 0.1, 0.25]) {
    const f = writerFixture(); f.entry(); const before = structuredClone(f.rows);
    const response = await f.request(routes.split, { entryId: "entry", fractionSeconds: fraction });
    assert.equal(response.status, fraction === 0.25 ? 200 : 400);
    if (fraction !== 0.25) { assert.deepEqual(f.rows, before); assert.equal(f.callbacks.length, 0); }
    else assert.deepEqual(f.rows.timeEntries.map(row => row.durationSeconds), [0.75, 0.25]);
  }
});
test("edit preserves literal Task5a allocations/geometry/pause and materialized null consumes capacity", async () => {
  for (const shift of [0, 123, 86400000]) {
    const f = writerFixture(); f.entry({ stoppedAt: new Date(at().getTime() + 1900), durationSeconds: 2, accumulatedSeconds: 0.25 });
    const response = await f.request(routes.edit, { entryId: "entry", startedAt: new Date(at().getTime() + shift).toISOString(), stoppedAt: new Date(at().getTime() + shift + 1900).toISOString() }, "PATCH");
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).nextDurationSeconds, 2);
    assert.equal(f.rows.timeEntries[0].accumulatedSeconds, 0.25);
    assert.equal(f.rows.auditLogs[0].diff.durationSeconds.after, 2);
  }
  const f = writerFixture(); f.entry({ durationSeconds: null }); f.entry({ id: "full", durationSeconds: 86400 });
  assert.equal((await f.request(routes.edit, { entryId: "entry", description: "notes" }, "PATCH")).status, 400);
});
test("edit canonical saved decimals are returned and audited without false storage changes", async () => {
  const f = writerFixture(); f.entry({ durationSeconds: 0.2, accumulatedSeconds: 0.1 });
  const response = await f.request(routes.edit, { entryId: "entry", description: "Notes only" }, "PATCH");
  assert.equal(response.status, 200); assert.equal((await response.json()).nextDurationSeconds, 0.20000000298023224);
  assert.equal(f.rows.auditLogs[0].diff.durationSeconds.before, 0.20000000298023224);
  assert.equal(f.rows.auditLogs[0].diff.durationSeconds.after, 0.20000000298023224);
  assert.equal(f.rows.auditLogs[0].diff.accumulatedSeconds.after, 0.10000000149011612);
  const before = structuredClone(f.rows);
  assert.equal((await f.request(routes.edit, { entryId: "entry", stoppedAt: new Date(at().getTime() + 2000).toISOString() }, "PATCH")).status, 400);
  assert.deepEqual(f.rows, before); assert.equal(f.callbacks.length, 1);
});
test("edit/split discover owner once, wait on that key, then membership before locked entry", async () => {
  for (const writer of ["edit", "split"] as const) {
    const { f, send } = setup(writer); f.rows.timeEntries[0].userId = "historical";
    let release!: () => void; f.hold(new Promise<void>(resolve => { release = resolve; }));
    const pending = send();
    for (let index = 0; index < 15 && !f.calls.some(value => value.startsWith("lock:")); index++) await Promise.resolve();
    assert.ok(f.calls.some(value => value.startsWith("lock:")));
    assert.ok(!f.calls.some(value => value.startsWith("tx:")));
    const expectedKey = f.load("lib/time-capacity.ts").capacityLockKey({ workspaceId: "workspace", userId: "historical" });
    assert.ok(f.calls.includes(`lock:${expectedKey.toString()}`));
    release(); const response = await pending; assert.equal(response.status, 200);
    assert.ok(f.calls.indexOf("tx:memberships:share") < f.calls.indexOf("tx:timeEntries:update"));
    assert.equal(f.calls.filter(value => value === "db:timeEntries:read").length, 1);
  }
});
test("edit/split fresh status, missing/foreign entry and geometry checks never mutate", async () => {
  for (const writer of ["edit", "split"] as const) for (const change of ["approved", "foreign", "missing", "owner"]) {
    const { f, send } = setup(writer);
    if (change === "approved") f.onEntryLock(() => { f.rows.timeEntries[0].status = "approved"; });
    if (change === "owner") f.onEntryLock(() => { f.rows.timeEntries[0].userId = "other"; });
    if (change === "foreign") f.rows.timeEntries[0].workspaceId = "foreign";
    if (change === "missing") f.rows.timeEntries = [];
    assert.equal((await send()).status, change === "approved" || change === "owner" ? 409 : 404);
    assert.equal(f.callbacks.length, 0); assert.equal(f.rows.auditLogs.length, 0);
  }
  const f = writerFixture(); f.entry({ stoppedAt: new Date(at().getTime() + 1) }); const before = structuredClone(f.rows);
  assert.equal((await f.request(routes.split, { entryId: "entry", fractionSeconds: 0.0001 })).status, 400);
  assert.deepEqual(f.rows, before);
});
test("public create rejects25h but preserves unsplit start-date attribution and API usage", async () => {
  const f = writerFixture();
  const long = await f.request(routes.api, { userId: "actor", startedAt: "2026-10-01T00:00:00Z", stoppedAt: "2026-10-02T01:00:00Z" });
  assert.equal(long.status, 400); assert.equal(f.rows.timeEntries.length, 0);
  f.entry({ id: "destination-full", startedAt: at("2026-10-02T12:00:00Z"), durationSeconds: 86400 });
  const overnight = await f.request(routes.api, { userId: "actor", startedAt: "2026-10-01T23:00:00Z", stoppedAt: "2026-10-02T01:00:00Z" });
  assert.equal(overnight.status, 201); assert.equal(f.rows.timeEntries.length, 2);
  assert.equal((await overnight.json()).entry.durationSeconds, 7200); assert.deepEqual(f.usage, [400, 201]);
});
test("import skips an existing geometric suffix before new period/cap validation and rolls back later batch errors", async () => {
  const f = writerFixture();
  const events = [{ id: "fractional", title: "Boundary", startsAt: "2026-10-01T23:59:59.500Z", endsAt: "2026-10-02T00:00:00.500Z" }];
  assert.equal((await f.request(routes.import, { events })).status, 200);
  assert.match(f.rows.timeEntries[0].id, /-1$/);
  f.rows.lockPeriods.push({ workspaceId: "workspace", periodStart: new Date("2026-10-01Z"), periodEnd: new Date("2026-10-03Z") });
  const before = structuredClone(f.rows);
  const replay = await f.request(routes.import, { events }); assert.equal(replay.status, 200); assert.equal((await replay.json()).skipped, 1); assert.deepEqual(f.rows, before);
  const batch = writerFixture();
  const response = await batch.request(routes.import, { events: [
    { id: "first", title: "First", startsAt: "2026-10-02T00:00:00Z", endsAt: "2026-10-02T20:00:00Z" },
    { id: "second", title: "Overfull", startsAt: "2026-10-02T08:00:00Z", endsAt: "2026-10-02T13:00:00Z" },
  ] });
  assert.equal(response.status, 409); assert.equal(batch.rows.timeEntries.length, 0);
});
test("split second-write/audit failure restores parent and audit trail before successful retry", async () => {
  for (const fault of ["second-entry", "audit"]) {
    const f = writerFixture(); f.entry(); const before = structuredClone(f.rows); f.fail(fault);
    assert.equal((await f.request(routes.split, { entryId: "entry", fractionSeconds: 0.25 })).status, 500);
    assert.deepEqual(f.rows, before); assert.equal(f.callbacks.length, 0);
    f.fail(""); assert.equal((await f.request(routes.split, { entryId: "entry", fractionSeconds: 0.25 })).status, 200);
    assert.deepEqual(f.rows.timeEntries.map(row => row.durationSeconds), [0.75, 0.25]);
  }
});
