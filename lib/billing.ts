import { db } from "./db";
import { workspaces, memberships, projects, goals } from "./db/schema";
import { eq, sql } from "drizzle-orm";
import { STRIPE_PLANS } from "./billing-plans";

export type PlanLimits = {
  maxMembers: number;
  maxProjects: number;
  canUseInvoices: boolean;
  canUseWebhooks: boolean;
};

export async function checkWorkspaceLimits(
  workspaceId: string,
  feature: "members" | "projects" | "invoices" | "webhooks" | "goals"
) {
  const [ws] = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) throw new Error("Workspace not found");

  const planData = STRIPE_PLANS[ws.plan as keyof typeof STRIPE_PLANS] || STRIPE_PLANS.free;

  if (feature === "invoices" && !planData.features.includes("invoicing")) return { allowed: false, error: "Invoices require a Premium plan." };
  if (feature === "webhooks" && !planData.features.includes("webhooks") && ws.plan !== 'smb' && ws.plan !== 'enterprise') return { allowed: false, error: "Webhooks require the SMB plan." };

  if (feature === "members") {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(memberships).where(eq(memberships.workspaceId, workspaceId));
    if (result.count >= planData.limits.members) {
      return { allowed: false, error: `Member limit reached (${planData.limits.members}). Please upgrade your plan to invite more users.` };
    }
  }

  if (feature === "projects") {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(projects).where(eq(projects.workspaceId, workspaceId));
    if (result.count >= planData.limits.projects) {
      return { allowed: false, error: `Project limit reached (${planData.limits.projects}). Please upgrade your plan to create more projects.` };
    }
  }

  if (feature === "goals") {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(goals).where(eq(goals.workspaceId, workspaceId));
    if (result.count >= planData.limits.goals) {
      return { allowed: false, error: `Goal limit reached (${planData.limits.goals}). Please upgrade your plan to create more goals.` };
    }
  }

  return { allowed: true, limit: planData.limits[feature as keyof typeof planData.limits] || Number.MAX_SAFE_INTEGER };
}
