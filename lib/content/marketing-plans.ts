import { STRIPE_PLANS, type StripePlanId } from "@/lib/billing-plans";

const planFeatures: Record<StripePlanId, string[]> = {
  free: ["Live timers", "Manual time entries"],
  pro: ["Scheduling", "Analytics", "Invoices", "CSV and JSON exports"],
  smb: ["Client review", "Team approvals", "API keys", "Webhooks"],
  enterprise: ["Team approvals", "API keys", "Webhooks", "More people and projects"],
};

// Only these public fields cross the client boundary; Stripe price IDs stay server-side.
export const marketingPlans = Object.values(STRIPE_PLANS).map((plan) => ({
  planId: plan.planId,
  name: plan.name,
  description: plan.description,
  price: plan.price,
  features: planFeatures[plan.planId as StripePlanId],
  limits: { members: plan.limits.members, projects: plan.limits.projects },
  recommended: plan.planId === "smb",
}));

export type MarketingPlan = (typeof marketingPlans)[number];
