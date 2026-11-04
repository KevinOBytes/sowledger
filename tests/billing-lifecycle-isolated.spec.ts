/* eslint-disable @typescript-eslint/no-explicit-any -- Complete provider-boundary synthetic objects. */
import { expect, test } from "@playwright/test";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../lib/db";
import { workspaces, workspaceBillingState, billingPaymentFailures, stripeWebhookEvents, users, memberships } from "../lib/db/schema";
import { billingFixture } from "./helpers/billing-lifecycle-fixture";
test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe("durable billing actual handler and PostgreSQL", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Validated disposable database only");
  const owned: string[] = [];
  test.afterEach(async () => { for (const id of owned.splice(0)) await db.delete(workspaces).where(eq(workspaces.id, id)); });
  async function fixture() {
    const id = crypto.randomUUID(), sub = `sub_${id}`, customer = `cus_${id}`;
    await db.insert(workspaces).values({ id, name: "Isolated billing", slug: id, plan: "pro", stripeSubscriptionId: sub, stripeCustomerId: customer }); owned.push(id);
    const f = billingFixture();
    const subscription: any = { id: sub, customer, status: "active", metadata: { workspaceId: id }, latest_invoice: "in_paid", items: { data: [{ price: { id: "price_synthetic_pro" }, current_period_end: 1800000000 }] } };
    function invoice(invoiceId: string, status: string, attempt = 1) { const value = { id: invoiceId, customer, status, billing_reason: "subscription_cycle", attempt_count: attempt, parent: { type: "subscription_details", subscription_details: { subscription: sub } }, status_transitions: { paid_at: status === "paid" ? 1790000000 : null } }; f.invoices.set(invoiceId, value); return value; }
    invoice("in_paid", "paid"); f.subscriptions.set(sub, subscription);
    let seq = 0;
    function event(type: string, object: any = subscription, created = 1793376000) { return { id: `evt_${id}_${seq++}`, type, created, data: { object } }; }
    const read = async () => (await db.select().from(workspaceBillingState).where(eq(workspaceBillingState.workspaceId, id)))[0];
    const receipts = () => db.select().from(stripeWebhookEvents).where(eq(stripeWebhookEvents.workspaceId, id));
    async function active() { expect((await f.deliver(event("customer.subscription.updated"))).status).toBe(200); }
    async function fail(attempt = 1, created = 1793376000) { const value = invoice("in_failed", "open", attempt); subscription.status = "past_due"; subscription.latest_invoice = "in_failed"; const e = event("invoice.payment_failed", value, created); expect((await f.deliver(e)).status).toBe(200); return e; }
    return { ...f, id, sub, customer, subscription, invoice, event, read, receipts, active, fail };
  }
  async function deliverBounded(f: Awaited<ReturnType<typeof fixture>>, event: any) {
    f.state.reads = 0;
    const response = await f.deliver(event);
    expect(f.state.reads).toBeLessThanOrEqual(8);
    return response;
  }
  async function seedDebt(f: Awaited<ReturnType<typeof fixture>>, count: number, unknownLast = false) {
    const ids: string[] = [];
    for (let index = 0; index < count; index++) {
      const id = `in_backlog_${String(index).padStart(3, "0")}`; ids.push(id);
      f.invoice(id, unknownLast && index === count - 1 ? "open" : "paid");
      await db.insert(billingPaymentFailures).values({ workspaceId: f.id, invoiceId: id, subscriptionId: f.sub, firstFailedAt: unknownLast && index === count - 1 ? null : new Date("2026-10-01T00:00:00Z") });
    }
    return ids;
  }
  const debts = (f: Awaited<ReturnType<typeof fixture>>) => db.select().from(billingPaymentFailures).where(eq(billingPaymentFailures.workspaceId, f.id));
  test("first renewal failure persists once, duplicate/retry cannot extend and expiry is enforced on read", async () => {
    const f = await fixture(); await f.active(); const event = await f.fail();
    const first = await f.read(); expect(first.graceEndsAt?.toISOString()).toBe("2026-11-06T16:00:00.000Z");
    expect((await f.deliver(event)).status).toBe(200); await f.fail(2, 1793808000);
    expect((await f.read()).graceEndsAt).toEqual(first.graceEndsAt); expect(await f.receipts()).toHaveLength(3);
    await db.update(workspaceBillingState).set({ graceStartedAt: new Date("2000-01-01"), graceEndsAt: new Date("2000-01-08") }).where(eq(workspaceBillingState.workspaceId, f.id));
    expect((await f.load("@/lib/billing").resolveWorkspacePlan(f.id)).plan).toBe("free");
  });
  test("unknown first retry gets no deadline, delayed first event establishes original anchor", async () => {
    const f = await fixture(); await f.active(); await f.fail(2, 1793808000); expect((await f.read()).graceEndsAt).toBeNull();
    const [unknown] = await db.select().from(billingPaymentFailures).where(and(eq(billingPaymentFailures.workspaceId, f.id), eq(billingPaymentFailures.invoiceId, "in_failed")));
    expect(unknown).toMatchObject({ invoiceId: "in_failed", firstFailedAt: null, resolvedAt: null });
    await f.fail(); expect((await f.read()).graceEndsAt?.toISOString()).toBe("2026-11-06T16:00:00.000Z");
  });
  test("unknown unpaid A survives failed B rollover; authentic A first event restores only original deadline", async () => {
    const f = await fixture(); await f.active(); await f.fail(2, 1793808000);
    const b = f.invoice("in_rollover_B", "open"); f.subscription.latest_invoice = b.id;
    expect((await f.deliver(f.event("invoice.payment_failed", b, 1795996800))).status).toBe(200);
    expect((await f.read()).graceEndsAt).toBeNull();
    const rows = await db.select().from(billingPaymentFailures).where(eq(billingPaymentFailures.workspaceId, f.id));
    expect(rows).toHaveLength(2); expect(rows.find(row => row.invoiceId === "in_failed")?.firstFailedAt).toBeNull();
    expect(rows.find(row => row.invoiceId === b.id)?.firstFailedAt).not.toBeNull();
    const aFirst = { ...f.invoices.get("in_failed"), attempt_count: 1 };
    expect((await f.deliver(f.event("invoice.payment_failed", aFirst, 1793376000))).status).toBe(200);
    expect((await f.read()).graceEndsAt?.toISOString()).toBe("2026-11-06T16:00:00.000Z");
    const [anchored] = await db.select().from(billingPaymentFailures).where(and(eq(billingPaymentFailures.workspaceId, f.id), eq(billingPaymentFailures.invoiceId, "in_failed")));
    expect(anchored.firstFailedAt?.toISOString()).toBe("2026-10-30T16:00:00.000Z");
  });
  test("paid B cannot hide unknown unpaid A; verified A payment resolves unknown row and restores access", async () => {
    const f = await fixture(); await f.active(); await f.fail(2, 1793808000);
    const b = f.invoice("in_paid_rollover_B", "paid"); f.subscription.latest_invoice = b.id; f.subscription.status = "active";
    expect((await f.deliver(f.event("invoice.paid", b))).status).toBe(200);
    expect((await f.read()).status).toBe("payment_required"); expect((await f.read()).graceEndsAt).toBeNull();
    expect((await f.load("@/lib/billing").resolveWorkspacePlan(f.id)).plan).toBe("free");
    const a = f.invoice("in_failed", "paid");
    expect((await f.deliver(f.event("invoice.paid", a))).status).toBe(200);
    expect((await f.read()).status).toBe("active"); expect((await f.load("@/lib/billing").resolveWorkspacePlan(f.id)).plan).toBe("pro");
    const [resolved] = await db.select().from(billingPaymentFailures).where(and(eq(billingPaymentFailures.workspaceId, f.id), eq(billingPaymentFailures.invoiceId, "in_failed")));
    expect(resolved.firstFailedAt).toBeNull(); expect(resolved.resolvedAt).not.toBeNull();
  });
  test("unknown evidence insertion and resolution roll back when final receipt fails", async () => {
    const f = await fixture(); await f.active();
    const a = f.invoice("in_failed", "open", 2); f.subscription.status = "past_due"; f.subscription.latest_invoice = a.id;
    const invalidReceipt = { ...f.event("invoice.payment_failed", a), id: "x".repeat(256) };
    expect((await f.deliver(invalidReceipt)).status).toBe(500);
    expect(await db.select().from(billingPaymentFailures).where(eq(billingPaymentFailures.workspaceId, f.id))).toHaveLength(0);
    await f.fail(2); const receipts = (await f.receipts()).length;
    f.invoice("in_failed", "paid"); f.subscription.status = "active";
    expect((await f.deliver({ ...f.event("invoice.paid", f.invoices.get("in_failed")), id: "y".repeat(256) })).status).toBe(500);
    const [unknown] = await db.select().from(billingPaymentFailures).where(eq(billingPaymentFailures.workspaceId, f.id));
    expect(unknown.firstFailedAt).toBeNull(); expect(unknown.resolvedAt).toBeNull(); expect(await f.receipts()).toHaveLength(receipts);
    expect((await f.read()).status).toBe("past_due");
  });
  test("same-second stale paid event cannot recover current debt; current payment resolves failure and old failure cannot reopen", async () => {
    const f = await fixture(); await f.active(); const failure = await f.fail();
    expect((await f.deliver(f.event("invoice.paid", f.invoices.get("in_paid")))).status).toBe(200); expect((await f.read()).graceEndsAt).not.toBeNull();
    f.subscription.status = "active"; f.invoice("in_failed", "paid");
    expect((await f.deliver(f.event("invoice.paid", f.invoices.get("in_failed")))).status).toBe(200);
    expect((await f.read()).graceEndsAt).toBeNull(); expect((await f.deliver({ ...failure, id: `${failure.id}_late` })).status).toBe(200);
    expect((await f.read()).graceEndsAt).toBeNull();
    const [resolved] = await db.select().from(billingPaymentFailures).where(and(eq(billingPaymentFailures.workspaceId, f.id), eq(billingPaymentFailures.invoiceId, "in_failed"))); expect(resolved.resolvedAt).not.toBeNull();
  });
  test("a late first failure for an older unpaid invoice shortens grace; paying only the latest invoice does not recover older debt", async () => {
    const f = await fixture(); await f.active(); await f.fail();
    const old = f.invoice("in_older_unpaid", "open");
    expect((await f.deliver(f.event("invoice.payment_failed", old, 1793289600))).status).toBe(200);
    expect((await f.read()).graceEndsAt?.toISOString()).toBe("2026-11-05T16:00:00.000Z");
    expect((await f.read()).graceInvoiceId).toBe("in_older_unpaid");
    f.subscription.status = "active"; f.invoice("in_failed", "paid");
    expect((await f.deliver(f.event("invoice.paid", f.invoices.get("in_failed")))).status).toBe(200);
    expect((await f.read()).status).toBe("payment_required"); expect((await f.read()).graceEndsAt).not.toBeNull();
    f.invoice("in_older_unpaid", "paid");
    expect((await f.deliver(f.event("invoice.paid", f.invoices.get("in_older_unpaid")))).status).toBe(200);
    expect((await f.read()).status).toBe("active"); expect((await f.read()).graceEndsAt).toBeNull();
  });
  test("terminal cancellation clears active checkout fields; late events cannot resurrect, verified new checkout can replace binding", async () => {
    const f = await fixture(); await f.active(); f.subscription.status = "canceled";
    expect((await f.deliver(f.event("customer.subscription.deleted"))).status).toBe(200);
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, f.id)); expect(workspace.stripeSubscriptionId).toBeNull(); expect(workspace.plan).toBe("free");
    f.subscription.status = "active"; expect((await f.deliver(f.event("customer.subscription.updated"))).status).toBe(200); expect((await f.read()).status).toBe("canceled");
    const newSub = { ...f.subscription, id: `${f.sub}_new` }; f.subscriptions.set(newSub.id, newSub);
    expect((await f.deliver(f.event("customer.subscription.created", newSub))).status).toBe(500);
    const checkout = { id: `cs_${f.id}`, mode: "subscription", status: "complete", subscription: newSub.id, customer: f.customer, client_reference_id: f.id, metadata: { workspaceId: f.id } }; f.sessions.set(checkout.id, checkout);
    // A subscription's latest invoice must also belong to that subscription.
    newSub.latest_invoice = `in_${f.id}_new`; f.invoices.set(newSub.latest_invoice, { ...f.invoices.get("in_paid"), id: newSub.latest_invoice, parent: { type: "subscription_details", subscription_details: { subscription: newSub.id } } });
    expect((await f.deliver(f.event("checkout.session.completed", checkout))).status).toBe(200); expect((await f.read()).subscriptionId).toBe(newSub.id);
    expect((await f.deliver(f.event("customer.subscription.updated"))).status).toBe(200); expect((await f.read()).subscriptionId).toBe(newSub.id);
  });
  test("provider failure rolls back receipt; retry succeeds", async () => {
    const f = await fixture(); const e = f.event("customer.subscription.updated"); f.state.fail = true;
    expect((await f.deliver(e)).status).toBe(500); expect(await f.receipts()).toHaveLength(0); expect(await f.read()).toBeUndefined();
    f.state.fail = false; expect((await f.deliver(e)).status).toBe(200); expect(await f.receipts()).toHaveLength(1);
  });
  test("receipt storage failure rolls back preceding state and plan writes", async () => {
    const f = await fixture();
    const e = { ...f.event("customer.subscription.updated"), id: "x".repeat(256) };
    expect((await f.deliver(e)).status).toBe(500); expect(await f.read()).toBeUndefined(); expect(await f.receipts()).toHaveLength(0);
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, f.id)); expect(workspace.stripePriceId).toBeNull();
  });
  test("final-wave: seven signed renewal failures reach rollover and the same uncompleted event makes bounded recovery progress", async () => {
    const f = await fixture(); await f.active();
    const ids: string[] = [];
    for (let index = 0; index < 7; index++) {
      const id = `in_renewal_${index}`; ids.push(id);
      const invoice = f.invoice(id, "open"); f.subscription.status = "past_due"; f.subscription.latest_invoice = id;
      expect((await deliverBounded(f, f.event("invoice.payment_failed", invoice, 1793376000 + index * 3600))).status).toBe(200);
    }
    const before = await f.read(); expect(await debts(f)).toHaveLength(7);
    expect(before.graceEndsAt?.toISOString()).toBe("2026-11-06T16:00:00.000Z");
    for (const id of ids) f.invoice(id, "paid");
    const latest = f.invoice("in_eighth", "paid"); f.subscription.latest_invoice = latest.id; f.subscription.status = "active";
    const event = f.event("invoice.paid", latest), receiptCount = (await f.receipts()).length;
    expect((await deliverBounded(f, event)).status).toBe(503);
    const partial = await f.read(); expect(partial.status).toBe("reconciliation_pending");
    expect(partial.graceStartedAt).toEqual(before.graceStartedAt); expect(partial.graceEndsAt).toBeNull();
    expect((await f.load("@/lib/billing").resolveWorkspacePlan(f.id)).plan).toBe("free");
    const resolved = (await debts(f)).filter(row => row.resolvedAt); expect(resolved.length).toBeGreaterThan(0); expect(resolved.length).toBeLessThan(7);
    expect(await f.receipts()).toHaveLength(receiptCount);
    expect((await deliverBounded(f, event)).status).toBe(200);
    expect((await debts(f)).every(row => row.resolvedAt !== null)).toBe(true);
    expect((await f.read()).status).toBe("active"); expect((await f.read()).graceEndsAt).toBeNull();
    expect((await f.load("@/lib/billing").resolveWorkspacePlan(f.id)).plan).toBe("pro");
    expect(await f.receipts()).toHaveLength(receiptCount + 1);
    expect((await deliverBounded(f, event)).status).toBe(200); expect(f.state.reads).toBe(0);
  });
  test("final-wave: larger seeded paid history drains in bounded batches, not a permanent rejection", async () => {
    const f = await fixture(); await f.active(); await seedDebt(f, 20);
    const event = f.event("customer.subscription.updated"), receiptCount = (await f.receipts()).length;
    let completed = false, pending = 0, previousResolved = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await deliverBounded(f, event);
      const resolved = (await debts(f)).filter(row => row.resolvedAt).length;
      expect(resolved).toBeGreaterThan(previousResolved); previousResolved = resolved;
      if (response.status === 200) { completed = true; break; }
      expect(response.status).toBe(503); pending++;
      expect((await f.read()).status).toBe("reconciliation_pending");
      expect((await f.load("@/lib/billing").resolveWorkspacePlan(f.id)).plan).toBe("free");
      expect(await f.receipts()).toHaveLength(receiptCount);
    }
    expect(completed).toBe(true); expect(pending).toBeGreaterThan(1); expect(previousResolved).toBe(20);
    expect((await f.load("@/lib/billing").resolveWorkspacePlan(f.id)).plan).toBe("pro");
    expect(await f.receipts()).toHaveLength(receiptCount + 1);
  });
  for (const canonicalStatus of ["active", "trialing"]) test(`final-wave: ${canonicalStatus} cannot hide unread or unknown unpaid debt`, async () => {
    const f = await fixture(); await f.active(); await f.fail();
    const original = await f.read(); f.invoice("in_failed", "paid");
    const ids = await seedDebt(f, 17, true); f.subscription.status = canonicalStatus;
    const event = f.event("customer.subscription.updated"), receiptCount = (await f.receipts()).length;
    expect((await deliverBounded(f, event)).status).toBe(503);
    const partial = await f.read(); expect(partial.status).toBe("reconciliation_pending");
    expect(partial.graceStartedAt!.getTime()).toBeLessThanOrEqual(original.graceStartedAt!.getTime()); expect(partial.graceEndsAt).toBeNull();
    expect((await f.load("@/lib/billing").resolveWorkspacePlan(f.id)).plan).toBe("free");
    expect(await f.receipts()).toHaveLength(receiptCount);
    // The override remains effective even while the underlying state is pending.
    const userId = crypto.randomUUID();
    await db.insert(users).values({ id: userId, email: `${" ".repeat(10 + Math.floor(Math.random() * 150))}KEVIN@TKORESEARCH.COM` });
    try { await db.insert(memberships).values({ workspaceId: f.id, userId, role: "owner" }); expect((await f.load("@/lib/billing").resolveWorkspacePlan(f.id)).plan).toBe("enterprise"); }
    finally { await db.delete(users).where(eq(users.id, userId)); }
    let response = await deliverBounded(f, event);
    for (let attempt = 0; response.status === 503 && attempt < 3; attempt++) response = await deliverBounded(f, event);
    expect(response.status).toBe(200);
    expect((await f.read()).status).toBe("payment_required"); expect((await f.read()).graceEndsAt).toBeNull();
    expect((await f.load("@/lib/billing").resolveWorkspacePlan(f.id)).plan).toBe("free");
    const unknown = (await debts(f)).find(row => row.invoiceId === ids.at(-1)); expect(unknown?.firstFailedAt).toBeNull(); expect(unknown?.resolvedAt).toBeNull();
    f.subscription.status = "active"; const paid = f.invoice(ids.at(-1)!, "paid");
    expect((await deliverBounded(f, f.event("invoice.paid", paid))).status).toBe(200);
    expect((await f.load("@/lib/billing").resolveWorkspacePlan(f.id)).plan).toBe("pro");
  });
  test("final-wave: cancellation bypasses unavailable invoice debt and unavailable price before verified new checkout", async () => {
    const f = await fixture(); await f.active(); await seedDebt(f, 20);
    f.subscription.status = "canceled"; f.subscription.items.data[0].price.id = "price_retired_unoffered";
    f.invoices.clear();
    expect((await deliverBounded(f, f.event("customer.subscription.deleted"))).status).toBe(200); expect(f.state.reads).toBe(1);
    expect((await debts(f)).every(row => row.resolvedAt === null)).toBe(true);
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, f.id));
    expect(workspace).toMatchObject({ plan: "free", stripeSubscriptionId: null, stripePriceId: null, stripeCurrentPeriodEnd: null });
    expect((await f.read()).status).toBe("canceled");
    const newSub = structuredClone(f.subscription); newSub.id = `${f.sub}_new`; newSub.status = "active"; newSub.latest_invoice = "in_new_checkout";
    newSub.items.data[0].price.id = "price_synthetic_pro"; f.subscriptions.set(newSub.id, newSub);
    const checkout = { id: `cs_${f.id}`, mode: "subscription", status: "complete", subscription: newSub.id, customer: f.customer, client_reference_id: f.id, metadata: { workspaceId: f.id } }; f.sessions.set(checkout.id, checkout);
    expect((await deliverBounded(f, f.event("customer.subscription.created", newSub))).status).toBe(500);
    const event = f.event("checkout.session.completed", checkout);
    // A verified checkout still cannot grant access without its own paid invoice.
    expect((await deliverBounded(f, event)).status).toBe(500); expect((await f.read()).status).toBe("canceled");
    f.invoices.set(newSub.latest_invoice, { ...f.invoice("in_template", "paid"), id: newSub.latest_invoice, parent: { type: "subscription_details", subscription_details: { subscription: newSub.id } } });
    expect((await deliverBounded(f, event)).status).toBe(200);
    expect((await f.read()).subscriptionId).toBe(newSub.id); expect((await f.load("@/lib/billing").resolveWorkspacePlan(f.id)).plan).toBe("pro");
    expect((await debts(f)).every(row => row.resolvedAt === null)).toBe(true);
    f.subscription.status = "active";
    expect((await deliverBounded(f, f.event("customer.subscription.updated"))).status).toBe(200); expect(f.state.reads).toBe(0);
    expect((await f.read()).subscriptionId).toBe(newSub.id);
  });
  test("final-wave: actual storage failure rolls back a pending batch and identical-event retry continues", async () => {
    const f = await fixture(); await f.active(); await seedDebt(f, 12);
    const before = await f.read(), receiptCount = (await f.receipts()).length, event = f.event("customer.subscription.updated");
    f.state.commitFault = "postgres-division-by-zero";
    expect((await deliverBounded(f, event)).status).toBe(500);
    expect((await debts(f)).every(row => row.resolvedAt === null)).toBe(true); expect(await f.read()).toEqual(before); expect(await f.receipts()).toHaveLength(receiptCount);
    f.state.commitFault = null;
    expect((await deliverBounded(f, event)).status).toBe(503);
    expect((await debts(f)).some(row => row.resolvedAt !== null)).toBe(true); expect(await f.receipts()).toHaveLength(receiptCount);
    expect((await deliverBounded(f, event)).status).toBe(200); expect((await f.read()).status).toBe("active");
  });
  test("final-wave: genuine provider error and elapsed deadline roll back in-request progress and remain retryable", async () => {
    const f = await fixture(); await f.active(); await seedDebt(f, 12);
    const before = await f.read(), receiptCount = (await f.receipts()).length, event = f.event("customer.subscription.updated");
    f.state.beforeRead = async () => { if (f.state.reads === 5) throw new Error("synthetic provider outage after earlier paid reads"); };
    expect((await deliverBounded(f, event)).status).toBe(500);
    expect((await debts(f)).every(row => row.resolvedAt === null)).toBe(true); expect(await f.read()).toEqual(before); expect(await f.receipts()).toHaveLength(receiptCount);
    f.state.beforeRead = async () => { if (f.state.reads === 5) f.state.clockOffsetMs = 12_001; };
    expect((await deliverBounded(f, event)).status).toBe(500); expect(f.state.reads).toBe(5);
    expect((await debts(f)).every(row => row.resolvedAt === null)).toBe(true); expect(await f.read()).toEqual(before); expect(await f.receipts()).toHaveLength(receiptCount);
    f.state.clockOffsetMs = 0; f.state.beforeRead = null;
    expect((await deliverBounded(f, event)).status).toBe(503); expect((await deliverBounded(f, event)).status).toBe(200);
    expect((await f.load("@/lib/billing").resolveWorkspacePlan(f.id)).plan).toBe("pro");
  });
  test("ambiguous customer and conflicting metadata cannot update either workspace", async () => {
    const f = await fixture(), other = crypto.randomUUID(); owned.push(other);
    await db.insert(workspaces).values({ id: other, name: "Ambiguous billing", slug: other, stripeCustomerId: f.customer });
    expect((await f.deliver(f.event("customer.subscription.updated"))).status).toBe(500); expect(await f.read()).toBeUndefined();
    await db.update(workspaces).set({ stripeCustomerId: null }).where(eq(workspaces.id, other));
    f.subscription.metadata.workspaceId = other;
    expect((await f.deliver(f.event("customer.subscription.updated"))).status).toBe(500); expect(await f.receipts()).toHaveLength(0);
  });
  test("unpaid preserves proven deadline; internal override still wins over expired effective access", async () => {
    const f = await fixture(); await f.active(); await f.fail(); const deadline = (await f.read()).graceEndsAt;
    f.subscription.status = "unpaid"; expect((await f.deliver(f.event("customer.subscription.updated"))).status).toBe(200); expect((await f.read()).graceEndsAt).toEqual(deadline);
    await db.update(workspaceBillingState).set({ graceStartedAt: new Date("2000-01-01"), graceEndsAt: new Date("2000-01-08") }).where(eq(workspaceBillingState.workspaceId, f.id));
    const userId = crypto.randomUUID();
    await db.insert(users).values({ id: userId, email: `${" ".repeat(10 + Math.floor(Math.random() * 150))}KEVIN@TKORESEARCH.COM` });
    try { await db.insert(memberships).values({ workspaceId: f.id, userId, role: "owner" }); expect((await f.load("@/lib/billing").resolveWorkspacePlan(f.id)).plan).toBe("enterprise"); }
    finally { await db.delete(users).where(eq(users.id, userId)); }
  });
  test("concurrent duplicates wait on actual workspace lock before provider reads and yield one receipt", async () => {
    const f = await fixture(), e = f.event("customer.subscription.updated");
    let release!: () => void, reached!: () => void; const held = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { reached = r; });
    const locker = db.transaction(async tx => { await tx.select().from(workspaces).where(eq(workspaces.id, f.id)).for("update"); reached(); await held; }); await ready;
    const a = f.deliver(e), b = f.deliver(e), settled = Promise.all([a, b]);
    try { await expect.poll(async () => { const rows = await db.execute(sql`select count(*)::int as waiting from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`); return Number(rows.rows[0].waiting); }).toBeGreaterThanOrEqual(2); expect(f.state.reads).toBe(0); }
    finally { release(); await locker; }
    expect((await settled).map(r => r.status)).toEqual([200, 200]); expect(await f.receipts()).toHaveLength(1);
  });
});
