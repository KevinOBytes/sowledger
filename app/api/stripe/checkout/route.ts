import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (session.role !== "owner") {
      return NextResponse.json({ error: "Only workspace owners can manage billing." }, { status: 403 });
    }

    const { priceId } = await req.json() as { priceId?: string };
    if (!priceId) {
      return NextResponse.json({ error: "Price ID is required." }, { status: 400 });
    }

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, session.workspaceId));
    if (!workspace) throw new Error("Workspace not found");

    const baseUrl = env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: workspace.stripeCustomerId || undefined,
      client_reference_id: workspace.id,
      customer_email: workspace.stripeCustomerId ? undefined : session.email,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/dashboard/settings/billing?success=true`,
      cancel_url: `${baseUrl}/dashboard/settings/billing?canceled=true`,
      metadata: {
        workspaceId: workspace.id,
      },
      subscription_data: {
        metadata: {
          workspaceId: workspace.id,
        },
      },
    });

    if (!checkoutSession.url) {
      throw new Error("Failed to create checkout session URL");
    }

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error) {
    console.error("Stripe Checkout Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
