import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { NextRequest } from "next/server";
import * as schema from "../lib/db/schema";
import * as validators from "../lib/validators";
import * as workflow from "../lib/workflow-validation";
import { ForbiddenError, UnauthorizedError } from "../lib/auth";

type Handler = (req: NextRequest) => Promise<Response>;
type Row = Record<string, unknown>;
// The real handlers, validators, schema and predicates run. Only session/DB I/O
// is controlled; writes omit undefined exactly as Drizzle does.
function fixture(kind: "profile" | "clients", options: { role?: string; auth?: number; missing?: boolean; vanished?: boolean; fail?: boolean } = {}) {
  let row: Row = kind === "profile"
    ? { id: "own-user", email: "owner@example.com", displayName: "Kevin", timezone: "America/New_York", preferredTags: ["focus"], calendarPreferences: { visibleStartHour: 7, visibleEndHour: 19 }, passwordHash: "never-public", createdAt: "private" }
    : { id: "own-client", workspaceId: "own-workspace", name: "Acme", email: "billing@example.com", address: "123 Main", currencyOverride: "USD", status: "active" };
  const writes: Array<{ table: unknown; values: Row; predicate?: SQL }> = [];
  const predicates: SQL[] = [];
  const fakeDb = {
    select() { return { from() { return { async where(predicate: SQL) { predicates.push(predicate); if (options.fail) throw new Error("SQL secret params"); return options.missing ? [] : [row]; } }; } }; },
    update(table: unknown) { return { set(values: Row) { return { where(predicate: SQL) {
      writes.push({ table, values, predicate });
      if (options.fail) throw new Error("SQL secret params");
      if (!options.vanished && table !== schema.organizations) row = { ...row, ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) };
      return { async returning() { return options.vanished || options.missing ? [] : [row]; } };
    } }; } }; },
    insert(table: unknown) { return { values(values: Row) { writes.push({ table, values }); if (table === schema.clients) row = { ...row, ...values }; return { async returning() { return [row]; } }; } }; },
    async transaction<T>(fn: (tx: unknown) => Promise<T>) { return fn(fakeDb); },
  };
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const dependencies: Record<string, unknown> = {
    "@/lib/auth": { ForbiddenError, UnauthorizedError, requireSession: async () => { if (options.auth) throw options.auth === 401 ? new UnauthorizedError("Unauthorized") : new ForbiddenError("Forbidden"); return { sub: "own-user", workspaceId: "own-workspace", role: options.role ?? "owner" }; }, requireRole: (min: string, role: string) => { if (role === "client" || (min === "manager" && role === "member")) throw new ForbiddenError("Forbidden"); } },
    "@/lib/db": { db: fakeDb }, "@/lib/db/schema": schema,
    "@/lib/db/ensure-workspace-schema": { ensureWorkspaceSchema: async () => undefined },
    "@/lib/validators": validators, "@/lib/workflow-validation": workflow,
  };
  const fixtureModule = { exports: {} as Record<string, Handler> };
  for (const name of ["client-validation", "client-mutations"]) {
    const helper = { exports: {} };
    new Function("require", "module", "exports", transformSync(readFileSync(path.join(process.cwd(), `lib/${name}.ts`), "utf8"), { loader: "ts", format: "cjs" }).code)((id: string) => dependencies[id] ?? require(id), helper, helper.exports);
    dependencies[`@/lib/${name}`] = helper.exports;
  }
  const source = readFileSync(path.join(process.cwd(), kind === "profile" ? "app/api/user/settings/route.ts" : "app/api/clients/route.ts"), "utf8");
  new Function("require", "module", "exports", transformSync(source, { loader: "ts", format: "cjs" }).code)((id: string) => dependencies[id] ?? require(id), fixtureModule, fixtureModule.exports);
  return {
    writes, predicates,
    row: () => row,
    async call(body?: unknown, method = "PATCH", raw?: string) {
      return fixtureModule.exports[method](new NextRequest("https://fixture.test/api", { method, ...(method === "GET" ? {} : { headers: { "content-type": "application/json" }, body: raw ?? JSON.stringify(body) }) }));
    },
  };
}

test("profile explicit blank clears; omission preserves; PATCH exposes the same safe fields as GET", async () => {
  const f = fixture("profile");
  const before = await (await f.call(undefined, "GET")).json();
  const response = await f.call({ displayName: "  " });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.user.displayName, "");
  assert.deepEqual(Object.keys(data.user).sort(), Object.keys(before.user).sort());
  assert.equal(data.user.passwordHash, undefined);
  assert.deepEqual(data.user.calendarPreferences, { visibleStartHour: 7, visibleEndHour: 19 });
  await f.call({ timezone: "Europe/London" });
  assert.equal(f.row().displayName, "");
  assert.deepEqual(f.row().preferredTags, ["focus"]);
  assert.equal(f.row().timezone, "Europe/London");
  for (const predicate of [...f.predicates, ...f.writes.map(w => w.predicate).filter(Boolean)] as SQL[]) {
    const query = new PgDialect().sqlToQuery(predicate);
    assert.ok(query.sql.includes('"users"."id"'));
    assert.deepEqual(query.params, ["own-user"]);
  }
});

test("profile preserves tag normalization and numeric integer calendar-hour contract", async () => {
  const f = fixture("profile");
  assert.equal((await f.call({ displayName: "  Kevin  ", preferredTags: [" Focus ", "focus", "Client"], calendarPreferences: { visibleStartHour: 0, visibleEndHour: 24 } })).status, 200);
  assert.equal(f.row().displayName, "Kevin");
  assert.deepEqual(f.row().preferredTags, ["focus", "client"]);
  assert.deepEqual(f.row().calendarPreferences, { visibleStartHour: 0, visibleEndHour: 24 });
});

test("profile timezone requires an IANA name rather than a numeric offset accepted by modern Intl", async () => {
  const f = fixture("profile");
  assert.equal((await f.call({ timezone: "+01:00" })).status, 400);
  assert.equal(f.writes.length, 0);
});

for (const body of [null, [], {}, { unknown: 1 }, { displayName: null }, { displayName: 42 }, { displayName: "x".repeat(256) }, { timezone: "" }, { timezone: null }, { timezone: 7 }, { timezone: "Not/AZone" }, { timezone: "x".repeat(101) }, { preferredTags: "focus" }, { preferredTags: [1] }, { calendarPreferences: [] }, { calendarPreferences: { visibleStartHour: "7", visibleEndHour: "19" } }, { calendarPreferences: { visibleStartHour: 9.5, visibleEndHour: 19 } }, { calendarPreferences: { visibleStartHour: 19, visibleEndHour: 7 } }]) {
  test(`profile rejects invalid shape ${JSON.stringify(body)}`, async () => {
    const f = fixture("profile");
    const response = await f.call(body);
    assert.equal(response.status, 400);
    assert.equal(f.writes.length, 0);
    assert.ok((await response.json()).error);
  });
}

test("client omitted email preserves; explicit empty, whitespace and null clear SQL NULL", async () => {
  for (const email of ["", "  ", null]) {
    const f = fixture("clients");
    assert.equal((await f.call({ clientId: "own-client", email })).status, 200);
    assert.equal(f.row().email, null);
    assert.equal(f.writes[0].values.email, null);
  }
  const f = fixture("clients");
  await f.call({ clientId: "own-client", name: " Renamed " });
  assert.equal(f.row().email, "billing@example.com");
  assert.equal(f.row().name, "Renamed");
  assert.equal(f.writes[1].table, schema.organizations);
  assert.deepEqual(f.writes[1].values, { name: "Renamed" });
  for (const write of f.writes) {
    const query = new PgDialect().sqlToQuery(write.predicate!);
    assert.ok(query.params.includes("own-workspace"));
    assert.ok(query.params.includes("own-client"));
  }
});

test("client POST/PATCH canonicalize valid fields and preserve nullable optional fields", async () => {
  for (const method of ["POST", "PATCH"]) {
    const f = fixture("clients");
    const response = await f.call({ clientId: "own-client", name: " Acme ", email: " BILLING@EXAMPLE.COM ", address: null, currencyOverride: null }, method);
    assert.equal(response.status, 200);
    const { client } = await response.json();
    assert.equal(client.name, "Acme");
    assert.equal(client.email, "billing@example.com");
    assert.equal(client.address, null);
    assert.equal(client.currencyOverride, null);
  }
});

for (const body of [null, [], {}, { clientId: "" }, { clientId: 1 }, { clientId: "x".repeat(256), name: "Acme" }, { clientId: "own-client" }, ...[{ name: " " }, { name: 5 }, { name: null }, { name: "x".repeat(256) }, { email: 2 }, { email: "bad" }, { email: `${"x".repeat(250)}@example.com` }, { address: 3 }, { currencyOverride: 5 }, { currencyOverride: "x".repeat(11) }, { status: "deleted" }].map(fields => ({ clientId: "own-client", ...fields }))]) {
  test(`client PATCH rejects invalid shape ${JSON.stringify(body)}`, async () => {
    const f = fixture("clients");
    assert.equal((await f.call(body)).status, 400);
    assert.equal(f.writes.length, 0);
  });
}

for (const body of [null, [], {}, { name: " " }, { name: 1 }, { name: "x".repeat(256) }, { name: "Acme", email: 1 }, { name: "Acme", email: "invalid" }, { name: "Acme", address: [] }, { name: "Acme", currencyOverride: "x".repeat(11) }]) {
  test(`client POST rejects invalid shape ${JSON.stringify(body)}`, async () => {
    const f = fixture("clients");
    assert.equal((await f.call(body, "POST")).status, 400);
    assert.equal(f.writes.length, 0);
  });
}

for (const kind of ["profile", "clients"] as const) {
  test(`${kind} safely handles malformed JSON, missing/concurrently removed rows and unknown DB errors`, async () => {
    const body = kind === "profile" ? { displayName: "New" } : { clientId: "own-client", name: "New" };
    assert.equal((await fixture(kind).call(undefined, "PATCH", "{")).status, 400);
    for (const options of [{ missing: true }, { vanished: true }]) assert.equal((await fixture(kind, options).call(body)).status, 404);
    for (const method of ["GET", "PATCH"]) {
      const response = await fixture(kind, { fail: true }).call(body, method);
      assert.equal(response.status, 500);
      assert.doesNotMatch(await response.text(), /SQL|secret|params/);
    }
  });
  test(`${kind} retains session/role guards`, async () => {
    for (const auth of [401, 403]) assert.equal((await fixture(kind, { auth }).call({})).status, auth);
    assert.equal((await fixture(kind, { role: "client" }).call({})).status, 403);
    if (kind === "clients") assert.equal((await fixture(kind, { role: "member" }).call({})).status, 403);
  });
}
