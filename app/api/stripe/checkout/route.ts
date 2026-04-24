import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import { getPaidPlanById } from "@/lib/billing-plans";

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

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: ws.stripeCustomerId || undefined,
      client_reference_id: ws.id,
      line_items: [
        {
          price: plan.priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/billing?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/billing?canceled=true`,
      subscription_data: {
        metadata: {
          workspaceId: ws.id,
          planId: plan.planId,
        },
      },
      metadata: {
        workspaceId: ws.id,
        planId: plan.planId,
      },
      customer_email: ws.stripeCustomerId ? undefined : session.email,
    });

    return NextResponse.json({ url: checkoutSession.url });

  } catch (error) {
    console.error("Stripe checkout error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
