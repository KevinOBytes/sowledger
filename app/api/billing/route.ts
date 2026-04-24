import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaces, memberships, projects } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { STRIPE_PLANS } from "@/lib/billing-plans";
import { resolveWorkspacePlan } from "@/lib/billing";

export async function GET() {
  try {
    const session = await requireSession();

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, session.workspaceId));
    if (!ws) throw new Error("Workspace not found");

    const [membersResult] = await db.select({ count: sql<number>`count(*)` }).from(memberships).where(eq(memberships.workspaceId, session.workspaceId));
    const [projectsResult] = await db.select({ count: sql<number>`count(*)` }).from(projects).where(eq(projects.workspaceId, session.workspaceId));

    const resolvedPlan = await resolveWorkspacePlan(session.workspaceId);
    const planData = STRIPE_PLANS[resolvedPlan.plan] || STRIPE_PLANS.free;

    return NextResponse.json({ 
      ok: true, 
      plan: resolvedPlan.plan,
      storedPlan: ws.plan,
      planSource: resolvedPlan.source,
      isOwner: session.role === "owner",
      usage: {
        members: membersResult.count,
        projects: projectsResult.count,
      },
      limits: planData.limits,
      plans: Object.values(STRIPE_PLANS).map((plan) => ({
        planId: plan.planId,
        name: plan.name,
        description: plan.description,
        price: plan.price,
        features: plan.features,
        limits: plan.limits,
        configured: !plan.priceId || !plan.priceId.startsWith("price_dummy"),
      })),
    });

  } catch {
    return NextResponse.json({ error: "Failed to load billing info" }, { status: 400 });
  }
}
