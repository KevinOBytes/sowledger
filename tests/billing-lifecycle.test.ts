import test from "node:test";
import assert from "node:assert/strict";
import { billingFixture } from "./helpers/billing-lifecycle-fixture";
import type * as Policy from "../lib/billing-lifecycle";

async function policy() {
  const loaded = await import("../lib/billing-lifecycle").catch(() => ({} as typeof Policy));
  assert.equal(typeof loaded.reconcileBillingLifecycle, "function", "durable renewal policy must exist");
  return loaded;
}
const date = (value: string) => new Date(value);
const first = date("2026-10-30T16:00:00Z");
const previous: Policy.BillingLifecycleState = { subscriptionId: "sub_current", customerId: "cus_current", plan: "pro", status: "active", everActiveAt: date("2026-09-01T10:00:00Z"), latestInvoiceId: "in_previous", graceInvoiceId: null, graceStartedAt: null, graceEndsAt: null };
const observation = { subscriptionId: "sub_current", customerId: "cus_current", plan: "pro", status: "past_due", latestInvoiceId: "in_current", latestInvoicePaid: false, renewal: true, priorPaidAt: null, failure: { invoiceId: "in_current", firstAttempt: true, occurredAt: first }, now: first } satisfies Policy.BillingObservation;

test("verified renewal preserves paid access until exact elapsed seven-day UTC deadline across DST", async () => {
  const p = await policy();
  const result = p.reconcileBillingLifecycle(previous, observation, null);
  assert.equal(result.state.graceEndsAt?.toISOString(), "2026-11-06T16:00:00.000Z");
  assert.equal(p.resolveBillingEntitlement("pro", result.state, date("2026-11-06T15:59:59.999Z")).plan, "pro");
  assert.equal(p.resolveBillingEntitlement("pro", result.state, date("2026-11-06T16:00:00Z")).plan, "free");
});
test("retries cannot extend and earlier confirmed first attempts shorten persisted anchors", async () => {
  const p = await policy();
  const known = { invoiceId: "in_current", firstFailedAt: first, resolvedAt: null };
  const retry = p.reconcileBillingLifecycle(previous, { ...observation, failure: { invoiceId: "in_current", firstAttempt: false, occurredAt: date("2026-11-04T16:00:00Z") } }, known);
  assert.equal(retry.state.graceEndsAt?.toISOString(), "2026-11-06T16:00:00.000Z");
  const earlier = p.reconcileBillingLifecycle(previous, { ...observation, failure: { ...observation.failure, occurredAt: date("2026-10-29T16:00:00Z") } }, known);
  assert.equal(earlier.state.graceEndsAt?.toISOString(), "2026-11-05T16:00:00.000Z");
});
test("an earlier unresolved renewal invoice shortens a newer anchor rather than sliding debt across invoices", async () => {
  const p = await policy();
  const current = p.reconcileBillingLifecycle(previous, observation, null).state;
  const older = p.reconcileBillingLifecycle(current, { ...observation, failure: { invoiceId: "in_older_unpaid", firstAttempt: true, occurredAt: date("2026-10-29T16:00:00Z") } }, null);
  assert.equal(older.state.graceEndsAt?.toISOString(), "2026-11-05T16:00:00.000Z");
  assert.equal(older.failure?.invoiceId, "in_older_unpaid");
});
test("initial, unknown prior history and first-observed retries get no invented grace", async () => {
  const p = await policy();
  for (const input of [{ ...observation, renewal: false }, { ...observation, failure: { ...observation.failure, firstAttempt: false } }]) {
    const result = p.reconcileBillingLifecycle(null, input, null);
    assert.equal(result.state.graceEndsAt, null);
    assert.equal(p.resolveBillingEntitlement("pro", result.state, first).plan, "free");
  }
  assert.equal(p.reconcileBillingLifecycle(null, observation, null).state.graceEndsAt, null);
  assert.equal(p.reconcileBillingLifecycle(null, { ...observation, priorPaidAt: date("2026-09-30T10:00:00Z") }, null).state.graceEndsAt?.toISOString(), "2026-11-06T16:00:00.000Z");
});
test("unknown first-attempt time still retains the exact unpaid invoice identity", async () => {
  const p = await policy();
  const result = p.reconcileBillingLifecycle(previous, { ...observation, failure: { ...observation.failure, firstAttempt: false } }, null);
  assert.deepEqual(result.failure, { invoiceId: "in_current", firstFailedAt: null, resolvedAt: null });
  assert.equal(result.state.graceEndsAt, null);
});
test("unknown unpaid A blocks a new B grace window across invoice rollover", async () => {
  const p = await policy();
  const unknownA = { invoiceId: "in_A", firstFailedAt: null, resolvedAt: null };
  const result = p.reconcileBillingLifecycle(previous, { ...observation, latestInvoiceId: "in_B", unresolvedFailures: [unknownA], failure: { invoiceId: "in_B", firstAttempt: true, occurredAt: date("2026-11-30T00:00:00Z") } }, null);
  assert.equal(result.state.graceEndsAt, null);
  assert.equal(p.resolveBillingEntitlement("pro", result.state, date("2026-12-01T00:00:00Z")).plan, "free");
});
test("paid active B cannot recover while unknown unpaid A survives rollover", async () => {
  const p = await policy();
  const unknownA = { invoiceId: "in_A", firstFailedAt: null, resolvedAt: null };
  for (const status of ["active", "trialing"]) {
    const result = p.reconcileBillingLifecycle(previous, { ...observation, status, latestInvoiceId: "in_B", latestInvoicePaid: true, unresolvedFailures: [unknownA], failure: null }, null);
    assert.equal(result.recovered, false);
    assert.equal(p.resolveBillingEntitlement("pro", result.state, first).plan, "free", status);
  }
});
test("delayed A anchor restores its original deadline without extending a known B anchor", async () => {
  const p = await policy();
  const unknownA = { invoiceId: "in_A", firstFailedAt: null, resolvedAt: null };
  const knownB = { invoiceId: "in_B", firstFailedAt: date("2026-11-30T00:00:00Z"), resolvedAt: null };
  const result = p.reconcileBillingLifecycle(previous, { ...observation, latestInvoiceId: "in_B", unresolvedFailures: [unknownA, knownB], failure: { invoiceId: "in_A", firstAttempt: true, occurredAt: first } }, unknownA);
  assert.equal(result.failure?.firstFailedAt?.toISOString(), "2026-10-30T16:00:00.000Z");
  assert.equal(result.state.graceEndsAt?.toISOString(), "2026-11-06T16:00:00.000Z");
  const later = p.reconcileBillingLifecycle(previous, { ...observation, latestInvoiceId: "in_B", unresolvedFailures: [unknownA, knownB], failure: { invoiceId: "in_A", firstAttempt: true, occurredAt: date("2026-12-01T00:00:00Z") } }, unknownA);
  assert.equal(later.state.graceEndsAt?.toISOString(), "2026-12-07T00:00:00.000Z");
});
test("terminal statuses deny despite a valid old grace window", async () => {
  const p = await policy();
  for (const status of ["canceled", "incomplete_expired", "incomplete", "paused", "unknown"]) {
    const result = p.reconcileBillingLifecycle(previous, { ...observation, status }, null);
    assert.equal(p.resolveBillingEntitlement("pro", result.state, first).plan, "free", status);
  }
});
test("retry exhaustion cannot shorten proven seven-day grace, but unpaid without proof denies", async () => {
  const p = await policy();
  const delinquent = p.reconcileBillingLifecycle(previous, observation, null).state;
  const unpaid = p.reconcileBillingLifecycle(delinquent, { ...observation, status: "unpaid", failure: null }, null).state;
  assert.equal(p.resolveBillingEntitlement("pro", unpaid, date("2026-10-31T16:00:00Z")).plan, "pro");
  assert.equal(p.resolveBillingEntitlement("pro", unpaid, date("2026-11-06T16:00:00Z")).plan, "free");
  assert.equal(p.resolveBillingEntitlement("pro", { ...previous, status: "unpaid" }, first).plan, "free");
});
test("only current canonical active and paid recovers; resolved old failures never reopen", async () => {
  const p = await policy();
  const delinquent = p.reconcileBillingLifecycle(previous, observation, null).state;
  const unpaid = p.reconcileBillingLifecycle(delinquent, { ...observation, status: "active", failure: null }, null);
  assert.equal(p.resolveBillingEntitlement("pro", unpaid.state, date("2026-11-07T16:00:00Z")).plan, "free");
  const recovered = p.reconcileBillingLifecycle(delinquent, { ...observation, status: "active", latestInvoicePaid: true, failure: null }, null);
  assert.equal(recovered.state.graceEndsAt, null);
  assert.equal(p.resolveBillingEntitlement("pro", recovered.state, date("2026-11-07T16:00:00Z")).plan, "pro");
  const resolved = { invoiceId: "in_current", firstFailedAt: first, resolvedAt: date("2026-11-01T10:00:00Z") };
  assert.equal(p.reconcileBillingLifecycle(recovered.state, observation, resolved).state.graceEndsAt, null);
});
test("legacy absence preserves stored plan; tracked unknown status denies", async () => {
  const p = await policy();
  assert.equal(p.resolveBillingEntitlement("smb", null, first).plan, "smb");
  assert.equal(p.resolveBillingEntitlement("smb", { ...previous, status: "unknown" }, first).plan, "free");
});
test("actual handler rejects invalid signatures without leaking verification details", async () => {
  const fixture = billingFixture();
  const response = await fixture.deliver({}, "invalid");
  assert.equal(response.status, 400);
  assert.equal(await response.text(), "Invalid Stripe signature");
  assert.equal(fixture.state.reads, 0);
});

test("unread debt persists reconciliation_pending and denies active/trialing access without moving the grace anchor", async () => {
  const p = await policy();
  const grace = p.reconcileBillingLifecycle(previous, observation, null).state;
  for (const status of ["active", "trialing", "past_due", "unpaid"]) {
    const pendingObservation = { ...observation, status, latestInvoicePaid: true, failure: null, hasUnreadDebt: true };
    const result = p.reconcileBillingLifecycle(grace, pendingObservation, null);
    assert.equal(result.state.status, "reconciliation_pending", status);
    assert.equal(result.recovered, false);
    assert.equal(result.state.graceStartedAt?.toISOString(), first.toISOString());
    assert.equal(result.state.graceInvoiceId, "in_current");
    assert.equal(result.state.graceEndsAt, null);
    assert.equal(p.resolveBillingEntitlement("pro", result.state, first).plan, "free");
  }
});
test("pending verification can shorten but never extend its retained anchor and finalizes to unpaid or paid normally", async () => {
  const p = await policy();
  const grace = p.reconcileBillingLifecycle(previous, observation, null).state;
  const pendingObservation = { ...observation, status: "active", latestInvoicePaid: true, hasUnreadDebt: true, failure: { invoiceId: "in_earlier", firstAttempt: true, occurredAt: date("2026-10-29T16:00:00Z") } };
  const pending = p.reconcileBillingLifecycle(grace, pendingObservation, null).state;
  assert.equal(pending.status, "reconciliation_pending");
  assert.equal(pending.graceStartedAt?.toISOString(), "2026-10-29T16:00:00.000Z");
  assert.equal(pending.graceEndsAt, null);
  const unpaid = { invoiceId: "in_earlier", firstFailedAt: date("2026-10-29T16:00:00Z"), resolvedAt: null };
  const completeObservation = { ...observation, status: "active", latestInvoicePaid: true, failure: null, unresolvedFailures: [unpaid], hasUnreadDebt: false };
  const completeUnpaid = p.reconcileBillingLifecycle(pending, completeObservation, null).state;
  assert.equal(completeUnpaid.status, "payment_required");
  assert.equal(completeUnpaid.graceEndsAt?.toISOString(), "2026-11-05T16:00:00.000Z");
  const paid = p.reconcileBillingLifecycle(pending, { ...completeObservation, unresolvedFailures: [] }, null);
  assert.equal(paid.state.status, "active"); assert.equal(paid.recovered, true); assert.equal(paid.state.graceStartedAt, null);
  assert.equal(p.resolveBillingEntitlement("pro", paid.state, first).plan, "pro");
  const noPaymentProof = p.reconcileBillingLifecycle({ ...pending, graceStartedAt: null }, { ...completeObservation, latestInvoiceId: null, latestInvoicePaid: false, unresolvedFailures: [] }, null);
  assert.equal(p.resolveBillingEntitlement("pro", noPaymentProof.state, first).plan, "free");
});
