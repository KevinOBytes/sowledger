import { expect, test, type APIRequestContext } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import * as schema from "../lib/db/schema";
import { gotoApp } from "./helpers/navigation";

type Session = { workspaceId: string; userId: string };
type Seed = { owner: Session; workspace: string; email: string; clientEmail: string; clientId: string; p: string; q: string };
const at = new Date("2026-10-12T09:00:00.000Z");

test.describe("invoice perimeter: root-owned disposable application acceptance", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Root disposable wrapper only; never operator/production data.");
  test.setTimeout(60_000);
  const workspaces = new Set<string>(), users = new Set<string>();
  test.afterEach(async () => {
    for (const workspaceId of workspaces) {
      await db.delete(schema.workspacePeople).where(eq(schema.workspacePeople.workspaceId, workspaceId));
      await db.delete(schema.organizations).where(eq(schema.organizations.workspaceId, workspaceId));
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    }
    for (const userId of users) await db.delete(schema.users).where(eq(schema.users.id, userId));
    workspaces.clear(); users.clear();
  });
  async function login(request: APIRequestContext, workspace: string, email: string, role = "owner") {
    const response = await request.get(`/api/test/login?${new URLSearchParams({ workspace, email, role, plan: "smb" })}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    const session = await response.json() as Session; workspaces.add(session.workspaceId); users.add(session.userId); return session;
  }
  async function seed(request: APIRequestContext): Promise<Seed> {
    const workspace = `invoice-perimeter-${crypto.randomUUID()}`, email = `owner-${workspace}@example.com`, clientEmail = `client-${workspace}@example.com`;
    const owner = await login(request, workspace, email), clientId = crypto.randomUUID(), p = crypto.randomUUID(), q = crypto.randomUUID();
    await db.insert(schema.clients).values({ id: clientId, workspaceId: owner.workspaceId, name: "Perimeter client", email: clientEmail });
    await db.insert(schema.projects).values([{ id: p, workspaceId: owner.workspaceId, clientId, name: "Perimeter Alpha <safe>" }, { id: q, workspaceId: owner.workspaceId, clientId, name: "Perimeter Beta" }]);
    return { owner, workspace, email, clientEmail, clientId, p, q };
  }
  async function entry(s: Seed, projectId: string | null = s.p, status: "approved" | "invoiced" = "invoiced") {
    const [row] = await db.insert(schema.timeEntries).values({ id: crypto.randomUUID(), ...s.owner, projectId, taskId: "Perimeter time", description: "Reviewed <script>not executable</script>", startedAt: at, stoppedAt: new Date(at.getTime() + 3600_000), durationSeconds: 3600, hourlyRate: 100, status, source: "manual" }).returning(); return row;
  }
  async function invoice(s: Seed, status: string, entryIds?: string[]) {
    const ids = entryIds ?? [(await entry(s)).id], id = crypto.randomUUID();
    // These are directly seeded legacy unknown/void values, not supported
    // transitions, a new lifecycle, or a schema migration.
    const [row] = await db.insert(schema.invoices).values({ id, workspaceId: s.owner.workspaceId, projectId: null, number: `PERIMETER-${id}`, amount: ids.length * 100, timeEntryIds: ids, status: status as typeof schema.invoices.$inferInsert.status }).returning(); return row;
  }
  async function savedInvoice(s: Seed, invoiceId: string) {
    const [row] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.workspaceId, s.owner.workspaceId), eq(schema.invoices.id, invoiceId))); return row;
  }

  test("duplicate persisted status/push guards are side-effect free while existing direct evidence entitlement is unchanged", async ({ request }) => {
    const s = await seed(request), time = await entry(s);
    const rows = [await invoice(s, "draft", [time.id, time.id]), await invoice(s, "sent", [time.id, time.id]), await invoice(s, "paid", [time.id, time.id])];
    const before = await db.select().from(schema.invoices).where(eq(schema.invoices.workspaceId, s.owner.workspaceId));
    const audits = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.workspaceId, s.owner.workspaceId));
    const conflict = "Some time entries are listed more than once on this invoice. Ask a workspace manager to review it before changing its status or pushing it to QuickBooks.";
    for (const row of rows) {
      if (row.status !== "paid") { const res = await request.patch(`/api/invoices/${row.id}`, { data: { status: row.status === "draft" ? "sent" : "paid" } }); expect(res.status()).toBe(409); expect((await res.json()).error).toBe(conflict); }
      const push = await request.post("/api/integrations/quickbooks/push-invoice", { data: { invoiceId: row.id } }); expect(push.status()).toBe(409); expect((await push.json()).error).toBe(conflict);
    }
    expect(await db.select().from(schema.invoices).where(eq(schema.invoices.workspaceId, s.owner.workspaceId))).toEqual(before);
    expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.workspaceId, s.owner.workspaceId))).toEqual(audits);
    await login(request, s.workspace, `unrelated-${s.workspace}@example.com`, "client");
    expect((await (await request.get("/api/client")).json()).invoices).toEqual([]);
    for (const row of rows) {
      expect((await request.get(`/api/invoices/${row.id}/proof-pack`)).status()).toBe(404);
      expect((await request.post("/api/client/signoff", { data: { invoiceId: row.id, digest: "a".repeat(64) } })).status()).toBe(404);
    }
    // Unknown audience is not a denial rule. Already entitled clients retain
    // sent/paid direct evidence and signoff access; the list UI is not that API.
    await login(request, s.workspace, s.clientEmail, "client");
    expect((await request.get(`/api/invoices/${rows[0].id}/proof-pack`)).status()).toBe(404);
    for (const row of rows.slice(1)) {
      const proof = await request.get(`/api/invoices/${row.id}/proof-pack`); expect(proof.ok()).toBeTruthy(); const evidence = await proof.json();
      expect((await request.post("/api/client/signoff", { data: { invoiceId: row.id, digest: evidence.digest } })).ok()).toBeTruthy();
    }
  });

  test("client allowlists hide directly seeded draft/unknown/void with old approval, while same-client multi-project sent/paid remain accessible", async ({ request }) => {
    const s = await seed(request);
    const sharedEntries = [(await entry(s)).id, (await entry(s, s.q)).id];
    const sent = await invoice(s, "sent", sharedEntries), paid = await invoice(s, "paid");
    // Capture authentic older proof while the record is still sent, then seed
    // its later hidden status. A void invoice must never build fresh proof.
    const hidden = await Promise.all(["draft", "unknown", "void"].map(async status => ({ ...await invoice(s, "sent"), status })));
    const otherClient = crypto.randomUUID(), otherProject = crypto.randomUUID();
    await db.insert(schema.clients).values({ id: otherClient, workspaceId: s.owner.workspaceId, name: "Unrelated private client", email: `other-${s.workspace}@example.com` });
    await db.insert(schema.projects).values({ id: otherProject, workspaceId: s.owner.workspaceId, clientId: otherClient, name: "Unrelated project" });
    const notEntitled = [await invoice(s, "sent", [(await entry(s)).id, (await entry(s, otherProject)).id]), await invoice(s, "paid", [(await entry(s)).id, (await entry(s, null)).id])];
    for (const row of hidden) {
      const review = await request.get(`/api/invoices/${row.id}/proof-pack`); expect(review.ok()).toBeTruthy();
      const old = await review.json(); expect(old.proofPack.invoice.status).toBe("sent");
      await db.insert(schema.auditLogs).values({ id: crypto.randomUUID(), workspaceId: s.owner.workspaceId, timeEntryId: row.id, actorUserId: s.owner.userId, eventType: "client_invoice_signed_off", signature: "synthetic-old-evidence", diff: { clientSignoff: { after: { invoiceId: row.id, invoiceNumber: row.number, signedOffAt: at.toISOString(), digest: old.digest, snapshot: old.proofPack } } } });
      await db.update(schema.invoices).set({ status: row.status as "draft" | "void" }).where(and(eq(schema.invoices.workspaceId, s.owner.workspaceId), eq(schema.invoices.id, row.id)));
      if (row.status === "void") for (const suffix of ["proof-pack", "proof-pack?approved=true", "print", "print?approved=true"]) expect((await request.get(`/api/invoices/${row.id}/${suffix}`)).status()).toBe(409);
    }
    await login(request, s.workspace, s.clientEmail, "client");
    const list = await request.get("/api/client"); expect(list.ok()).toBeTruthy(); expect((await list.json()).invoices.map((row: { id: string }) => row.id).sort()).toEqual([sent.id, paid.id].sort());
    for (const row of hidden) {
      for (const suffix of ["proof-pack", "proof-pack?approved=true", "print", "print?approved=true"]) expect((await request.get(`/api/invoices/${row.id}/${suffix}`)).status()).toBe(404);
      expect((await request.post("/api/client/signoff", { data: { invoiceId: row.id, digest: "a".repeat(64) } })).status()).toBe(404);
      const audits = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.workspaceId, s.owner.workspaceId), eq(schema.auditLogs.timeEntryId, row.id), eq(schema.auditLogs.eventType, "client_invoice_signed_off"))); expect(audits).toHaveLength(1);
    }
    for (const row of notEntitled) {
      for (const suffix of ["proof-pack", "proof-pack?approved=true", "print"]) expect((await request.get(`/api/invoices/${row.id}/${suffix}`)).status()).toBe(404);
      expect((await request.post("/api/client/signoff", { data: { invoiceId: row.id, digest: "a".repeat(64) } })).status()).toBe(404);
    }
    for (const row of [sent, paid]) {
      const response = await request.get(`/api/invoices/${row.id}/proof-pack`); expect(response.ok()).toBeTruthy(); const reviewed = await response.json();
      expect(reviewed.proofPack.entries.length).toBe(row.timeEntryIds.length);
      expect((await request.post("/api/client/signoff", { data: { invoiceId: row.id, digest: "0".repeat(64) } })).status()).toBe(409);
      for (let attempt = 0; attempt < 2; attempt++) expect((await request.post("/api/client/signoff", { data: { invoiceId: row.id, digest: reviewed.digest } })).ok()).toBeTruthy();
      const audits = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.workspaceId, s.owner.workspaceId), eq(schema.auditLogs.timeEntryId, row.id), eq(schema.auditLogs.eventType, "client_invoice_signed_off"))); expect(audits).toHaveLength(1);
      expect((audits[0].diff as { clientSignoff: { after: { snapshot: unknown } } }).clientSignoff.after.snapshot).toEqual(reviewed.proofPack);
      await db.update(schema.timeEntries).set({ description: "Changed after approval" }).where(and(eq(schema.timeEntries.workspaceId, s.owner.workspaceId), eq(schema.timeEntries.id, row.timeEntryIds[0])));
      expect((await request.post("/api/client/signoff", { data: { invoiceId: row.id, digest: reviewed.digest } })).status()).toBe(409);
      const historical = await request.get(`/api/invoices/${row.id}/proof-pack?approved=true`); expect(historical.ok()).toBeTruthy(); const approved = await historical.json();
      expect(approved.digest).toBe(reviewed.digest); expect(approved.proofPack).toEqual(reviewed.proofPack); expect(historical.headers()["x-sowledger-proof-sha256"]).toBe(reviewed.digest);
      const print = await request.get(`/api/invoices/${row.id}/print?approved=true`); expect(print.ok()).toBeTruthy(); expect(print.headers()["x-sowledger-proof-sha256"]).toBe(reviewed.digest); const html = await print.text(); expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>not executable");
    }
  });

  test("status authorization, linked-entry entitlement and missing/foreign boundaries remain intact without provider operations", async ({ request }) => {
    const s = await seed(request), draft = await invoice(s, "draft"), sent = await invoice(s, "sent");
    for (const status of ["draft", "unknown", "void"]) {
      const row = status === "draft" ? draft : await invoice(s, status);
      const denied = await request.post("/api/integrations/quickbooks/push-invoice", { data: { invoiceId: row.id } }); expect(denied.status()).toBe(409); expect((await denied.json()).error).toMatch(/mark it as sent/i);
    }
    expect((await request.patch(`/api/invoices/${draft.id}`, { data: { status: "paid" } })).status()).toBe(409);
    await login(request, s.workspace, `member-${s.workspace}@example.com`, "member");
    expect((await request.patch(`/api/invoices/${sent.id}`, { data: { status: "paid" } })).status()).toBe(403); expect((await request.get(`/api/invoices/${draft.id}/proof-pack`)).status()).toBe(403);
    await login(request, s.workspace, `unrelated-${s.workspace}@example.com`, "client");
    expect((await (await request.get("/api/client")).json()).invoices).toEqual([]);
    for (const suffix of ["proof-pack", "proof-pack?approved=true", "print"]) expect((await request.get(`/api/invoices/${sent.id}/${suffix}`)).status()).toBe(404);
    expect((await request.post("/api/client/signoff", { data: { invoiceId: sent.id, digest: "a".repeat(64) } })).status()).toBe(404);
    await login(request, `foreign-${s.workspace}`, `foreign-${s.workspace}@example.com`);
    expect((await request.patch(`/api/invoices/${sent.id}`, { data: { status: "paid" } })).status()).toBe(404); expect((await request.get(`/api/invoices/${sent.id}/proof-pack`)).status()).toBe(404);
    for (const invoiceId of [sent.id, crypto.randomUUID()]) expect((await request.post("/api/integrations/quickbooks/push-invoice", { data: { invoiceId } })).status()).toBe(404);
    expect((await savedInvoice(s, sent.id)).status).toBe("sent"); expect((await savedInvoice(s, draft.id)).status).toBe("draft");
  });

  for (const width of [390, 1440]) test(`real internal invoice UI confirms draft to sent to paid with independent persisted readback at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.context().addCookies([{ name: "sowledger-cookie-consent", value: "false", url: "http://localhost:3008" }]);
    const s = await seed(page.request), time = await entry(s, null, "approved");
    const created = await page.request.post("/api/invoices", { data: { timeEntryIds: [time.id] } }); expect(created.ok(), await created.text()).toBeTruthy(); const row = (await created.json()).invoice;
    expect(row.billingAudience).toBe("internal");
    const errors: string[] = [], providerRequests: string[] = [], confirmations: string[] = [];
    page.on("pageerror", error => errors.push(error.message)); page.on("request", request => { if (request.url().includes("push-invoice")) providerRequests.push(request.url()); });
    page.on("dialog", async dialog => { confirmations.push(dialog.message()); await dialog.accept(); });
    await gotoApp(page, "/invoices");
    await expect(page.getByText("Internal — not shared in the client portal", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Review draft" }).click(); await expect(page.getByRole("heading", { name: row.number })).toBeVisible();
    for (const [label, status] of [["Mark as sent", "sent"], ["Mark as paid", "paid"]] as const) {
      const updated = page.waitForResponse(response => response.url().endsWith(`/api/invoices/${row.id}`) && response.request().method() === "PATCH");
      await page.getByRole("button", { name: label }).click(); const response = await updated; expect(response.ok(), await response.text()).toBeTruthy(); expect((await response.json()).invoice).toMatchObject({ id: row.id, status });
      expect((await savedInvoice(s, row.id)).status).toBe(status);
      await expect(page.getByRole("heading", { name: row.number })).toBeVisible(); await expect(page.getByText(/Details SHA-256:/)).toBeVisible();
      const proof = await page.request.get(`/api/invoices/${row.id}/proof-pack`); expect(proof.ok()).toBeTruthy(); const evidence = await proof.json(); expect(evidence.proofPack.invoice).toMatchObject({ id: row.id, status });
      await expect(page.getByText(/Details SHA-256:/)).toContainText(evidence.digest);
      await expect(page.getByRole("button", { name: label })).toHaveCount(0);
    }
    expect(confirmations[0]).toMatch(/internal.*not shared/i); expect(confirmations[0]).toMatch(/does not email/i); expect(confirmations[1]).toMatch(/received payment outside SOWLedger/i); expect(confirmations[1]).toMatch(/does not process a payment/i);
    await page.reload(); await expect(page.locator("article").filter({ hasText: row.number })).toContainText("paid"); await expect(page.getByRole("button", { name: /Mark as/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Open proof pack" }).click(); await expect(page.getByRole("heading", { name: row.number })).toBeVisible();
    expect((await savedInvoice(s, row.id)).status).toBe("paid"); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([]); expect(providerRequests).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`internal-invoice-paid-${width}.png`), fullPage: true });
  });
});
