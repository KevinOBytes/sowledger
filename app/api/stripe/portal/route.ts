import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/stripe";

export async function POST() {
  try {
    const session = await requireSession();
    
    // Only owners can manage billing
    if (session.role !== "owner") {
      return NextResponse.json({ error: "Only workspace owners can manage billing" }, { status: 403 });
    }

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, session.workspaceId));
    if (!ws) throw new Error("Workspace not found");

    if (!ws.stripeCustomerId) {
      return NextResponse.json({ error: "No active Stripe customer found" }, { status: 400 });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: ws.stripeCustomerId,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/billing`,
    });

    return NextResponse.json({ url: portalSession.url });

  } catch (error) {
    console.error("Stripe portal error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
