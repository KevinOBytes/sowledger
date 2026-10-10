const coreFeatures = ["time-tracking", "manual-logging", "schedule", "analytics", "exports", "api", "approvals"];

export const STRIPE_PLANS = {
  free: {
    planId: "free",
    name: "Free",
    description: "Plan, track, review, and export work for one person and two projects.",
    price: 0,
    priceId: "", // Free tier has no price ID
    features: [...coreFeatures],
    limits: { members: 1, projects: 2, storageMB: 100, goals: 1 },
  },
  pro: {
    planId: "pro",
    name: "Starter",
    description: "Add invoicing, with room for two people and ten projects.",
    price: 9, // $9 / month flat workspace
    priceId: process.env.STRIPE_PRO_PRICE_ID || "price_dummy_pro",
    features: [...coreFeatures, "invoicing"],
    limits: { members: 2, projects: 10, storageMB: 1000, goals: 10 },
  },
  smb: {
    planId: "smb",
    name: "Studio",
    description: "Add webhooks and more room: five people and 50 projects.",
    price: 29, // $29 / month flat workspace
    priceId: process.env.STRIPE_SMB_PRICE_ID || "price_dummy_smb",
    features: [...coreFeatures, "invoicing", "webhooks"],
    limits: { members: 5, projects: 50, storageMB: 5000, goals: 50 },
  },
  enterprise: {
    planId: "enterprise",
    name: "Business",
    description: "Everything in Studio, with room for up to 20 people and 200 projects.",
    price: 79, // $79 / month flat workspace
    priceId: process.env.STRIPE_ENTERPRISE_PRICE_ID || "price_dummy_enterprise",
    features: [...coreFeatures, "invoicing", "webhooks"],
    limits: { members: 20, projects: 200, storageMB: 25000, goals: 200 },
  },
};

export type StripePlanId = keyof typeof STRIPE_PLANS;

export function getPaidPlanById(planId: string) {
  if (planId !== "pro" && planId !== "smb" && planId !== "enterprise") return null;
  return STRIPE_PLANS[planId];
}

export function getPlanByPriceId(priceId: string) {
  return Object.values(STRIPE_PLANS).find((plan) => plan.priceId === priceId) || STRIPE_PLANS.free;
}
