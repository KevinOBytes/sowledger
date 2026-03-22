import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/stripe";

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    
    // Only owners can initiate an upgrade
    if (session.role !== "owner") {
      return NextResponse.json({ error: "Only workspace owners can manage billing" }, { status: 403 });
    }

    const { priceId } = await req.json();

    if (!priceId) {
      return NextResponse.json({ error: "No price ID provided" }, { status: 400 });
    }

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, session.workspaceId));
    if (!ws) throw new Error("Workspace not found");

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: ws.stripeCustomerId || undefined,
      client_reference_id: ws.id,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/billing?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/billing?canceled=true`,
      subscription_data: {
        metadata: {
          workspaceId: ws.id,
        },
      },
      customer_email: ws.stripeCustomerId ? undefined : session.email,
    });

    return NextResponse.json({ url: checkoutSession.url });

  } catch (error: any) {
    console.error("Stripe checkout error:", error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
