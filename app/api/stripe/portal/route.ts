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

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, session.workspaceId));
    if (!workspace) throw new Error("Workspace not found");

    if (!workspace.stripeCustomerId) {
      return NextResponse.json(
        { error: "No billing account found. Please upgrade to a paid plan first." },
        { status: 400 }
      );
    }

    const baseUrl = env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: workspace.stripeCustomerId,
      return_url: `${baseUrl}/dashboard/settings/billing`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (error) {
    console.error("Stripe Portal Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
