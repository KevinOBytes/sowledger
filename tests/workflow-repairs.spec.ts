import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import { auditLogs, clients, projects, scheduledWorkBlocks, timeEntries } from "../lib/db/schema";
import { editedTimeDuration } from "../lib/workflow-validation";
import { gotoApp } from "./helpers/navigation";

const at = (value: string) => new Date(`2026-01-12T${value}:00.000Z`);

test("paused entry edits preserve net duration and reject ranges shorter than breaks", () => {
  const entry = { startedAt: at("09:00"), stoppedAt: at("12:00"), durationSeconds: 7200 };
  expect(editedTimeDuration(entry, at("09:00"), at("12:00")).durationSeconds).toBe(7200);
  expect(editedTimeDuration(entry, at("09:00"), at("13:00")).durationSeconds).toBe(10800);
  expect(editedTimeDuration(entry, at("10:00"), at("12:00")).durationSeconds).toBe(3600);
  expect(() => editedTimeDuration(entry, at("11:45"), at("12:00"))).toThrow("shorter than");
  expect(editedTimeDuration({ ...entry, durationSeconds: 0 }, at("09:00"), at("12:00")).durationSeconds).toBe(0);
});

test.describe("isolated time, approval and invoice regressions", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Requires the disposable database wrapper; never run fixture writes against production.");
  test.setTimeout(90000);
  test.beforeEach(async ({ context }) => {
    await context.addCookies([{ name: "sowledger-cookie-consent", value: "true", domain: "localhost", path: "/" }]);
  });

  async function login(page: Page, workspace: string, role = "owner", email = `owner-${workspace}@example.com`) {
    const query = new URLSearchParams({ workspace, role, email, plan: "smb" });
    const response = await page.request.get(`/api/test/login?${query}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    return await response.json() as { userId: string; workspaceId: string };
  }

  async function seedEntry(owner: { userId: string; workspaceId: string }, overrides: Partial<typeof timeEntries.$inferInsert> = {}) {
    const [entry] = await db.insert(timeEntries).values({
      id: crypto.randomUUID(), workspaceId: owner.workspaceId, userId: owner.userId,
      taskId: "Review the project", description: "Completed project work", startedAt: at("09:00"), stoppedAt: at("10:00"),
      durationSeconds: 3600, source: "manual", hourlyRate: 100, status: "draft", ...overrides,
    }).returning();
    return entry;
  }

  test("new work types preserve an explicit zero rate separately from no rate", async ({ page }) => {
    await login(page, `zero-rate-${crypto.randomUUID()}`);
    const zero = await page.request.post("/api/user/actions", { data: { name: "Complimentary review", hourlyRate: 0 } });
    expect(zero.ok()).toBeTruthy();
    expect((await zero.json()).action.hourlyRate).toBe(0);
    const unset = await page.request.post("/api/user/actions", { data: { name: "Unrated research" } });
    expect(unset.ok()).toBeTruthy();
    expect((await unset.json()).action.hourlyRate).toBeNull();
    const saved = await page.request.get("/api/user/actions");
    expect((await saved.json()).actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Complimentary review", hourlyRate: 0 }),
      expect.objectContaining({ name: "Unrated research", hourlyRate: null }),
    ]));
  });

  test("invoice totals and reviewed line amounts use the same cent rounding", async ({ page }) => {
    const owner = await login(page, `rounding-${crypto.randomUUID()}`);
    const entry = await seedEntry(owner, { status: "approved", durationSeconds: 1800, hourlyRate: 99.99 });
    const response = await page.request.post("/api/invoices", { data: { timeEntryIds: [entry.id] } });
    expect(response.ok()).toBeTruthy();
    const { invoice } = await response.json();
    expect(invoice.amount).toBe(50);
    const proofResponse = await page.request.get(`/api/invoices/${invoice.id}/proof-pack`);
    expect(proofResponse.ok()).toBeTruthy();
    const { proofPack } = await proofResponse.json();
    expect(proofPack.entries[0].amount).toBe(invoice.amount);
    expect(proofPack.totals.amount).toBe(invoice.amount);
  });

  test("submission is atomic, role-scoped and supports send-back, edit and resubmission", async ({ page }) => {
    const workspace = `workflow-submit-${crypto.randomUUID()}`;
    const owner = await login(page, workspace);
    const own = await seedEntry(owner);
    expect((await page.request.post("/api/timer/invoice", { data: { entryId: own.id } })).status()).toBe(409);
    const running = await seedEntry(owner, { stoppedAt: null, durationSeconds: null });
    const batch = await page.request.post("/api/timer/submit", { data: { entryIds: [own.id, running.id] } });
    expect(batch.status()).toBe(409);
    const [unchanged] = await db.select().from(timeEntries).where(and(eq(timeEntries.id, own.id), eq(timeEntries.workspaceId, owner.workspaceId)));
    expect(unchanged.status).toBe("draft");
    expect((await page.request.post("/api/timer/submit", { data: { entryIds: [own.id, own.id] } })).status()).toBe(400);

    await login(page, workspace, "member", `member-${workspace}@example.com`);
    expect((await page.request.post("/api/timer/submit", { data: { entryIds: [own.id] } })).status()).toBe(403);
    expect((await page.request.post("/api/timer/approve", { data: { entryId: own.id } })).status()).toBe(403);
    await login(page, `other-${workspace}`);
    expect((await page.request.post("/api/timer/submit", { data: { entryIds: [own.id] } })).status()).toBe(404);
    await login(page, workspace);
    const submitted = await page.request.post("/api/timer/submit", { data: { entryIds: [own.id] } });
    expect(await submitted.json()).toEqual({ ok: true, submitted: 1 });
    expect((await page.request.post("/api/timer/submit", { data: { entryIds: [own.id] } })).status()).toBe(409);
    expect((await page.request.post("/api/timer/reject", { data: { entryId: own.id, reason: "Please explain the meeting." } })).ok()).toBeTruthy();
    const sentBack = await page.request.get("/api/timer/list?status=rejected");
    expect((await sentBack.json()).entries.map((entry: { id: string }) => entry.id)).toContain(own.id);
    expect((await page.request.patch("/api/timer/edit", { data: { entryId: own.id, description: "Meeting with the project team." } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/timer/submit", { data: { entryIds: [own.id] } })).ok()).toBeTruthy();
    const decisions = await Promise.all([
      page.request.post("/api/timer/approve", { data: { entryId: own.id } }),
      page.request.post("/api/timer/approve", { data: { entryId: own.id } }),
    ]);
    expect(decisions.map((response) => response.status()).sort()).toEqual([200, 409]);
    expect((await page.request.post("/api/timer/reject", { data: { entryId: own.id } })).status()).toBe(409);
    expect((await page.request.patch("/api/timer/edit", { data: { entryId: own.id, description: "Cannot change approved time" } })).status()).toBe(409);
    const events = await db.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, owner.workspaceId), eq(auditLogs.timeEntryId, own.id)));
    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining(["entry_submitted", "entry_rejected", "entry_resubmitted", "entry_approved", "manual_edit"]));
    expect(events.filter((event) => event.eventType === "entry_approved")).toHaveLength(1);
  });

  test("editing paused time preserves hours, clears explicit values and withdraws submitted changes", async ({ page }) => {
    const workspace = `workflow-edit-${crypto.randomUUID()}`;
    const owner = await login(page, workspace);
    const [project] = await db.insert(projects).values({ id: crypto.randomUUID(), workspaceId: owner.workspaceId, name: "Work project" }).returning();
    const entry = await seedEntry(owner, { stoppedAt: at("12:00"), durationSeconds: 7200, accumulatedSeconds: 3600, projectId: project.id, source: "web" });
    const edited = await page.request.patch("/api/timer/edit", { data: { entryId: entry.id, startedAt: entry.startedAt.toISOString(), stoppedAt: entry.stoppedAt!.toISOString(), description: "", projectId: null } });
    expect(edited.ok(), await edited.text()).toBeTruthy();
    expect((await edited.json()).nextDurationSeconds).toBe(7200);
    const [saved] = await db.select().from(timeEntries).where(and(eq(timeEntries.id, entry.id), eq(timeEntries.workspaceId, owner.workspaceId)));
    expect(saved.projectId).toBeNull();
    expect(saved.description).toBe("");
    expect(saved.durationSeconds).toBe(7200);
    const extended = await page.request.patch("/api/timer/edit", { data: { entryId: entry.id, stoppedAt: at("13:00").toISOString() } });
    expect((await extended.json()).nextDurationSeconds).toBe(10800);
    expect((await page.request.patch("/api/timer/edit", { data: { entryId: entry.id, startedAt: at("12:30").toISOString() } })).status()).toBe(400);
    expect((await page.request.post("/api/timer/submit", { data: { entryIds: [entry.id] } })).ok()).toBeTruthy();
    expect((await page.request.patch("/api/timer/edit", { data: { entryId: entry.id, description: "Revised submitted notes" } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/timer/approve", { data: { entryId: entry.id } })).status()).toBe(409);
    expect((await page.request.post("/api/timer/submit", { data: { entryIds: [entry.id] } })).ok()).toBeTruthy();
    const split = await page.request.post("/api/timer/split", { data: { entryId: entry.id, fractionSeconds: 3600 } });
    expect(split.ok(), await split.text()).toBeTruthy();
    const splitIds = await split.json();
    const splitEntries = await db.select().from(timeEntries).where(eq(timeEntries.workspaceId, owner.workspaceId));
    expect(splitEntries).toHaveLength(2);
    expect(splitEntries.every((row) => row.status === "draft")).toBeTruthy();
    expect(splitEntries.reduce((sum, row) => sum + (row.durationSeconds ?? 0), 0)).toBe(10800);
    expect(splitEntries.map((row) => row.id)).toContain(splitIds.newEntryId);
  });

  test("invoices enforce lifecycle, client entitlement, exact reviewed snapshots and isolated printing", async ({ page }) => {
    const workspace = `workflow-invoice-${crypto.randomUUID()}`;
    const owner = await login(page, workspace);
    const clientEmail = `client-${workspace}@example.com`;
    const [client] = await db.insert(clients).values({ id: crypto.randomUUID(), workspaceId: owner.workspaceId, name: "Invoice client", email: clientEmail }).returning();
    const [project] = await db.insert(projects).values({ id: crypto.randomUUID(), workspaceId: owner.workspaceId, clientId: client.id, name: "Client project" }).returning();
    const entry = await seedEntry(owner, { status: "approved", projectId: project.id, description: "Reviewed notes <script>alert('unsafe')</script>" });
    const responses = await Promise.all([
      page.request.post("/api/invoices", { data: { timeEntryIds: [entry.id] } }),
      page.request.post("/api/invoices", { data: { timeEntryIds: [entry.id] } }),
    ]);
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
    const invoice = (await responses.find((response) => response.ok())!.json()).invoice;
    expect(invoice.status).toBe("draft");
    expect(invoice.projectId).toBe(project.id);
    expect(invoice.amount).toBe(100);
    expect((await page.request.patch(`/api/invoices/${invoice.id}`, { data: { status: "paid" } })).status()).toBe(409);
    await login(page, workspace, "client", clientEmail);
    expect((await (await page.request.get("/api/client")).json()).invoices).toEqual([]);
    expect((await page.request.get(`/api/invoices/${invoice.id}/proof-pack`)).status()).toBe(404);
    await login(page, workspace);
    expect((await page.request.patch(`/api/invoices/${invoice.id}`, { data: { status: "sent" } })).ok()).toBeTruthy();
    expect((await page.request.patch(`/api/invoices/${invoice.id}`, { data: { status: "sent" } })).status()).toBe(409);
    await login(page, workspace, "member", `member-${workspace}@example.com`);
    expect((await page.request.patch(`/api/invoices/${invoice.id}`, { data: { status: "paid" } })).status()).toBe(403);
    await login(page, `foreign-${workspace}`);
    expect((await page.request.patch(`/api/invoices/${invoice.id}`, { data: { status: "paid" } })).status()).toBe(404);
    expect((await page.request.get(`/api/invoices/${invoice.id}/print`)).status()).toBe(404);
    await login(page, workspace, "client", `unrelated-${workspace}@example.com`);
    expect((await page.request.get(`/api/invoices/${invoice.id}/proof-pack`)).status()).toBe(404);
    expect((await page.request.post("/api/client/signoff", { data: { invoiceId: invoice.id, digest: "0".repeat(64) } })).status()).toBe(404);
    await login(page, workspace, "client", clientEmail);
    const proof = await (await page.request.get(`/api/invoices/${invoice.id}/proof-pack`)).json();
    expect(proof.proofPack.entries[0].description).toContain("Reviewed notes");
    expect((await page.request.post("/api/client/signoff", { data: { invoiceId: invoice.id } })).status()).toBe(400);
    expect((await page.request.post("/api/client/signoff", { data: { invoiceId: invoice.id, digest: "0".repeat(64) } })).status()).toBe(409);
    await gotoApp(page, "/client");
    await expect(page.getByRole("heading", { name: "Projects and invoices" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve this version" })).toHaveCount(0);
    await page.getByRole("button", { name: "Review invoice", exact: true }).click();
    await expect(page.getByRole("button", { name: "Approve this version" })).toBeDisabled();
    await expect(page.getByText("Reviewed notes <script>alert('unsafe')</script>", { exact: true })).toBeVisible();
    await page.getByLabel("I have reviewed the entries, rates and total shown above.").check();
    const approvalResponse = page.waitForResponse((response) => response.url().endsWith("/api/client/signoff") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Approve this version" }).click();
    const approve = await approvalResponse;
    expect(approve.ok(), await approve.text()).toBeTruthy();
    expect((await approve.json()).signoff.digest).toBe(proof.digest);
    await expect(page.getByText(/This version is approved/)).toBeVisible();
    expect((await page.request.post("/api/client/signoff", { data: { invoiceId: invoice.id, digest: proof.digest } })).ok()).toBeTruthy();
    const events = await db.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, owner.workspaceId), eq(auditLogs.timeEntryId, invoice.id), eq(auditLogs.eventType, "client_invoice_signed_off")));
    expect(events).toHaveLength(1);
    const signed = (events[0].diff as { clientSignoff: { after: { digest: string; snapshot: unknown } } }).clientSignoff.after;
    expect(signed.digest).toBe(proof.digest);
    expect(signed.snapshot).toEqual(proof.proofPack);
    const repeatedProof = await (await page.request.get(`/api/invoices/${invoice.id}/proof-pack`)).json();
    expect(repeatedProof.digest).toBe(proof.digest);
    const portal = await (await page.request.get("/api/client")).json();
    expect(portal.invoices[0]).toMatchObject({ approvedDigest: proof.digest, approvalCurrent: true });
    const printed = await page.request.get(`/api/invoices/${invoice.id}/print`);
    expect(printed.headers()["content-type"]).toContain("text/html");
    const html = await printed.text();
    expect(html).toContain("Only this invoice is printed.");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<nav");

    await db.update(projects).set({ name: "Updated project name" }).where(and(eq(projects.id, project.id), eq(projects.workspaceId, owner.workspaceId)));
    expect((await page.request.post("/api/client/signoff", { data: { invoiceId: invoice.id, digest: proof.digest } })).status()).toBe(409);
    const original = await (await page.request.get(`/api/invoices/${invoice.id}/proof-pack?approved=true`)).json();
    expect(original.digest).toBe(proof.digest);
    expect(original.proofPack).toEqual(proof.proofPack);
    await login(page, workspace);
    expect((await page.request.patch(`/api/invoices/${invoice.id}`, { data: { status: "paid" } })).ok()).toBeTruthy();
    expect((await page.request.patch(`/api/invoices/${invoice.id}`, { data: { status: "sent" } })).status()).toBe(409);
  });

  test("analytics exclude unavailable, external, busy and canceled blocks and lists paginate", async ({ page }) => {
    const workspace = `workflow-reports-${crypto.randomUUID()}`;
    const owner = await login(page, workspace);
    const entry = await seedEntry(owner, { durationSeconds: 1800, stoppedAt: at("09:30") });
    await seedEntry(owner, { startedAt: at("14:00"), stoppedAt: at("14:30"), durationSeconds: 1800 });
    const variants = [
      { title: "Planned work", tags: [], status: "planned" as const },
      { title: "Unavailable time", tags: ["unavailable"], status: "planned" as const },
      { title: "Imported meeting", tags: ["external-calendar"], status: "planned" as const },
      { title: "OOO", tags: ["ooo"], status: "planned" as const },
      { title: "Busy: appointment", tags: [], status: "planned" as const },
      { title: "Canceled plan", tags: [], status: "canceled" as const },
    ];
    await db.insert(scheduledWorkBlocks).values(variants.map((variant) => ({ id: crypto.randomUUID(), workspaceId: owner.workspaceId, userId: owner.userId, createdByUserId: owner.userId, startsAt: at("09:00"), endsAt: at("10:00"), ...variant })));
    const report = await (await page.request.get("/api/reports?start=2026-01-12&end=2026-01-12")).json();
    expect(report).toMatchObject({ plannedHours: 1, missedBlocks: 1, totalHours: 1, utilization: 1 });
    const first = await (await page.request.get("/api/timer/list?limit=1&offset=0")).json();
    expect(first).toMatchObject({ total: 2, hasMore: true });
    const second = await (await page.request.get("/api/timer/list?limit=1&offset=1")).json();
    expect(second).toMatchObject({ total: 2, hasMore: false });
    expect(second.entries[0].id).toBe(entry.id);
    const filtered = await (await page.request.get("/api/timer/list?from=2026-01-12T08:00:00Z&to=2026-01-12T10:00:00Z")).json();
    expect(filtered.total).toBe(1);
    expect((await page.request.get("/api/timer/list?limit=-1")).status()).toBe(400);
    expect((await page.request.get("/api/reports?start=invalid")).status()).toBe(400);
  });
});
