import { expect, test, type APIRequestContext } from "@playwright/test";
import { and, eq, sql } from "drizzle-orm";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import ts from "typescript";
import { db, getDb } from "../lib/db";
import * as s from "../lib/db/schema";
import { createInvoiceFromSelection } from "../lib/invoice-selection";
import { buildInvoiceProofPack } from "../lib/invoice-proof-pack";
import { holdFinancialDatabaseLock, waitForFinancialDatabaseWaiters } from "./helpers/financial-db-barrier";

test.use({ trace: "off", video: "off", screenshot: "off" });

test.describe("F2 expense attachment financial history: disposable database only", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Root-owned disposable database required.");
  test.setTimeout(60_000);
  const ownedWorkspaces = new Set<string>(), ownedUsers = new Set<string>();
  test.afterEach(async () => {
    for (const id of ownedWorkspaces) await db.delete(s.workspaces).where(eq(s.workspaces.id, id));
    for (const id of ownedUsers) await db.delete(s.users).where(eq(s.users.id, id));
    ownedWorkspaces.clear(); ownedUsers.clear();
  });

  async function login(request: APIRequestContext, workspace = `expense-${crypto.randomUUID()}`, role: "owner" | "manager" | "member" = "owner") {
    const email = `expense-${crypto.randomUUID()}@example.com`;
    const response = await request.get(`/api/test/login?${new URLSearchParams({ workspace, role, plan: "smb", email })}`);
    expect(response.ok(), await response.text()).toBe(true);
    const identity = await response.json() as { workspaceId: string; userId: string };
    ownedWorkspaces.add(identity.workspaceId); ownedUsers.add(identity.userId);
    return { ...identity, workspace, role, email };
  }
  type Identity = Awaited<ReturnType<typeof login>>;
  const initialExpense = { label: "Existing receipt", amount: 5, currency: "USD", r2Key: "receipts/existing.pdf" };
  const attachment = (entryId: string, label = "Train", amount = 21) => ({ entryId, label, amount, currency: "USD", r2Key: `receipts/${crypto.randomUUID()}.pdf` });
  const expenseFromBody = ({ label, amount, currency, r2Key }: ReturnType<typeof attachment>) => ({ label, amount, currency, r2Key });
  const post = (request: APIRequestContext, body: ReturnType<typeof attachment>) => request.post("/api/expenses/attach", { data: body });

  async function seed(request: APIRequestContext, status: "draft" | "submitted" | "approved" | "invoiced" = "draft") {
    // Retain a real owner so test-login setup-role repair cannot promote the member.
    const owner = await login(request), actor = await login(request, owner.workspace, "member"), entryId = crypto.randomUUID();
    await db.insert(s.timeEntries).values({ id: entryId, workspaceId: owner.workspaceId, userId: actor.userId, taskId: "Expense history", description: "Reviewed work", startedAt: new Date("2026-10-31T10:00:00Z"), stoppedAt: new Date("2026-10-31T11:00:00Z"), durationSeconds: 3600, hourlyRate: 125, status: status === "invoiced" ? "approved" : status, source: "manual", expenses: [initialExpense] });
    const invoice = status === "invoiced" ? await createInvoiceFromSelection({ workspaceId: owner.workspaceId, actorUserId: owner.userId, ids: [entryId], dueDate: null }) : null;
    return { owner, actor, entryId, invoice, workspaceId: owner.workspaceId };
  }
  async function snapshot(workspaceId: string) {
    return {
      entries: await db.select().from(s.timeEntries).where(eq(s.timeEntries.workspaceId, workspaceId)).orderBy(s.timeEntries.id),
      audits: await db.select().from(s.auditLogs).where(eq(s.auditLogs.workspaceId, workspaceId)).orderBy(s.auditLogs.id),
      invoices: await db.select().from(s.invoices).where(eq(s.invoices.workspaceId, workspaceId)).orderBy(s.invoices.id),
      lifecycle: await db.select().from(s.invoiceLifecycle).where(eq(s.invoiceLifecycle.workspaceId, workspaceId)).orderBy(s.invoiceLifecycle.invoiceId),
      periods: await db.select().from(s.lockPeriods).where(eq(s.lockPeriods.workspaceId, workspaceId)).orderBy(s.lockPeriods.id),
    };
  }

  // Break caught: rejecting all expense writes or replacing existing expenses.
  test("F2 own-member mutable time retains its existing receipt and saves a signed attachment", async ({ request }) => {
    const x = await seed(request), body = attachment(x.entryId);
    const response = await post(request, body); expect(response.status()).toBe(200);
    const expense = expenseFromBody(body);
    const saved = await snapshot(x.workspaceId);
    expect(saved.entries[0].expenses).toEqual([initialExpense, expense]);
    expect(saved.entries[0].status).toBe("draft");
    expect(saved.audits).toEqual([expect.objectContaining({ workspaceId: x.workspaceId, timeEntryId: x.entryId, actorUserId: x.actor.userId, eventType: "expense_attached", diff: { expense: { before: null, after: expense } }, signature: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
  });

  // Break caught: retaining a stale submission after its financial details change,
  // or changing review state without including that transition in signed history.
  test("F2 submitted attachment withdraws the entry to draft with status audit", async ({ request }) => {
    const x = await seed(request, "submitted"), body = attachment(x.entryId), expense = expenseFromBody(body);
    expect((await post(request, body)).status()).toBe(200);
    const saved = await snapshot(x.workspaceId);
    expect(saved.entries[0]).toMatchObject({ id: x.entryId, status: "draft", expenses: [initialExpense, expense] });
    expect(saved.audits).toEqual([expect.objectContaining({
      workspaceId: x.workspaceId, timeEntryId: x.entryId, actorUserId: x.actor.userId, eventType: "expense_attached",
      diff: { expense: { before: null, after: expense }, status: { before: "submitted", after: "draft" } },
      signature: expect.stringMatching(/^[a-f0-9]{64}$/),
    })]);
  });

  // Break caught: allowing a financial amendment after approval/invoicing or
  // within a locked billing window, even for the entry's legitimate owner.
  for (const kind of ["approved", "invoiced", "locked"] as const) test(`F2 own-member ${kind} time refuses attachment without changing financial history`, async ({ request }) => {
    const x = await seed(request, kind === "locked" ? "draft" : kind);
    if (kind === "locked") await db.insert(s.lockPeriods).values({ id: crypto.randomUUID(), workspaceId: x.workspaceId, periodStart: new Date("2026-10-31T09:00:00Z"), periodEnd: new Date("2026-10-31T12:00:00Z"), reason: "Closed billing period", lockedByUserId: x.owner.userId });
    const before = await snapshot(x.workspaceId);
    const proof = x.invoice ? await buildInvoiceProofPack(x.workspaceId, x.invoice.id) : null;
    const response = await post(request, attachment(x.entryId)); expect(response.status()).toBe(409);
    expect(await snapshot(x.workspaceId)).toEqual(before);
    if (x.invoice) expect(await buildInvoiceProofPack(x.workspaceId, x.invoice.id)).toEqual(proof);
  });

  for (const role of ["manager", "owner"] as const) test(`F2 ${role} cannot bypass approved-time locks for another workspace member`, async ({ request }) => {
    const x = await seed(request, "approved");
    await login(request, x.owner.workspace, role);
    const before = await snapshot(x.workspaceId);
    expect((await post(request, attachment(x.entryId))).status()).toBe(409);
    expect(await snapshot(x.workspaceId)).toEqual(before);
  });

  for (const boundary of ["foreign-workspace", "other-member"] as const) test(`F2 ${boundary} attachment is refused without side effects`, async ({ request }) => {
    const x = await seed(request);
    await login(request, boundary === "foreign-workspace" ? undefined : x.owner.workspace, boundary === "foreign-workspace" ? "owner" : "member");
    const before = await snapshot(x.workspaceId);
    expect((await post(request, attachment(x.entryId))).status()).toBe(boundary === "foreign-workspace" ? 404 : 403);
    expect(await snapshot(x.workspaceId)).toEqual(before);
  });

  // Both actual handlers reach PostgreSQL lock waits before either can save.
  // Without a locked read, both read the same array and the later write loses one.
  test("F2 two concurrent attachments retain both receipts with matching audit history", async ({ request }) => {
    const x = await seed(request), train = attachment(x.entryId, "Train", 21), hotel = attachment(x.entryId, "Hotel", 34);
    const barrier = await holdFinancialDatabaseLock(async tx => {
      await tx.select().from(s.timeEntries).where(and(eq(s.timeEntries.workspaceId, x.workspaceId), eq(s.timeEntries.id, x.entryId))).for("update");
    });
    let settled = 0;
    const operations = [post(request, train), post(request, hotel)].map(operation => operation.then(response => { settled++; return response; }));
    try { await waitForFinancialDatabaseWaiters(barrier.pid, 2, () => settled > 0); }
    finally { await barrier.release(); await Promise.allSettled(operations); }
    const responses = await Promise.all(operations); expect(responses.map(response => response.status())).toEqual([200, 200]);
    const saved = await snapshot(x.workspaceId);
    expect(saved.entries[0].expenses).toHaveLength(3);
    expect(saved.entries[0].expenses).toEqual(expect.arrayContaining([initialExpense, expenseFromBody(train), expenseFromBody(hotel)]));
    expect(saved.audits.filter(row => row.eventType === "expense_attached").map(row => row.diff)).toEqual(expect.arrayContaining([
      { expense: { before: null, after: expenseFromBody(train) } },
      { expense: { before: null, after: expenseFromBody(hotel) } },
    ]));
    expect(saved.audits.filter(row => row.eventType === "expense_attached")).toHaveLength(2);
  });

  test("F2 attachment waiting behind approval rereads the now-locked entry before saving", async ({ request }) => {
    const x = await seed(request, "submitted");
    const barrier = await holdFinancialDatabaseLock(async tx => {
      await tx.select().from(s.timeEntries).where(and(eq(s.timeEntries.workspaceId, x.workspaceId), eq(s.timeEntries.id, x.entryId))).for("update");
      await tx.update(s.timeEntries).set({ status: "approved" }).where(and(eq(s.timeEntries.workspaceId, x.workspaceId), eq(s.timeEntries.id, x.entryId)));
    });
    let settled = false;
    const operation = post(request, attachment(x.entryId)).then(response => { settled = true; return response; });
    try { await waitForFinancialDatabaseWaiters(barrier.pid, 1, () => settled); }
    finally { await barrier.release(); await Promise.allSettled([operation]); }
    expect((await operation).status()).toBe(409);
    const saved = await snapshot(x.workspaceId);
    expect(saved.entries[0]).toMatchObject({ status: "approved", expenses: [initialExpense] });
    expect(saved.audits).toEqual([]);
  });

  // Both real HTTP handlers wait on the same held entry; attachment queues
  // first, so the already-pending approval must reread its withdrawn state.
  test("F2 attachment-first pending approval refuses until explicit resubmission", async ({ request }) => {
    const x = await seed(request, "submitted"), body = attachment(x.entryId), expense = expenseFromBody(body);
    const barrier = await holdFinancialDatabaseLock(async tx => {
      await tx.select().from(s.timeEntries).where(and(eq(s.timeEntries.workspaceId, x.workspaceId), eq(s.timeEntries.id, x.entryId))).for("update");
    });
    let attachmentSettled = false, approvalSettled = false;
    const attaching = post(request, body).then(response => { attachmentSettled = true; return response; });
    let approving: ReturnType<APIRequestContext["post"]> | undefined;
    try {
      // This proves the member request already authenticated and reached its
      // row lock before changing this request context to the manager identity.
      await waitForFinancialDatabaseWaiters(barrier.pid, 1, () => attachmentSettled);
      await login(request, x.owner.workspace, "manager");
      approving = request.post("/api/timer/approve", { data: { entryId: x.entryId } }).then(response => { approvalSettled = true; return response; });
      await waitForFinancialDatabaseWaiters(barrier.pid, 2, () => attachmentSettled || approvalSettled);
    } finally {
      await barrier.release();
      await Promise.allSettled([attaching, ...(approving ? [approving] : [])]);
    }
    expect((await attaching).status()).toBe(200);
    expect(approving).toBeDefined(); expect((await approving!).status()).toBe(409);
    const withdrawn = await snapshot(x.workspaceId);
    expect(withdrawn.entries[0]).toMatchObject({ id: x.entryId, status: "draft", expenses: [initialExpense, expense] });
    expect(withdrawn.audits).toEqual([expect.objectContaining({
      timeEntryId: x.entryId, eventType: "expense_attached",
      diff: { expense: { before: null, after: expense }, status: { before: "submitted", after: "draft" } },
    })]);
    expect((await request.post("/api/timer/approve", { data: { entryId: x.entryId } })).status()).toBe(409);
    expect(await snapshot(x.workspaceId)).toEqual(withdrawn);

    // Managers may explicitly resubmit workspace time under the existing API
    // policy. Only this new submission may make the edited entry approvable.
    expect((await request.post("/api/timer/submit", { data: { entryIds: [x.entryId] } })).status()).toBe(200);
    expect((await snapshot(x.workspaceId)).entries[0].status).toBe("submitted");
    expect((await request.post("/api/timer/approve", { data: { entryId: x.entryId } })).status()).toBe(200);
    const approved = await snapshot(x.workspaceId);
    expect(approved.entries[0]).toMatchObject({ status: "approved", expenses: [initialExpense, expense] });
    expect(approved.audits.map(row => row.eventType).sort()).toEqual(["entry_approved", "entry_submitted", "expense_attached"]);
  });

  function directAttachmentHandler(actor: Identity, afters: Array<() => Promise<void>>) {
    const native = createRequire(resolve("package.json"));
    const modules: Record<string, unknown> = {
      "@/lib/auth": { ...native("./lib/auth"), requireSession: async () => ({ sub: actor.userId, workspaceId: actor.workspaceId, email: actor.email, role: actor.role }) },
      "next/server": { ...native("next/server"), after: (callback: () => Promise<void>) => afters.push(callback) },
    };
    const loaded = { exports: {} as { POST: (request: NextRequest) => Promise<Response> } };
    const source = ts.transpileModule(readFileSync("app/api/expenses/attach/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function("require", "module", "exports", source)((id: string) => modules[id] ?? native(id.startsWith("@/") ? `./${id.slice(2)}` : id), loaded, loaded.exports);
    return loaded.exports.POST;
  }

  // Break caught: a different entry can close this entry's billing period
  // after its locked-period check but before the attachment commits.
  test("F2 overlapping-period invoicing waits for an in-flight attachment on another entry", async ({ request }) => {
    const x = await seed(request), otherEntryId = crypto.randomUUID(), body = attachment(x.entryId);
    await db.insert(s.timeEntries).values({ id: otherEntryId, workspaceId: x.workspaceId, userId: x.owner.userId, taskId: "Close overlapping period", startedAt: new Date("2026-10-31T09:00:00Z"), stoppedAt: new Date("2026-10-31T12:00:00Z"), durationSeconds: 10800, hourlyRate: 125, status: "approved", source: "manual" });
    await login(request, x.owner.workspace, "manager");
    const actual = getDb(), handler = directAttachmentHandler(x.actor, []);
    let signalReached!: (pid: number) => void, release!: () => void;
    const reached = new Promise<number>(resolve => { signalReached = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    // Pause only AFTER the real audit insertion. The attachment has passed its
    // period check and made both real writes, but must not commit yet.
    const pauseAudit = (builder: object, pid: number): object => new Proxy(builder, { get(target, key) {
      const value = Reflect.get(target, key);
      if (key === "then") return (resolveResult: (value: unknown) => unknown, rejectResult: (reason: unknown) => unknown) => value.call(target, async (rows: unknown) => {
        signalReached(pid);
        await held;
        return rows;
      }).then(resolveResult, rejectResult);
      return typeof value === "function" ? (...args: unknown[]) => { const result = value.apply(target, args); return result && typeof result === "object" ? pauseAudit(result, pid) : result; } : value;
    } });
    globalThis.__sowledgerDbClient = new Proxy(actual, { get(target, key) {
      if (key === "transaction") return (callback: (tx: unknown) => Promise<unknown>, options: Parameters<typeof actual.transaction>[1]) => actual.transaction(async tx => {
        const result = await tx.execute(sql`select pg_backend_pid() as pid`), pid = Number(result.rows[0].pid);
        return callback(new Proxy(tx, { get(inner, method) {
          const value = Reflect.get(inner, method);
          if (method === "insert") return (table: unknown) => { const builder = value.call(inner, table); return table === s.auditLogs ? pauseAudit(builder, pid) : builder; };
          return typeof value === "function" ? value.bind(inner) : value;
        } }));
      }, options);
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    const attaching = handler(new NextRequest("https://fixture.invalid/api/expenses/attach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    let invoicing: ReturnType<APIRequestContext["post"]> | undefined;
    let invoiceSettled = false;
    try {
      const pid = await Promise.race([reached, attaching.then(() => { throw new Error("Attachment completed before the real audit-insert barrier."); })]);
      invoicing = request.post("/api/timer/invoice", { data: { entryId: otherEntryId } }).then(response => { invoiceSettled = true; return response; });
      await waitForFinancialDatabaseWaiters(pid, 1, () => invoiceSettled);
    } finally {
      release();
      await Promise.allSettled([attaching, ...(invoicing ? [invoicing] : [])]);
      globalThis.__sowledgerDbClient = actual;
    }
    expect((await attaching).status).toBe(200);
    expect(invoicing).toBeDefined(); expect((await invoicing!).status()).toBe(200);
    const saved = await snapshot(x.workspaceId);
    expect(saved.entries.find(entry => entry.id === x.entryId)?.expenses).toEqual([initialExpense, expenseFromBody(body)]);
    expect(saved.entries.find(entry => entry.id === otherEntryId)?.status).toBe("invoiced");
    expect(saved.periods).toHaveLength(1);
    expect(saved.audits.filter(row => row.eventType === "expense_attached")).toHaveLength(1);
    expect(saved.audits.filter(row => row.eventType === "entry_invoiced")).toHaveLength(1);
  });

  // Only the database boundary is faulted AFTER the real audit insert. The
  // real expense writer, signer and transaction still execute normally.
  test("F2 failed audit insertion rolls back the earlier expense write and emits no event", async ({ request }) => {
    const x = await seed(request), before = await snapshot(x.workspaceId), actual = getDb();
    const afters: Array<() => Promise<void>> = [];
    const handler = directAttachmentHandler(x.actor, afters);
    let auditWrites = 0;
    const faultBuilder = (builder: object): object => new Proxy(builder, { get(target, key) {
      const value = Reflect.get(target, key);
      if (key === "then") return (resolveResult: (value: unknown) => unknown, rejectResult: (reason: unknown) => unknown) => value.call(target, () => {
        auditWrites++;
        throw new Error("Injected failure after actual expense audit insert");
      }).then(resolveResult, rejectResult);
      return typeof value === "function" ? (...args: unknown[]) => { const result = value.apply(target, args); return result && typeof result === "object" ? faultBuilder(result) : result; } : value;
    } });
    const faultClient = <T extends object>(client: T): T => new Proxy(client, { get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== "function") return value;
      if (key === "transaction") return (callback: (tx: unknown) => Promise<unknown>, options: unknown) => value.call(target, (tx: object) => callback(faultClient(tx)), options);
      if (key === "insert") return (table: unknown) => { const builder = value.call(target, table); return table === s.auditLogs ? faultBuilder(builder) : builder; };
      return value.bind(target);
    } });
    globalThis.__sowledgerDbClient = faultClient(actual);
    try {
      const response = await handler(new NextRequest("https://fixture.invalid/api/expenses/attach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(attachment(x.entryId)) }));
      expect(response.status).toBe(500);
      expect(auditWrites).toBe(1);
      expect(afters).toEqual([]);
    } finally { globalThis.__sowledgerDbClient = actual; }
    expect(await snapshot(x.workspaceId)).toEqual(before);
  });
});
