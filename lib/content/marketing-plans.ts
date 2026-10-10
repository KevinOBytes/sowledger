import { STRIPE_PLANS, type StripePlanId } from "@/lib/billing-plans";

const planFeatures: Record<StripePlanId, string[]> = {
  free: ["Planning and time tracking", "Analytics and exports", "API keys", "Time review and approvals"],
  pro: ["Shared work tools", "Invoices", "Client invoice review"],
  smb: ["Shared work tools", "Invoices", "Client invoice review", "Webhooks"],
  enterprise: ["Shared work tools", "Invoices", "Client invoice review", "Webhooks"],
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
