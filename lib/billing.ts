import { db } from "./db";
import { workspaces, memberships, projects, goals, users } from "./db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { STRIPE_PLANS, type StripePlanId } from "./billing-plans";
import { isInternalHighestAccessEmail } from "./internal-accounts";

export type PlanLimits = {
  maxMembers: number;
  maxProjects: number;
  canUseInvoices: boolean;
  canUseWebhooks: boolean;
};

export async function workspaceHasInternalHighestAccess(workspaceId: string) {
  const workspaceMembers = await db.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.workspaceId, workspaceId));
  const userIds = workspaceMembers.map((membership) => membership.userId);
  if (userIds.length === 0) return false;

  const memberUsers = await db.select({ email: users.email }).from(users).where(inArray(users.id, userIds));
  return memberUsers.some((user) => isInternalHighestAccessEmail(user.email));
}

export async function resolveWorkspacePlan(workspaceId: string): Promise<{ plan: StripePlanId; source: "stripe" | "internal"; storedPlan: StripePlanId }> {
  const [ws] = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) throw new Error("Workspace not found");

  const storedPlan = (ws.plan in STRIPE_PLANS ? ws.plan : "free") as StripePlanId;
  if (await workspaceHasInternalHighestAccess(workspaceId)) {
    return { plan: "enterprise", source: "internal", storedPlan };
  }
  return { plan: storedPlan, source: "stripe", storedPlan };
}

export async function checkWorkspaceLimits(
  workspaceId: string,
  feature: "members" | "projects" | "invoices" | "webhooks" | "goals"
) {
  const plan = await resolveWorkspacePlan(workspaceId);
  const planData = STRIPE_PLANS[plan.plan];

  if (feature === "invoices" && !planData.features.includes("invoicing")) return { allowed: false, error: "Invoices require the Starter plan." };
  if (feature === "webhooks" && !planData.features.includes("webhooks") && plan.plan !== "smb" && plan.plan !== "enterprise") return { allowed: false, error: "Webhooks require the Studio plan." };

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
