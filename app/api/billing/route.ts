import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaces, memberships, projects } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { PLAN_LIMITS } from "@/lib/billing";
import { env } from "@/lib/env";

export async function GET() {
  try {
    const session = await requireSession();

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, session.workspaceId));
    if (!ws) throw new Error("Workspace not found");

    const [membersResult] = await db.select({ count: sql<number>`count(*)` }).from(memberships).where(eq(memberships.workspaceId, session.workspaceId));
    const [projectsResult] = await db.select({ count: sql<number>`count(*)` }).from(projects).where(eq(projects.workspaceId, session.workspaceId));

    const limits = PLAN_LIMITS[ws.plan] || PLAN_LIMITS.free;

    return NextResponse.json({ 
      ok: true, 
      plan: ws.plan,
      isOwner: session.role === "owner",
      usage: {
        members: membersResult.count,
        projects: projectsResult.count,
      },
      limits,
      prices: {
        pro: env.STRIPE_PRO_PRICE_ID,
        smb: env.STRIPE_SMB_PRICE_ID,
      }
    });

  } catch (error) {
    return NextResponse.json({ error: "Failed to load billing info" }, { status: 400 });
  }
}
