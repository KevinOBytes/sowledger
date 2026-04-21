import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { STRIPE_PLANS } from "@/lib/billing-plans";

export async function POST(req: Request) {
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature) {
    return new NextResponse("Missing Stripe signature", { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET || "whsec_dummy"
    );
  } catch (error) {
    console.error("Webhook signature verification failed.", (error as Error).message);
    return new NextResponse(`Webhook Error: ${(error as Error).message}`, { status: 400 });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  if (event.type === "checkout.session.completed") {
    // Retrieve the subscription details from Stripe.
    const subscription = await stripe.subscriptions.retrieve(
      session.subscription as string
    );

    const workspaceId = session.client_reference_id;

    if (!workspaceId) {
      return new NextResponse("Missing client_reference_id", { status: 400 });
    }

    const priceId = subscription.items.data[0].price.id;

    // Determine plan type from price ID
    let planType: "free" | "pro" | "smb" | "enterprise" = "free";
    if (priceId === STRIPE_PLANS.pro.priceId) planType = "pro";
    else if (priceId === STRIPE_PLANS.smb.priceId) planType = "smb";
    else if (priceId === STRIPE_PLANS.enterprise.priceId) planType = "enterprise";

    await db
      .update(workspaces)
      .set({
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: subscription.customer as string,
        stripePriceId: priceId,
        stripeCurrentPeriodEnd: new Date(subscription.items.data[0].current_period_end * 1000),
        plan: planType,
      })
      .where(eq(workspaces.id, workspaceId));
  }

  if (event.type === "customer.subscription.updated") {
    const subscription = event.data.object as Stripe.Subscription;

    const priceId = subscription.items.data[0].price.id;

    let planType: "free" | "pro" | "smb" | "enterprise" = "free";
    if (priceId === STRIPE_PLANS.pro.priceId) planType = "pro";
    else if (priceId === STRIPE_PLANS.smb.priceId) planType = "smb";
    else if (priceId === STRIPE_PLANS.enterprise.priceId) planType = "enterprise";

    await db
      .update(workspaces)
      .set({
        stripePriceId: priceId,
        stripeCurrentPeriodEnd: new Date(subscription.items.data[0].current_period_end * 1000),
        plan: planType,
      })
      .where(eq(workspaces.stripeSubscriptionId, subscription.id));
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;

    await db
      .update(workspaces)
      .set({
        stripePriceId: null,
        stripeSubscriptionId: null,
        plan: "free",
      })
      .where(eq(workspaces.stripeSubscriptionId, subscription.id));
  }

  return new NextResponse(null, { status: 200 });
}
