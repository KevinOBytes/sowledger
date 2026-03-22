import { db } from "./db";
import { workspaces, memberships, projects } from "./db/schema";
import { eq, sql } from "drizzle-orm";

export type PlanLimits = {
  maxMembers: number;
  maxProjects: number;
  canUseInvoices: boolean;
  canUseWebhooks: boolean;
};

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: {
    maxMembers: 1,
    maxProjects: 2,
    canUseInvoices: false,
    canUseWebhooks: false,
  },
  pro: {
    maxMembers: 1,
    maxProjects: Number.MAX_SAFE_INTEGER,
    canUseInvoices: true,
    canUseWebhooks: false,
  },
  smb: {
    maxMembers: 10,
    maxProjects: Number.MAX_SAFE_INTEGER,
    canUseInvoices: true,
    canUseWebhooks: true,
  },
  enterprise: {
    maxMembers: Number.MAX_SAFE_INTEGER,
    maxProjects: Number.MAX_SAFE_INTEGER,
    canUseInvoices: true,
    canUseWebhooks: true,
  },
};

export async function checkWorkspaceLimits(
  workspaceId: string,
  feature: "members" | "projects" | "invoices" | "webhooks"
) {
  const [ws] = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) throw new Error("Workspace not found");

  const limits = PLAN_LIMITS[ws.plan] || PLAN_LIMITS.free;

  if (feature === "invoices" && !limits.canUseInvoices) return { allowed: false, error: "Invoices require a Premium plan." };
  if (feature === "webhooks" && !limits.canUseWebhooks) return { allowed: false, error: "Webhooks require the SMB plan." };

  if (feature === "members") {
    // Check current member count
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(memberships).where(eq(memberships.workspaceId, workspaceId));
    if (result.count >= limits.maxMembers) {
      return { allowed: false, error: `Member limit reached (${limits.maxMembers}). Please upgrade your plan to invite more users.` };
    }
  }

  if (feature === "projects") {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(projects).where(eq(projects.workspaceId, workspaceId));
    if (result.count >= limits.maxProjects) {
      return { allowed: false, error: `Project limit reached (${limits.maxProjects}). Please upgrade your plan to create more projects.` };
    }
  }

  return { allowed: true };
}
