import { db } from "./db";
import { workspaces, memberships, projects, goals, users, workspaceBillingState } from "./db/schema";
import { ensureWorkspaceSchema } from "./db/ensure-workspace-schema";
import { eq, inArray, sql } from "drizzle-orm";
import { STRIPE_PLANS, type StripePlanId } from "./billing-plans";
import { isInternalHighestAccessEmail } from "./internal-accounts";
import { resolveBillingEntitlement } from "./billing-lifecycle";

export type PlanLimits = {
  maxMembers: number;
  maxProjects: number;
  canUseInvoices: boolean;
  canUseWebhooks: boolean;
};

type BillingReader = Pick<typeof db, "select">;

export async function workspaceHasInternalHighestAccess(workspaceId: string, reader: BillingReader = db) {
  const workspaceMembers = await reader.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.workspaceId, workspaceId));
  const userIds = workspaceMembers.map((membership) => membership.userId);
  if (userIds.length === 0) return false;

  const memberUsers = await reader.select({ email: users.email }).from(users).where(inArray(users.id, userIds));
  return memberUsers.some((user) => isInternalHighestAccessEmail(user.email));
}

export async function resolveWorkspacePlan(workspaceId: string, reader: BillingReader = db) {
  const [ws] = await reader.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) throw new Error("Workspace not found");

  const storedPlan = (ws.plan in STRIPE_PLANS ? ws.plan : "free") as StripePlanId;
  const [state] = await reader.select().from(workspaceBillingState).where(eq(workspaceBillingState.workspaceId, workspaceId));
  const entitlement = resolveBillingEntitlement(storedPlan, state ?? null);
  if (await workspaceHasInternalHighestAccess(workspaceId, reader)) {
    return { ...entitlement, plan: "enterprise" as const, source: "internal" as const, storedPlan };
  }
  return { ...entitlement, source: "stripe" as const, storedPlan };
}

export async function checkWorkspaceLimits(
  workspaceId: string,
  feature: "members" | "projects" | "invoices" | "webhooks" | "goals",
  reader: BillingReader = db,
) {
  if (feature === "goals") {
    await ensureWorkspaceSchema();
  }

  const plan = await resolveWorkspacePlan(workspaceId, reader);
  const planData = STRIPE_PLANS[plan.plan];

  if (feature === "invoices" && !planData.features.includes("invoicing")) return { allowed: false, error: "Invoicing is available on Starter and higher plans." };
  if (feature === "webhooks" && !planData.features.includes("webhooks") && plan.plan !== "smb" && plan.plan !== "enterprise") return { allowed: false, error: "Webhooks are available on Studio and Business." };

  if (feature === "members") {
    const [result] = await reader.select({ count: sql<number>`count(*)` }).from(memberships).where(eq(memberships.workspaceId, workspaceId));
    if (result.count >= planData.limits.members) {
      return { allowed: false, error: `Your plan includes ${planData.limits.members} workspace member${planData.limits.members === 1 ? "" : "s"}. Choose a larger plan to invite more people.` };
    }
  }

  if (feature === "projects") {
    const [result] = await reader.select({ count: sql<number>`count(*)` }).from(projects).where(eq(projects.workspaceId, workspaceId));
    if (result.count >= planData.limits.projects) {
      return { allowed: false, error: `Your plan includes ${planData.limits.projects} projects. Choose a larger plan to add more.` };
    }
  }

  if (feature === "goals") {
    const [result] = await reader.select({ count: sql<number>`count(*)` }).from(goals).where(eq(goals.workspaceId, workspaceId));
    if (result.count >= planData.limits.goals) {
      return { allowed: false, error: `Your plan includes ${planData.limits.goals} goal${planData.limits.goals === 1 ? "" : "s"}. Choose a larger plan to add more.` };
    }
  }

  return { allowed: true, limit: planData.limits[feature as keyof typeof planData.limits] || Number.MAX_SAFE_INTEGER };
}
