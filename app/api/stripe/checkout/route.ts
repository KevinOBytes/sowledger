import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import { getPaidPlanById } from "@/lib/billing-plans";
import { buildStripeCheckoutParams, hasActivePaidBilling } from "@/lib/stripe-checkout";

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    
    // Only owners can initiate an upgrade
    if (session.role !== "owner") {
      return NextResponse.json({ error: "Only workspace owners can manage billing" }, { status: 403 });
    }

    const { planId } = await req.json() as { planId?: string };

    if (!planId) {
      return NextResponse.json({ error: "planId is required" }, { status: 400 });
    }
    const plan = getPaidPlanById(planId);
    if (!plan) {
      return NextResponse.json({ error: "Unknown billing plan" }, { status: 400 });
    }
    if (!plan.priceId || plan.priceId.startsWith("price_dummy")) {
      return NextResponse.json({ error: "Stripe price is not configured for this plan" }, { status: 500 });
    }

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, session.workspaceId));
    if (!ws) throw new Error("Workspace not found");

    if (hasActivePaidBilling(ws)) {
      if (ws.stripeCustomerId) {
        const portalSession = await stripe.billingPortal.sessions.create({
          customer: ws.stripeCustomerId,
          return_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/billing`,
        });
        return NextResponse.json({
          error: "Workspace billing is already active. Use the billing portal to manage the subscription.",
          portalUrl: portalSession.url,
          url: portalSession.url,
        }, { status: 409 });
      }

      return NextResponse.json({
        error: "Workspace billing is already active. Open billing settings to manage the subscription.",
        portalPath: "/settings/billing",
      }, { status: 409 });
    }

    const checkoutParams = buildStripeCheckoutParams({
      workspaceId: ws.id,
      plan,
      customerEmail: session.email,
      stripeCustomerId: ws.stripeCustomerId,
      appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    });

    const checkoutSession = await stripe.checkout.sessions.create(checkoutParams);

    return NextResponse.json({ url: checkoutSession.url });

  } catch (error) {
    console.error("Stripe checkout error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
