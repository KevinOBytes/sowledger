import type { StripePlanId } from "./billing-plans";

export type BillingLifecycleState = {
  subscriptionId: string; customerId: string; plan: StripePlanId; status: string;
  everActiveAt: Date | null; latestInvoiceId: string | null;
  graceInvoiceId: string | null; graceStartedAt: Date | null; graceEndsAt: Date | null;
};
export type PaymentFailure = { invoiceId: string; firstFailedAt: Date | null; resolvedAt: Date | null };
export type BillingObservation = {
  subscriptionId: string; customerId: string; plan: StripePlanId; status: string;
  latestInvoiceId: string | null; latestInvoicePaid: boolean; renewal: boolean;
  priorPaidAt: Date | null;
  /** Canonically verified unpaid failures, including explicit unknown anchors. */
  unresolvedFailures?: PaymentFailure[];
  /** Required debt remains unread within this delivery's provider budget. */
  hasUnreadDebt?: boolean;
  failure: { invoiceId: string; firstAttempt: boolean; occurredAt: Date } | null;
  now: Date;
};
export const TERMINAL_BILLING_STATUSES = new Set(["canceled", "incomplete_expired"]);
const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export function resolveBillingEntitlement(storedPlan: StripePlanId, state: BillingLifecycleState | null, now = new Date()) {
  if (!state) return { plan: storedPlan, billingStatus: "legacy", graceEndsAt: null, graceExpired: false };
  const eligible = state.status === "past_due" || state.status === "unpaid" || state.status === "payment_required";
  const deadline = eligible && state.everActiveAt ? state.graceEndsAt : null;
  const inGrace = !!deadline && now.getTime() < deadline.getTime();
  const active = state.status === "active" || state.status === "trialing";
  return {
    plan: active || inGrace ? state.plan : "free" as StripePlanId,
    billingStatus: inGrace ? "grace" : state.status,
    graceEndsAt: deadline?.toISOString() ?? null,
    graceExpired: !!deadline && !inGrace,
  };
}

/** Pure policy; the caller verifies provider identity and serializes persistence. */
export function reconcileBillingLifecycle(previous: BillingLifecycleState | null, observation: BillingObservation, known: PaymentFailure | null) {
  const o = observation;
  let failure = known;
  if (o.failure && !known?.resolvedAt) {
    // A retry cannot supply the missing first-failure fact. A delayed first
    // attempt can establish it, and an earlier confirmed anchor may shorten it.
    const confirmed = o.failure.firstAttempt ? o.failure.occurredAt : null;
    const stored = known?.firstFailedAt ?? null;
    const anchor = confirmed && stored ? new Date(Math.min(confirmed.getTime(), stored.getTime())) : confirmed ?? stored;
    failure = { invoiceId: o.failure.invoiceId, firstFailedAt: anchor, resolvedAt: null };
  }
  const pending = new Map((o.unresolvedFailures ?? []).filter(item => !item.resolvedAt).map(item => [item.invoiceId, item]));
  if (o.failure && failure && !failure.resolvedAt) pending.set(failure.invoiceId, failure);
  const unknownDebt = [...pending.values()].some(item => !item.firstFailedAt);
  const paymentComplete = o.latestInvoicePaid && pending.size === 0 && !o.hasUnreadDebt;
  const paidActive = o.status === "active" && paymentComplete;
  const everActiveAt = previous?.everActiveAt ?? o.priorPaidAt ?? (paidActive ? o.now : null);
  const requiresPayment = (o.status === "active" && !paymentComplete && (o.latestInvoiceId || previous?.graceStartedAt || previous?.status === "payment_required" || previous?.status === "reconciliation_pending" || pending.size)) || (o.status === "trialing" && pending.size > 0);
  const status = o.hasUnreadDebt && !TERMINAL_BILLING_STATUSES.has(o.status) ? "reconciliation_pending" : requiresPayment ? "payment_required" : o.status;
  const delinquent = status === "past_due" || status === "unpaid" || status === "payment_required" || status === "reconciliation_pending";
  // Keep an unresolved workspace grace anchor across invoice rollover. A new
  // invoice never creates a fresh window while an older failure is unpaid.
  const existingAnchor = previous?.graceStartedAt ?? null;
  let anchorInvoiceId = previous?.graceInvoiceId ?? null;
  let newAnchor: Date | null = null;
  if (o.renewal && everActiveAt) {
    for (const item of pending.values()) if (item.firstFailedAt && (!newAnchor || item.firstFailedAt < newAnchor)) {
      newAnchor = item.firstFailedAt;
      if (!existingAnchor || newAnchor < existingAnchor) anchorInvoiceId = item.invoiceId;
    }
  }
  const anchor = existingAnchor && newAnchor ? new Date(Math.min(existingAnchor.getTime(), newAnchor.getTime())) : existingAnchor ?? newAnchor;
  const retainAnchor = delinquent && !!everActiveAt && !!anchor;
  const grantsGrace = retainAnchor && !unknownDebt && !o.hasUnreadDebt;
  const state: BillingLifecycleState = {
    subscriptionId: o.subscriptionId, customerId: o.customerId, plan: o.plan, status,
    everActiveAt, latestInvoiceId: o.latestInvoiceId,
    // Retain exact known anchors while unknown earlier debt suppresses the
    // deadline, so later evidence/payment cannot slide an existing window.
    graceInvoiceId: retainAnchor ? anchorInvoiceId : null,
    graceStartedAt: retainAnchor ? anchor : null,
    graceEndsAt: grantsGrace ? new Date(anchor!.getTime() + GRACE_MS) : null,
  };
  return { state, failure, recovered: paidActive };
}
