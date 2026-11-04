import { expect, test, type APIRequestContext } from "@playwright/test";
import { createHash } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db, getDb } from "../lib/db";
import * as s from "../lib/db/schema";
import { createInvoiceFromSelection } from "../lib/invoice-selection";
import { voidDraftInvoice, reserveInvoiceNotificationExposure, lockInvoiceLifecycle, exposeInvoice, verifiedReleasedInvoiceIds } from "../lib/invoice-lifecycle";
import { buildRevenueIntelligence } from "../lib/revenue-intelligence";
import { createExportResponse, loadExportData } from "../lib/export-data";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import { NextRequest } from "next/server";
import { holdFinancialDatabaseLock, waitForFinancialDatabaseWaiters } from "./helpers/financial-db-barrier";

// Fault injection AFTER actual PostgreSQL writes, never an in-memory transaction.
async function failAfterWrite(number: number, run: () => Promise<unknown>, handledByRoute = false) {
  const actual = getDb(); let writes = 0;
  const wrap = (builder: object): object => new Proxy(builder, { get(target, key) {
    const value = Reflect.get(target, key);
    if (key === "then") return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => value.call(target, (rows: unknown) => {
      if (++writes === number) throw new Error(`Injected failure after real write ${number}`);
      return rows;
    }).then(resolve, reject);
    return typeof value === "function" ? (...args: unknown[]) => { const result = value.apply(target, args); return result && typeof result === "object" ? wrap(result) : result; } : value;
  } });
  globalThis.__sowledgerDbClient = new Proxy(actual, { get(target, key) {
    if (key === "transaction") return (fn: (tx: unknown) => Promise<unknown>, config: Parameters<typeof actual.transaction>[1]) => actual.transaction(tx => fn(new Proxy(tx, { get(inner, method) {
      const value = Reflect.get(inner, method);
      if (method === "insert" || method === "update") return (...args: unknown[]) => wrap(value.apply(inner, args));
      return typeof value === "function" ? value.bind(inner) : value;
    } })), config);
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  try {
    if (handledByRoute) await run();
    else await expect(run()).rejects.toThrow(`Injected failure after real write ${number}`);
    expect(writes).toBe(number);
  }
  finally { globalThis.__sowledgerDbClient = actual; }
}

test.describe("safe invoice lifecycle: disposable database only", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Controller-owned disposable DB required");
  test.setTimeout(60_000);
  const workspaces = new Set<string>(), users = new Set<string>();
  test.afterEach(async () => {
    for (const workspaceId of workspaces) await db.delete(s.workspaces).where(eq(s.workspaces.id, workspaceId));
    for (const userId of users) await db.delete(s.users).where(eq(s.users.id, userId));
    workspaces.clear(); users.clear();
  });
  async function login(request: APIRequestContext, workspace = `lifecycle-${crypto.randomUUID()}`, role = "owner") {
    const response = await request.get(`/api/test/login?${new URLSearchParams({ workspace, role, plan: "smb", email: `${role}-${crypto.randomUUID()}@example.com` })}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    const owner = await response.json() as { workspaceId: string; userId: string };
    workspaces.add(owner.workspaceId); users.add(owner.userId); return { ...owner, workspace };
  }
  async function seed(request: APIRequestContext) {
    const owner = await login(request), id = crypto.randomUUID();
    await db.insert(s.timeEntries).values({ id, workspaceId: owner.workspaceId, userId: owner.userId, taskId: "Draft correction", startedAt: new Date("2026-10-31T10:00:00Z"), stoppedAt: new Date("2026-10-31T11:00:00Z"), durationSeconds: 3600, hourlyRate: 125, status: "approved", source: "manual" });
    const invoice = await createInvoiceFromSelection({ workspaceId: owner.workspaceId, actorUserId: owner.userId, ids: [id], dueDate: null });
    return { ...owner, entryId: id, invoice };
  }
  async function snapshot(workspaceId: string) {
    return { invoices: await db.select().from(s.invoices).where(eq(s.invoices.workspaceId, workspaceId)).orderBy(s.invoices.id), entries: await db.select().from(s.timeEntries).where(eq(s.timeEntries.workspaceId, workspaceId)).orderBy(s.timeEntries.id), lifecycle: await db.select().from(s.invoiceLifecycle).where(eq(s.invoiceLifecycle.workspaceId, workspaceId)).orderBy(s.invoiceLifecycle.invoiceId), audits: await db.select().from(s.auditLogs).where(eq(s.auditLogs.workspaceId, workspaceId)).orderBy(s.auditLogs.id) };
  }
  const release = (x: Awaited<ReturnType<typeof seed>>) => voidDraftInvoice({ workspaceId: x.workspaceId, invoiceId: x.invoice.id, actorUserId: x.userId, reason: "Incorrect selection" });
  const post = (request: APIRequestContext, invoiceId: string, body: unknown = { confirmNotBilledElsewhere: true }) => request.post(`/api/invoices/${invoiceId}/void`, { data: body });

  async function timeReadKey(request: APIRequestContext, scopes = ["read:time"]) {
    const response = await request.post("/api/settings/api-keys", { data: { name: "Time-read exposure test", scopes } });
    expect(response.ok()).toBe(true);
    const { rawKey } = await response.json(); return { authorization: `Bearer ${rawKey}` };
  }

  test("I1 public time-read records exposure before invoiced time leaves and then refuses void", async ({ request }) => {
    const x = await seed(request), headers = await timeReadKey(request);
    const response = await request.get("/api/v1/time-entries?status=invoiced", { headers });
    expect(response.status()).toBe(200);
    const body = await response.json(); expect(body.entries.map((row: { id: string }) => row.id)).toEqual([x.entryId]);
    const saved = await snapshot(x.workspaceId);
    expect(saved.lifecycle[0].exposedAt).not.toBeNull();
    expect(saved.audits.filter(row => row.eventType === "time_financial_exported").map(row => row.timeEntryId)).toEqual([x.entryId]);
    expect((await post(request, x.invoice.id)).status()).toBe(409); expect(await snapshot(x.workspaceId)).toEqual(saved);
  });

  test("I1 public time-read remembers approved time exposure before later invoice creation", async ({ request }) => {
    const x = await seed(request); await release(x); const headers = await timeReadKey(request);
    const response = await request.get("/api/v1/time-entries?status=approved", { headers });
    expect(response.status()).toBe(200); expect((await response.json()).entries.map((row: { id: string }) => row.id)).toEqual([x.entryId]);
    const next = await createInvoiceFromSelection({ workspaceId: x.workspaceId, actorUserId: x.userId, ids: [x.entryId], dueDate: null });
    const saved = await snapshot(x.workspaceId);
    expect(saved.lifecycle.find(row => row.invoiceId === next.id)?.exposedAt).not.toBeNull();
    expect((await post(request, next.id)).status()).toBe(409); expect(await snapshot(x.workspaceId)).toEqual(saved);
  });

  test("I1 public time-read filters expose only returned time and leave unrelated draft safely releasable", async ({ request }) => {
    const x = await seed(request), projectId = crypto.randomUUID(), entryId = crypto.randomUUID();
    await db.insert(s.projects).values({ id: projectId, workspaceId: x.workspaceId, name: "Filtered API time" });
    await db.insert(s.timeEntries).values({ id: entryId, workspaceId: x.workspaceId, userId: x.userId, projectId, taskId: "Selected financial detail", startedAt: new Date("2026-10-31T12:00:00Z"), stoppedAt: new Date("2026-10-31T13:00:00Z"), durationSeconds: 3600, hourlyRate: 25, status: "approved", source: "manual" });
    const selected = await createInvoiceFromSelection({ workspaceId: x.workspaceId, actorUserId: x.userId, ids: [entryId], dueDate: null });
    const headers = await timeReadKey(request);
    const query = new URLSearchParams({ projectId, userId: x.userId, status: "invoiced", source: "manual", start: "2026-10-31T12:00:00Z", end: "2026-10-31T14:00:00Z" });
    const response = await request.get(`/api/v1/time-entries?${query}`, { headers }); expect(response.status()).toBe(200);
    expect((await response.json()).entries.map((row: { id: string }) => row.id)).toEqual([entryId]);
    const saved = await snapshot(x.workspaceId);
    expect(saved.lifecycle.find(row => row.invoiceId === selected.id)?.exposedAt).not.toBeNull();
    expect(saved.lifecycle.find(row => row.invoiceId === x.invoice.id)?.exposedAt).toBeNull();
    expect(saved.audits.filter(row => row.eventType === "time_financial_exported").map(row => row.timeEntryId)).toEqual([entryId]);
    await expect(release(x)).resolves.toMatchObject({ invoice: { status: "void" } });
    expect((await post(request, selected.id)).status()).toBe(409);
  });

  test("I1 public time-read preserves descending order and 500 limit without exposing excluded rows", async ({ request }) => {
    test.setTimeout(120_000);
    const x = await seed(request), headers = await timeReadKey(request), base = Date.parse("2026-10-30T00:00:00Z");
    const entries = Array.from({ length: 501 }, (_, index) => ({ id: crypto.randomUUID(), workspaceId: x.workspaceId, userId: x.userId, taskId: `Limited ${index}`, startedAt: new Date(base + index * 1000), stoppedAt: new Date(base + index * 1000 + 1000), durationSeconds: 1, hourlyRate: 36, status: "approved" as const, source: "manual" as const }));
    await db.insert(s.timeEntries).values(entries);
    const response = await request.get("/api/v1/time-entries?status=approved", { headers, timeout: 100_000 }); expect(response.status()).toBe(200);
    const returned = (await response.json()).entries.map((row: { id: string }) => row.id);
    expect(returned).toEqual(entries.slice(1).reverse().map(row => row.id));
    const saved = await snapshot(x.workspaceId);
    expect(saved.audits.filter(row => row.eventType === "time_financial_exported").map(row => row.timeEntryId).sort()).toEqual([...returned].sort());
    expect(saved.lifecycle[0].exposedAt).toBeNull();
    const excluded = await createInvoiceFromSelection({ workspaceId: x.workspaceId, actorUserId: x.userId, ids: [entries[0].id], dueDate: null });
    await expect(voidDraftInvoice({ workspaceId: x.workspaceId, actorUserId: x.userId, invoiceId: excluded.id, reason: "Not returned by API" })).resolves.toMatchObject({ invoice: { status: "void" } });
  });

  for (const write of [1, 2]) test(`I1 public time-read barrier failure after actual write ${write} returns no rows and rolls back`, async ({ request }) => {
    const x = await seed(request), headers = await timeReadKey(request), before = await snapshot(x.workspaceId);
    // Execute the actual GET and actual API-key authorization against this DB.
    // Only a PostgreSQL write is faulted after execution; no financial helper is stubbed.
    const native = createRequire(resolve("package.json"));
    const loadedRoute = { exports: {} as { GET: (req: NextRequest, ctx: { params: Promise<{ resource: string }> }) => Promise<Response> } };
    const source = ts.transpileModule(readFileSync("app/api/v1/[resource]/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function("require", "module", "exports", source)((id: string) => native(id.startsWith("@/") ? `./${id.slice(2)}` : id), loadedRoute, loadedRoute.exports);
    await failAfterWrite(write, async () => {
      const response = await loadedRoute.exports.GET(new NextRequest("https://fixture.invalid/api/v1/time-entries?status=invoiced", { headers }), { params: Promise.resolve({ resource: "time-entries" }) });
      expect(response.status).toBe(500);
      const body = await response.json(); expect(body.entries).toBeUndefined(); expect(body.ok).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(x.entryId);
    }, true);
    expect(await snapshot(x.workspaceId)).toEqual(before);
  });

  test("I1 public time-read missing read scope refuses before exposure", async ({ request }) => {
    const x = await seed(request), headers = await timeReadKey(request, ["read:invoices"]), before = await snapshot(x.workspaceId);
    const response = await request.get("/api/v1/time-entries", { headers }); expect(response.status()).toBe(403);
    expect((await response.json()).entries).toBeUndefined(); expect(await snapshot(x.workspaceId)).toEqual(before);
  });

  // F1: Removing the public intelligence exposure barrier must leave these
  // returned approved financial lines incorrectly eligible for later release.
  test("F1 public intelligence remembers the exact approved line before later invoice creation", async ({ request }) => {
    const x = await seed(request); await release(x);
    const headers = await timeReadKey(request, ["read:revenue-intelligence"]);
    const response = await request.get("/api/v1/revenue-intelligence", { headers });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.recoveryOpportunities).toEqual([expect.objectContaining({ id: `approved-${x.entryId}`, type: "approved_uninvoiced_entry", hours: 1, recoverableAmount: 125 })]);
    const exported = await snapshot(x.workspaceId);
    expect(exported.audits.filter(row => row.eventType === "time_financial_exported").map(row => row.timeEntryId)).toEqual([x.entryId]);
    const next = await createInvoiceFromSelection({ workspaceId: x.workspaceId, actorUserId: x.userId, ids: [x.entryId], dueDate: null });
    const saved = await snapshot(x.workspaceId);
    expect(saved.lifecycle.find(row => row.invoiceId === next.id)?.exposedAt).not.toBeNull();
    expect((await post(request, next.id)).status()).toBe(409);
    expect(await snapshot(x.workspaceId)).toEqual(saved);
  });

  test("F1 public intelligence scope refusal does not mark financial records", async ({ request }) => {
    const x = await seed(request); await release(x);
    const headers = await timeReadKey(request, ["read:time"]), before = await snapshot(x.workspaceId);
    const response = await request.get("/api/v1/revenue-intelligence", { headers });
    expect(response.status()).toBe(403);
    expect((await response.json()).recoveryOpportunities).toBeUndefined();
    expect(await snapshot(x.workspaceId)).toEqual(before);
  });

  test("F1 public intelligence filters leave unrelated approved time unexposed", async ({ request }) => {
    const x = await seed(request); await release(x);
    const projectId = crypto.randomUUID(), entryId = crypto.randomUUID();
    await db.insert(s.projects).values({ id: projectId, workspaceId: x.workspaceId, name: "Selected intelligence" });
    await db.insert(s.timeEntries).values({ id: entryId, workspaceId: x.workspaceId, userId: x.userId, projectId, taskId: "Selected line", startedAt: new Date("2026-10-31T12:00:00Z"), stoppedAt: new Date("2026-10-31T13:00:00Z"), durationSeconds: 3600, hourlyRate: 25, status: "approved", source: "manual" });
    const headers = await timeReadKey(request, ["read:revenue-intelligence"]);
    const query = new URLSearchParams({ projectId, start: "2026-10-31T12:00:00Z", end: "2026-10-31T14:00:00Z" });
    const response = await request.get(`/api/v1/revenue-intelligence?${query}`, { headers });
    expect(response.status()).toBe(200);
    expect((await response.json()).recoveryOpportunities).toEqual([expect.objectContaining({ id: `approved-${entryId}`, hours: 1, recoverableAmount: 25 })]);
    const saved = await snapshot(x.workspaceId);
    expect(saved.audits.filter(row => row.eventType === "time_financial_exported").map(row => row.timeEntryId)).toEqual([entryId]);
    const selected = await createInvoiceFromSelection({ workspaceId: x.workspaceId, actorUserId: x.userId, ids: [entryId], dueDate: null });
    const excluded = await createInvoiceFromSelection({ workspaceId: x.workspaceId, actorUserId: x.userId, ids: [x.entryId], dueDate: null });
    expect((await post(request, selected.id)).status()).toBe(409);
    expect((await post(request, excluded.id)).status()).toBe(200);
  });

  test("F1 public intelligence marks returned financial opportunities but not output-truncated entries", async ({ request }) => {
    const owner = await login(request), at = Date.parse("2026-10-31T00:00:00Z");
    const entries = Array.from({ length: 20 }, (_, index) => ({ id: crypto.randomUUID(), workspaceId: owner.workspaceId, userId: owner.userId, taskId: `Intelligence line ${index}`, startedAt: new Date(at + index * 3600_000), stoppedAt: new Date(at + (index + 1) * 3600_000), durationSeconds: 3600, hourlyRate: 25, status: "approved" as const, source: "manual" as const }));
    await db.insert(s.timeEntries).values(entries);
    const headers = await timeReadKey(request, ["read:revenue-intelligence"]);
    const response = await request.get("/api/v1/revenue-intelligence", { headers });
    expect(response.status()).toBe(200);
    const body = await response.json() as { recoveryOpportunities: Array<{ id: string; type: string; hours: number; recoverableAmount: number }> };
    expect(body.recoveryOpportunities).toHaveLength(16);
    for (const item of body.recoveryOpportunities) expect(item).toMatchObject({ type: "approved_uninvoiced_entry", hours: 1, recoverableAmount: 25 });
    const returned = body.recoveryOpportunities.map(item => item.id.replace(/^approved-/, ""));
    expect(new Set(returned).size).toBe(16);
    expect(returned.every(id => entries.some(entry => entry.id === id))).toBe(true);
    const excluded = entries.find(entry => !returned.includes(entry.id)); expect(excluded).toBeTruthy();
    const saved = await snapshot(owner.workspaceId);
    expect(saved.audits.filter(row => row.eventType === "time_financial_exported").map(row => row.timeEntryId).sort()).toEqual([...returned].sort());
    const exposedInvoice = await createInvoiceFromSelection({ workspaceId: owner.workspaceId, actorUserId: owner.userId, ids: [returned[0]], dueDate: null });
    const unexposedInvoice = await createInvoiceFromSelection({ workspaceId: owner.workspaceId, actorUserId: owner.userId, ids: [excluded!.id], dueDate: null });
    expect((await post(request, exposedInvoice.id)).status()).toBe(409);
    expect((await post(request, unexposedInvoice.id)).status()).toBe(200);
  });

  test("F1 public intelligence failed exposure write returns no financial payload and rolls back", async ({ request }) => {
    const x = await seed(request); await release(x);
    const headers = await timeReadKey(request, ["read:revenue-intelligence"]), before = await snapshot(x.workspaceId);
    const native = createRequire(resolve("package.json"));
    const loaded = { exports: {} as { GET: (req: NextRequest, ctx: { params: Promise<{ resource: string }> }) => Promise<Response> } };
    const source = ts.transpileModule(readFileSync("app/api/v1/[resource]/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function("require", "module", "exports", source)((id: string) => native(id.startsWith("@/") ? `./${id.slice(2)}` : id), loaded, loaded.exports);
    await failAfterWrite(1, async () => {
      const response = await loaded.exports.GET(new NextRequest("https://fixture.invalid/api/v1/revenue-intelligence", { headers }), { params: Promise.resolve({ resource: "revenue-intelligence" }) });
      expect(response.status).toBe(500);
      const body = await response.json(); expect(body.recoveryOpportunities).toBeUndefined(); expect(body.summary).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(x.entryId);
    }, true);
    expect(await snapshot(x.workspaceId)).toEqual(before);
  });

  test("F1 public intelligence and concurrent creation serialize exposure before releasable draft publication", async ({ request }) => {
    const x = await seed(request); await release(x);
    const headers = await timeReadKey(request, ["read:revenue-intelligence"]);
    const barrier = await holdFinancialDatabaseLock(tx => lockInvoiceLifecycle(tx, x.workspaceId));
    let settled = false;
    const reading = request.get("/api/v1/revenue-intelligence", { headers }).then(response => { settled = true; return response; });
    let creation: ReturnType<typeof createInvoiceFromSelection> | undefined;
    try {
      await waitForFinancialDatabaseWaiters(barrier.pid, 1, () => settled);
      creation = createInvoiceFromSelection({ workspaceId: x.workspaceId, actorUserId: x.userId, ids: [x.entryId], dueDate: null });
      await waitForFinancialDatabaseWaiters(barrier.pid, 2, () => settled);
    } finally {
      await barrier.release();
      await Promise.allSettled([reading, ...(creation ? [creation] : [])]);
    }
    const response = await reading; expect(response.status()).toBe(200);
    expect((await response.json()).recoveryOpportunities).toEqual([expect.objectContaining({ id: `approved-${x.entryId}`, recoverableAmount: 125 })]);
    expect(creation).toBeDefined(); const invoice = await creation!;
    const saved = await snapshot(x.workspaceId);
    expect(saved.lifecycle.find(row => row.invoiceId === invoice.id)?.exposedAt).not.toBeNull();
    expect((await post(request, invoice.id)).status()).toBe(409);
    expect(await snapshot(x.workspaceId)).toEqual(saved);
  });

  test("preview does not expose; confirmed void preserves history, releases exact entries and retry cannot unbill replacement", async ({ request }) => {
    const x = await seed(request);
    expect((await request.get(`/api/invoices/${x.invoice.id}/preview`)).status()).toBe(200);
    expect((await snapshot(x.workspaceId)).lifecycle[0].exposedAt).toBeNull();
    expect((await post(request, x.invoice.id)).status()).toBe(200);
    const saved = await snapshot(x.workspaceId);
    expect(saved.invoices[0].status).toBe("void"); expect(saved.entries[0].status).toBe("approved");
    expect(saved.lifecycle[0].releaseAuditId).toBeTruthy();
    expect((await verifiedReleasedInvoiceIds(db, x.workspaceId, saved.invoices)).has(x.invoice.id)).toBe(true);
    const next = await createInvoiceFromSelection({ workspaceId: x.workspaceId, actorUserId: x.userId, ids: [x.entryId], dueDate: null });
    const rebilled = await snapshot(x.workspaceId); expect(next.amount).toBe(125);
    expect((await post(request, x.invoice.id)).status()).toBe(200); expect(await snapshot(x.workspaceId)).toEqual(rebilled);
    const intelligence = await buildRevenueIntelligence(x.workspaceId, { scope: "team" }); expect(intelligence.summary.invoicedValue).toBe(125);
    expect((await request.get(`/api/invoices/${x.invoice.id}/proof-pack`)).status()).toBe(409);
    expect((await request.get(`/api/invoices/${x.invoice.id}/preview`)).status()).toBe(409);
  });
  for (const body of [{}, { confirmNotBilledElsewhere: false }, { confirmNotBilledElsewhere: "true" }, { confirmNotBilledElsewhere: true, reason: "x".repeat(501) }]) test(`confirmation refusal ${JSON.stringify(body).slice(0,70)} is atomic`, async ({ request }) => {
    const x = await seed(request), before = await snapshot(x.workspaceId);
    expect((await post(request, x.invoice.id, body)).status()).toBe(400); expect(await snapshot(x.workspaceId)).toEqual(before);
  });
  for (const role of ["member", "client", "foreign"]) test(`${role} cannot preview or void`, async ({ request }) => {
    const x = await seed(request); await login(request, role === "foreign" ? undefined : x.workspace, role === "foreign" ? "owner" : role);
    const before = await snapshot(x.workspaceId);
    expect((await post(request, x.invoice.id)).status()).toBe(role === "foreign" ? 404 : 403);
    expect((await request.get(`/api/invoices/${x.invoice.id}/preview`)).status()).toBe(role === "foreign" ? 404 : 403);
    expect(await snapshot(x.workspaceId)).toEqual(before);
  });
  test("workspace manager can review and void an owner's eligible draft", async ({ request }) => {
    const x = await seed(request), manager = await login(request, x.workspace, "manager");
    expect((await request.get(`/api/invoices/${x.invoice.id}/preview`)).status()).toBe(200);
    expect((await post(request, x.invoice.id)).status()).toBe(200);
    const saved = await snapshot(x.workspaceId); expect(saved.lifecycle[0].voidedBy).toBe(manager.userId); expect(saved.entries[0].status).toBe("approved");
  });
  for (const kind of ["legacy", "sent", "paid", "exposed", "duplicate", "changed-links", "changed-money", "changed-status", "missing-time", "unowned-time", "signoff", "quickbooks", "other-invoice", "bare-void"] as const) test(`${kind} refuses without partial changes`, async ({ request }) => {
    const x = await seed(request), invoiceKey = and(eq(s.invoices.workspaceId, x.workspaceId), eq(s.invoices.id, x.invoice.id));
    if (kind === "legacy") await db.delete(s.invoiceLifecycle).where(eq(s.invoiceLifecycle.invoiceId, x.invoice.id));
    if (["sent", "paid", "bare-void"].includes(kind)) await db.update(s.invoices).set({ status: kind === "bare-void" ? "void" : kind as "sent" | "paid" }).where(invoiceKey);
    if (kind === "exposed") await db.update(s.invoiceLifecycle).set({ exposedAt: new Date(), exposureReason: "export" }).where(eq(s.invoiceLifecycle.invoiceId, x.invoice.id));
    if (kind === "duplicate" || kind === "changed-links") await db.update(s.invoices).set({ timeEntryIds: kind === "duplicate" ? [x.entryId, x.entryId] : ["missing"] }).where(invoiceKey);
    if (kind === "changed-money") await db.update(s.invoices).set({ amount: 126 }).where(invoiceKey);
    if (kind === "changed-status") await db.update(s.timeEntries).set({ status: "approved" }).where(eq(s.timeEntries.id, x.entryId));
    if (kind === "missing-time") await db.delete(s.timeEntries).where(eq(s.timeEntries.id, x.entryId));
    if (kind === "unowned-time") await db.delete(s.memberships).where(and(eq(s.memberships.workspaceId, x.workspaceId), eq(s.memberships.userId, x.userId)));
    if (kind === "signoff") await db.insert(s.auditLogs).values({ id: crypto.randomUUID(), workspaceId: x.workspaceId, timeEntryId: x.invoice.id, actorUserId: x.userId, eventType: "client_invoice_signed_off", diff: {}, signature: "historical" });
    if (kind === "quickbooks") {
      const id = crypto.randomUUID();
      await db.insert(s.integrationConnections).values({ id, workspaceId: x.workspaceId, provider: "quickbooks", status: "disabled", createdByUserId: x.userId });
      await db.insert(s.integrationSyncRecords).values({ id: crypto.randomUUID(), workspaceId: x.workspaceId, connectionId: id, provider: "quickbooks", resourceType: "invoice", resourceId: x.invoice.id, externalId: "uncertain", syncStatus: "error" });
    }
    if (kind === "other-invoice") await db.insert(s.invoices).values({ ...x.invoice, id: crypto.randomUUID(), number: "OTHER", status: "void" });
    const before = await snapshot(x.workspaceId); await expect(release(x)).rejects.toThrow(); expect(await snapshot(x.workspaceId)).toEqual(before);
  });
  for (const surface of ["proof-pack", "print", "csv", "json"]) test(`${surface} exposure prevents release and digest matches actual export body`, async ({ request }) => {
    const x = await seed(request);
    const url = surface === "csv" || surface === "json" ? `/api/export/csv?format=${surface}&include=timeEntries` : `/api/invoices/${x.invoice.id}/${surface}`;
    const response = await request.get(url); expect(response.ok(), await response.text()).toBeTruthy();
    if (surface === "csv" || surface === "json") expect(response.headers()["x-sowledger-export-sha256"]).toBe(createHash("sha256").update(await response.body()).digest("hex"));
    const before = await snapshot(x.workspaceId); expect(before.lifecycle[0].exposedAt).not.toBeNull();
    expect((await post(request, x.invoice.id)).status()).toBe(409); expect(await snapshot(x.workspaceId)).toEqual(before);
  });
  test("no outbound target keeps eligibility; configured target reserves before dispatch; void first suppresses reservation", async ({ request }) => {
    const x = await seed(request);
    expect(await reserveInvoiceNotificationExposure(x.workspaceId, x.invoice.id, x.userId)).toBe(false);
    expect((await snapshot(x.workspaceId)).lifecycle[0].exposedAt).toBeNull();
    await release(x);
    await db.insert(s.webhooks).values({ id: crypto.randomUUID(), workspaceId: x.workspaceId, url: "https://example.invalid/never-dispatched", events: ["invoice.created"] });
    expect(await reserveInvoiceNotificationExposure(x.workspaceId, x.invoice.id, x.userId)).toBe(false);
    const next = await createInvoiceFromSelection({ workspaceId: x.workspaceId, actorUserId: x.userId, ids: [x.entryId], dueDate: null });
    expect(await reserveInvoiceNotificationExposure(x.workspaceId, next.id, x.userId)).toBe(true);
    await expect(voidDraftInvoice({ workspaceId: x.workspaceId, invoiceId: next.id, actorUserId: x.userId, reason: "" })).rejects.toThrow();
  });
  test("Slack reservation requires configured credentials, enabled status and invoice subscription", async ({ request }) => {
    const x = await seed(request), id = crypto.randomUUID();
    await db.insert(s.integrationConnections).values({ id, workspaceId: x.workspaceId, provider: "slack", status: "connected", createdByUserId: x.userId, config: { events: ["invoice.created"] }, credentials: {} });
    expect(await reserveInvoiceNotificationExposure(x.workspaceId, x.invoice.id, x.userId)).toBe(false);
    await db.update(s.integrationConnections).set({ credentials: { webhookUrl: "synthetic-not-used" }, config: { events: ["time_entry.created"] } }).where(eq(s.integrationConnections.id, id));
    expect(await reserveInvoiceNotificationExposure(x.workspaceId, x.invoice.id, x.userId)).toBe(false);
    await db.update(s.integrationConnections).set({ status: "disabled", config: { events: ["invoice.created"] } }).where(eq(s.integrationConnections.id, id));
    expect(await reserveInvoiceNotificationExposure(x.workspaceId, x.invoice.id, x.userId)).toBe(false);
    await db.update(s.integrationConnections).set({ status: "error" }).where(eq(s.integrationConnections.id, id));
    expect(await reserveInvoiceNotificationExposure(x.workspaceId, x.invoice.id, x.userId)).toBe(true);
  });
  test("concurrent void versus exposure has exactly one winner", async ({ request }) => {
    const x = await seed(request);
    const results = await Promise.allSettled([release(x), db.transaction(async tx => { await lockInvoiceLifecycle(tx, x.workspaceId); await exposeInvoice(tx, x.workspaceId, x.invoice.id, x.userId, "test export"); })]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const saved = await snapshot(x.workspaceId); expect(saved.invoices[0].status === "void").toBe(saved.lifecycle[0].exposedAt === null);
  });
  test("concurrent void and create never double bill; retry creates exactly one replacement", async ({ request }) => {
    const x = await seed(request);
    const input = { workspaceId: x.workspaceId, actorUserId: x.userId, ids: [x.entryId], dueDate: null };
    const result = await Promise.allSettled([release(x), createInvoiceFromSelection(input)]);
    expect(result[0].status).toBe("fulfilled");
    if (result[1].status === "rejected") await createInvoiceFromSelection(input);
    const saved = await snapshot(x.workspaceId); expect(saved.invoices.filter(i => i.status !== "void")).toHaveLength(1); expect(saved.entries[0].status).toBe("invoiced");
  });
  for (const write of [1, 2, 3, 4, 5]) test(`release rollback after actual write ${write} preserves invoice, time, provenance and signed history`, async ({ request }) => {
    const x = await seed(request), before = await snapshot(x.workspaceId);
    await failAfterWrite(write, () => release(x)); expect(await snapshot(x.workspaceId)).toEqual(before);
  });
  for (const write of [1, 2, 3, 4, 5]) test(`creation rollback after actual write ${write} cannot leave partial provenance`, async ({ request }) => {
    const x = await seed(request); await release(x); const before = await snapshot(x.workspaceId);
    await failAfterWrite(write, () => createInvoiceFromSelection({ workspaceId: x.workspaceId, actorUserId: x.userId, ids: [x.entryId], dueDate: null }));
    expect(await snapshot(x.workspaceId)).toEqual(before);
  });
  for (const write of [1, 2]) test(`export barrier failure after actual write ${write} produces no response and rolls back`, async ({ request }) => {
    const x = await seed(request), before = await snapshot(x.workspaceId); let response: Response | undefined;
    await failAfterWrite(write, async () => { const data = await loadExportData(x.workspaceId, { include: "timeEntries" }, { actorUserId: x.userId, format: "json" }); response = createExportResponse(data, "json", "never-returned"); });
    expect(response).toBeUndefined(); expect(await snapshot(x.workspaceId)).toEqual(before);
  });
  for (const surface of ["invoices", "proof-packs", "export"]) test(`public API ${surface} cannot bypass exposure`, async ({ request }) => {
    const x = await seed(request);
    const keyResponse = await request.post("/api/settings/api-keys", { data: { name: "Lifecycle isolated", scopes: ["read:invoices", "read:proof-packs", "export:data"] } }); expect(keyResponse.ok()).toBe(true);
    const { rawKey } = await keyResponse.json();
    const response = await request.get(`/api/v1/${surface}?invoiceId=${x.invoice.id}&include=timeEntries&format=json`, { headers: { authorization: `Bearer ${rawKey}` } });
    expect(response.ok(), await response.text()).toBe(true);
    if (surface === "export") expect(response.headers()["x-sowledger-export-sha256"]).toBe(createHash("sha256").update(await response.body()).digest("hex"));
    expect((await post(request, x.invoice.id)).status()).toBe(409);
  });
  test("filtered time export leaves unrelated draft eligible and prior exported time remains blocked after invoice creation", async ({ request }) => {
    const x = await seed(request), unrelatedId = crypto.randomUUID(), unrelatedEntry = crypto.randomUUID();
    await db.insert(s.projects).values({ id: unrelatedId, workspaceId: x.workspaceId, name: "Unrelated export" });
    await db.insert(s.timeEntries).values({ id: unrelatedEntry, workspaceId: x.workspaceId, userId: x.userId, projectId: unrelatedId, taskId: "Other", startedAt: new Date("2026-10-31T12:00:00Z"), stoppedAt: new Date("2026-10-31T13:00:00Z"), durationSeconds: 3600, hourlyRate: 25, status: "approved", source: "manual" });
    const response = await request.get(`/api/export/csv?include=timeEntries&projectId=${unrelatedId}`); expect(response.ok()).toBe(true);
    expect((await snapshot(x.workspaceId)).lifecycle[0].exposedAt).toBeNull();
    const next = await createInvoiceFromSelection({ workspaceId: x.workspaceId, actorUserId: x.userId, ids: [unrelatedEntry], dueDate: null });
    expect((await post(request, next.id)).status()).toBe(409); expect((await post(request, x.invoice.id)).status()).toBe(200);
  });
  test("void versus mark sent serializes to one successful transition", async ({ request }) => {
    const x = await seed(request);
    const results = await Promise.all([post(request, x.invoice.id), request.patch(`/api/invoices/${x.invoice.id}`, { data: { status: "sent" } })]);
    expect(results.map(result => result.status()).sort()).toEqual([200, 409]);
    const saved = await snapshot(x.workspaceId); expect(saved.entries[0].status).toBe(saved.invoices[0].status === "void" ? "approved" : "invoiced");
  });
  test("configured webhook versus void race cannot authorize both release and outbound payload", async ({ request }) => {
    const x = await seed(request);
    await db.insert(s.webhooks).values({ id: crypto.randomUUID(), workspaceId: x.workspaceId, url: "https://example.invalid/no-provider-call", events: ["invoice.created"] });
    const results = await Promise.allSettled([release(x), reserveInvoiceNotificationExposure(x.workspaceId, x.invoice.id, x.userId)]);
    const saved = await snapshot(x.workspaceId);
    const reservation = results[1]; expect(reservation.status).toBe("fulfilled");
    if (reservation.status === "fulfilled") expect(reservation.value).toBe(saved.invoices[0].status !== "void");
    expect(results[0].status).toBe(saved.invoices[0].status === "void" ? "fulfilled" : "rejected");
  });
  for (const scenario of ["no-target", "void-first", "dispatch-first", "reserve-fails"] as const) test(`real creation after-commit dispatch ${scenario} with only outbound/session boundaries substituted`, async ({ request }) => {
    const x = await seed(request); await release(x);
    if (scenario !== "no-target") await db.insert(s.webhooks).values({ id: crypto.randomUUID(), workspaceId: x.workspaceId, url: "https://example.invalid/stub-only", events: ["invoice.created"] });
    const native = createRequire(resolve("package.json"));
    const afters: Array<() => Promise<void>> = [], sent: unknown[] = [];
    const loadedRoute = { exports: {} as { POST: (req: NextRequest) => Promise<Response> } };
    const dependencies: Record<string, unknown> = {
      "next/server": { ...native("next/server"), after: (fn: () => Promise<void>) => afters.push(fn) },
      "@/lib/auth": { ...native("./lib/auth"), requireSession: async () => ({ sub: x.userId, workspaceId: x.workspaceId, role: "owner" }) },
      "@/lib/security": { ...native("./lib/security"), dispatchWebhook: async (...args: unknown[]) => { sent.push(args); } },
      "@/lib/integrations/notifications": { dispatchIntegrationNotification: async (...args: unknown[]) => { sent.push(args); } },
    };
    const source = ts.transpileModule(readFileSync("app/api/invoices/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function("require", "module", "exports", source)((id: string) => dependencies[id] ?? native(id.startsWith("@/") ? `./${id.slice(2)}` : id), loadedRoute, loadedRoute.exports);
    const response = await loadedRoute.exports.POST(new NextRequest("https://fixture.invalid/api/invoices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ timeEntryIds: [x.entryId] }) }));
    expect(response.status).toBe(200); const { invoice } = await response.json(); expect(afters).toHaveLength(1); expect(sent).toHaveLength(0);
    const input = { workspaceId: x.workspaceId, invoiceId: invoice.id, actorUserId: x.userId, reason: "" };
    if (scenario === "void-first") await voidDraftInvoice(input);
    if (scenario === "reserve-fails") await failAfterWrite(1, afters[0]); else await afters[0]();
    expect(sent).toHaveLength(scenario === "dispatch-first" ? 2 : 0);
    if (scenario === "dispatch-first") await expect(voidDraftInvoice(input)).rejects.toThrow();
    if (scenario === "no-target" || scenario === "reserve-fails") await expect(voidDraftInvoice(input)).resolves.toMatchObject({ invoice: { status: "void" } });
  });
});
