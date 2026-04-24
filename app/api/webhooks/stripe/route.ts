import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getPlanByPriceId } from "@/lib/billing-plans";

function periodEnd(subscription: Stripe.Subscription) {
  const itemPeriodEnd = subscription.items.data[0]?.current_period_end;
  const subscriptionPeriodEnd = (subscription as Stripe.Subscription & { current_period_end?: number }).current_period_end;
  const timestamp = itemPeriodEnd ?? subscriptionPeriodEnd;
  return timestamp ? new Date(timestamp * 1000) : null;
}

async function updateWorkspaceFromSubscription(subscription: Stripe.Subscription, workspaceId?: string | null) {
  const priceId = subscription.items.data[0]?.price.id;
  if (!priceId) return;
  const plan = getPlanByPriceId(priceId);
  const updates = {
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    stripePriceId: priceId,
    stripeCurrentPeriodEnd: periodEnd(subscription),
    plan: plan.planId as "free" | "pro" | "smb" | "enterprise",
  };

  if (workspaceId) {
    await db.update(workspaces).set(updates).where(eq(workspaces.id, workspaceId));
    return;
  }

  await db.update(workspaces).set(updates).where(eq(workspaces.stripeSubscriptionId, subscription.id));
}

export async function POST(req: Request) {
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature || !env.STRIPE_WEBHOOK_SECRET) {
    return new NextResponse("Missing Stripe signature or webhook secret", { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error("Webhook signature verification failed.", (error as Error).message);
    return new NextResponse(`Webhook Error: ${(error as Error).message}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    // Retrieve the subscription details from Stripe.
    const subscription = await stripe.subscriptions.retrieve(
      session.subscription as string
    );

    const workspaceId = session.client_reference_id ?? session.metadata?.workspaceId;

    if (!workspaceId) {
      return new NextResponse("Missing client_reference_id", { status: 400 });
    }

    await updateWorkspaceFromSubscription(subscription, workspaceId);
  }

  if (event.type === "customer.subscription.updated") {
    const subscription = event.data.object as Stripe.Subscription;
    await updateWorkspaceFromSubscription(subscription);
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;

    await db
      .update(workspaces)
      .set({
        stripePriceId: null,
        stripeSubscriptionId: null,
        stripeCurrentPeriodEnd: null,
        plan: "free",
      })
      .where(eq(workspaces.stripeSubscriptionId, subscription.id));
  }

  return new NextResponse(null, { status: 200 });
}
