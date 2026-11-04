import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { env } from "@/lib/env";
import { processStripeBillingEvent } from "@/lib/stripe-billing-events";
import type Stripe from "stripe";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature || !env.STRIPE_WEBHOOK_SECRET) return new NextResponse("Missing Stripe signature or webhook secret", { status: 400 });
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(Buffer.from(await req.arrayBuffer()), signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return new NextResponse("Invalid Stripe signature", { status: 400 });
  }
  try {
    const result = await processStripeBillingEvent(event);
    if (result?.status === "pending") return new NextResponse("Billing verification is still in progress", { status: 503 });
    return new NextResponse(null, { status: 200 });
  } catch {
    // Never log provider payloads, identifiers, SQL or credentials.
    console.error("Stripe billing reconciliation failed; delivery remains retryable.");
    return new NextResponse("Billing reconciliation unavailable", { status: 500 });
  }
}
