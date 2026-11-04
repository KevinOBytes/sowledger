import type Stripe from "stripe";
import { and, asc, eq, or, sql, isNull } from "drizzle-orm";
import { db } from "./db";
import { workspaces, workspaceBillingState, billingPaymentFailures, stripeWebhookEvents } from "./db/schema";
import { stripe } from "./stripe";
import { getPlanByPriceId, type StripePlanId } from "./billing-plans";
import { reconcileBillingLifecycle, TERMINAL_BILLING_STATUSES, type PaymentFailure } from "./billing-lifecycle";

const handled = new Set(["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.payment_failed", "invoice.paid"]);
const idOf = (object: string | { id: string } | null | undefined) => typeof object === "string" ? object : object?.id ?? null;
export function invoiceSubscriptionId(invoice: Stripe.Invoice) {
  return idOf(invoice.parent?.subscription_details?.subscription);
}
function invalid(): never { throw new Error("Billing reconciliation requires verified binding"); }
function same(value: string | null, expected: string) { if (value !== expected) invalid(); }

/** Provider reads only. Receipts mark completed state, never partial progress. */
export async function processStripeBillingEvent(event: Stripe.Event) {
  if (!handled.has(event.type)) return;
  const checkout = event.type === "checkout.session.completed" ? event.data.object as Stripe.Checkout.Session : null;
  const invoiceEvent = event.type.startsWith("invoice.") ? event.data.object as Stripe.Invoice : null;
  const subscriptionEvent = !checkout && !invoiceEvent ? event.data.object as Stripe.Subscription : null;
  const subscriptionId = checkout ? idOf(checkout.subscription) : invoiceEvent ? invoiceSubscriptionId(invoiceEvent) : subscriptionEvent?.id;
  if (invoiceEvent && !subscriptionId) return;
  const customerId = idOf(checkout?.customer ?? invoiceEvent?.customer ?? subscriptionEvent?.customer);
  if (!subscriptionId || !customerId) invalid();
  const reference = checkout?.client_reference_id ?? checkout?.metadata?.workspaceId ?? subscriptionEvent?.metadata?.workspaceId;
  if (checkout?.client_reference_id && checkout.metadata?.workspaceId && checkout.client_reference_id !== checkout.metadata.workspaceId) invalid();

  return db.transaction(async tx => {
    // Serialize binding creation too: workspace locks alone cannot protect a
    // customer/subscription that is not bound yet.
    for (const key of [`billing:customer:${customerId}`, `billing:subscription:${subscriptionId}`].sort()) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    }
    async function candidates() {
      const rows = await tx.select({ id: workspaces.id }).from(workspaces).where(or(eq(workspaces.stripeSubscriptionId, subscriptionId!), eq(workspaces.stripeCustomerId, customerId!), ...(reference ? [eq(workspaces.id, reference)] : [])));
      const states = await tx.select({ id: workspaceBillingState.workspaceId }).from(workspaceBillingState).where(or(eq(workspaceBillingState.subscriptionId, subscriptionId!), eq(workspaceBillingState.customerId, customerId!)));
      const history = await tx.select({ id: stripeWebhookEvents.workspaceId }).from(stripeWebhookEvents).where(eq(stripeWebhookEvents.subscriptionId, subscriptionId!));
      return new Set([...rows, ...states, ...history].map(row => row.id));
    }
    const found = await candidates(); if (found.size !== 1) invalid();
    const workspaceId = [...found][0];
    if (reference && reference !== workspaceId) invalid();
    const [workspace] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId)).for("update");
    if (!workspace || (await candidates()).size !== 1) invalid();
    if (workspace.stripeCustomerId && workspace.stripeCustomerId !== customerId) invalid();
    const [existing] = await tx.select().from(workspaceBillingState).where(eq(workspaceBillingState.workspaceId, workspaceId));
    if (existing && existing.customerId !== customerId) invalid();
    const [receipt] = await tx.select().from(stripeWebhookEvents).where(eq(stripeWebhookEvents.eventId, event.id));
    if (receipt) {
      if (receipt.workspaceId !== workspaceId || receipt.subscriptionId !== subscriptionId || receipt.eventType !== event.type) invalid();
      return;
    }
    const saveReceipt = () => tx.insert(stripeWebhookEvents).values({ eventId: event.id, workspaceId, subscriptionId, eventType: event.type });
    const [retired] = await tx.select({ id: stripeWebhookEvents.eventId }).from(stripeWebhookEvents).where(and(eq(stripeWebhookEvents.workspaceId, workspaceId), eq(stripeWebhookEvents.subscriptionId, subscriptionId))).limit(1);
    const currentBinding = existing?.subscriptionId ?? workspace.stripeSubscriptionId;
    if (existing && ((existing.subscriptionId === subscriptionId && TERMINAL_BILLING_STATUSES.has(existing.status)) || (currentBinding !== subscriptionId && retired))) {
      await saveReceipt(); return;
    }
    if (currentBinding !== subscriptionId) {
      if (!checkout || (existing && !TERMINAL_BILLING_STATUSES.has(existing.status)) || workspace.stripeSubscriptionId) invalid();
    }
    // Limit both work and elapsed provider time while holding billing locks.
    // Mandatory reads and genuine provider errors roll back. Optional debt
    // budget exhaustion instead commits denied progress without a receipt.
    const readDeadline = Date.now() + 12_000;
    let readCount = 0;
    const canRead = () => readCount < 8 && Date.now() < readDeadline;
    async function providerRead<T>(read: (options: Stripe.RequestOptions) => Promise<T>) {
      const remaining = readDeadline - Date.now();
      if (++readCount > 8 || remaining <= 0) invalid();
      const value = await read({ timeout: Math.min(5000, remaining), maxNetworkRetries: 0 });
      if (Date.now() > readDeadline) invalid();
      return value;
    }
    const subscription = await providerRead(options => stripe.subscriptions.retrieve(subscriptionId, {}, options));
    same(subscription.id, subscriptionId); same(idOf(subscription.customer), customerId);
    if (subscription.metadata.workspaceId && subscription.metadata.workspaceId !== workspaceId) invalid();
    if (checkout) {
      const canonical = await providerRead(options => stripe.checkout.sessions.retrieve(checkout.id, {}, options));
      if (canonical.mode !== "subscription" || canonical.status !== "complete") invalid();
      same(idOf(canonical.subscription), subscriptionId); same(idOf(canonical.customer), customerId);
      same(canonical.client_reference_id ?? canonical.metadata?.workspaceId ?? null, workspaceId);
      if (canonical.metadata?.workspaceId && canonical.metadata.workspaceId !== workspaceId) invalid();
    }
    const bindingPrevious = existing?.subscriptionId === subscriptionId ? existing : null;
    const now = new Date();
    const latestInvoiceId = idOf(subscription.latest_invoice);
    if (TERMINAL_BILLING_STATUSES.has(subscription.status)) {
      // Cancellation grants nothing: neither old invoice availability nor a
      // still-offered price may prevent retiring the verified binding.
      const state = {
        subscriptionId, customerId, plan: bindingPrevious?.plan ?? workspace.plan,
        status: subscription.status, everActiveAt: bindingPrevious?.everActiveAt ?? null,
        latestInvoiceId, graceInvoiceId: null, graceStartedAt: null, graceEndsAt: null,
      };
      await tx.insert(workspaceBillingState).values({ ...state, workspaceId, lastVerifiedAt: now, updatedAt: now }).onConflictDoUpdate({ target: workspaceBillingState.workspaceId, set: { ...state, lastVerifiedAt: now, updatedAt: now } });
      await tx.update(workspaces).set({ plan: "free", stripeCustomerId: customerId, stripeSubscriptionId: null, stripePriceId: null, stripeCurrentPeriodEnd: null }).where(eq(workspaces.id, workspaceId));
      await saveReceipt();
      return;
    }
    const verifyInvoice = (invoice: Stripe.Invoice) => { same(invoiceSubscriptionId(invoice), subscriptionId); same(idOf(invoice.customer), customerId); return invoice; };
    const invoiceCache = new Map<string, Stripe.Invoice>();
    async function readInvoice(id: string) {
      if (!invoiceCache.has(id)) invoiceCache.set(id, verifyInvoice(await providerRead(options => stripe.invoices.retrieve(id, {}, options))));
      return invoiceCache.get(id)!;
    }
    const latest = latestInvoiceId ? await readInvoice(latestInvoiceId) : null;
    const deliveredInvoice = invoiceEvent ? await readInvoice(invoiceEvent.id) : null;
    const failureInvoice = event.type === "invoice.payment_failed" && deliveredInvoice && (deliveredInvoice.status === "open" || deliveredInvoice.status === "uncollectible") ? deliveredInvoice : null;
    const priceId = subscription.items.data[0]?.price.id;
    const plan = priceId ? getPlanByPriceId(priceId) : null;
    if (!plan || plan.planId === "free" || subscription.items.data.length !== 1) invalid();
    const planId = plan.planId as StripePlanId;
    let priorPaidAt: Date | null = null;
    if (!bindingPrevious?.everActiveAt && failureInvoice?.billing_reason === "subscription_cycle") {
      const history = await providerRead(options => stripe.invoices.list({ subscription: subscriptionId, status: "paid", limit: 100 }, options));
      for (const invoice of history.data) {
        verifyInvoice(invoice);
        const paidAt = invoice.status_transitions.paid_at;
        if (invoice.id !== latestInvoiceId && invoice.status === "paid" && paidAt && paidAt < event.created) {
          const timestamp = new Date(paidAt * 1000); if (!priorPaidAt || timestamp < priorPaidAt) priorPaidAt = timestamp;
        }
      }
    }
    const failureInvoiceId = failureInvoice?.id ?? bindingPrevious?.graceInvoiceId ?? latestInvoiceId;
    const [knownFailure] = failureInvoiceId ? await tx.select().from(billingPaymentFailures).where(and(eq(billingPaymentFailures.workspaceId, workspaceId), eq(billingPaymentFailures.invoiceId, failureInvoiceId))) : [];
    // Current payment must not hide an older known unpaid invoice.
    // Nine rows are enough to prove unfinished work under the eight-read cap.
    // Resolved rows disappear from the next deterministic page, so all-paid
    // finite histories drain over retries without a cursor or a lost debt row.
    const unresolved = await tx.select().from(billingPaymentFailures).where(and(eq(billingPaymentFailures.workspaceId, workspaceId), eq(billingPaymentFailures.subscriptionId, subscriptionId), isNull(billingPaymentFailures.resolvedAt))).orderBy(asc(billingPaymentFailures.invoiceId)).limit(9);
    let hasUnreadDebt = false;
    const resolvedIds = new Set<string>();
    for (const failed of unresolved) {
      if (!invoiceCache.has(failed.invoiceId) && !canRead()) { hasUnreadDebt = true; break; }
      const invoice = await readInvoice(failed.invoiceId);
      if (invoice.status === "paid") {
        await tx.update(billingPaymentFailures).set({ resolvedAt: now }).where(and(eq(billingPaymentFailures.workspaceId, workspaceId), eq(billingPaymentFailures.invoiceId, failed.invoiceId)));
        resolvedIds.add(failed.invoiceId);
      }
    }
    const unpaidFailures: PaymentFailure[] = unresolved.filter(failed => !resolvedIds.has(failed.invoiceId));
    const allKnownPaid = !failureInvoice && !hasUnreadDebt && unpaidFailures.length === 0;
    const result = reconcileBillingLifecycle(bindingPrevious, {
      subscriptionId, customerId, plan: planId, status: subscription.status,
      latestInvoiceId, latestInvoicePaid: latest?.status === "paid" && allKnownPaid,
      renewal: (failureInvoice ?? latest)?.billing_reason === "subscription_cycle", priorPaidAt,
      unresolvedFailures: unpaidFailures,
      hasUnreadDebt,
      failure: failureInvoice && invoiceEvent && Number.isFinite(event.created) ? { invoiceId: failureInvoice.id, firstAttempt: invoiceEvent.attempt_count === 1, occurredAt: new Date(event.created * 1000) } : null,
      now,
    }, knownFailure ?? null);
    if (result.failure && !result.failure.resolvedAt && !result.recovered) {
      await tx.insert(billingPaymentFailures).values({ ...result.failure, workspaceId, subscriptionId }).onConflictDoUpdate({ target: [billingPaymentFailures.workspaceId, billingPaymentFailures.invoiceId], set: { firstFailedAt: result.failure.firstFailedAt } });
    }
    await tx.insert(workspaceBillingState).values({ ...result.state, workspaceId, lastVerifiedAt: now, updatedAt: now }).onConflictDoUpdate({ target: workspaceBillingState.workspaceId, set: { ...result.state, lastVerifiedAt: now, updatedAt: now } });
    await tx.update(workspaces).set({ plan: planId, stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId, stripePriceId: priceId, stripeCurrentPeriodEnd: subscription.items.data[0]?.current_period_end ? new Date(subscription.items.data[0].current_period_end * 1000) : null }).where(eq(workspaces.id, workspaceId));
    // Commit verified facts and fail-closed state, but leave this delivery
    // unfinished. Throwing here would undo the progress and recreate the trap.
    if (hasUnreadDebt) return { status: "pending" as const };
    await saveReceipt();
  });
}
