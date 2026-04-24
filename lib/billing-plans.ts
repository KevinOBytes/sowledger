export const STRIPE_PLANS = {
  free: {
    planId: "free",
    name: "Free",
    description: "Try the full workflow on a small workspace before committing.",
    price: 0,
    priceId: "", // Free tier has no price ID
    features: ["time-tracking", "manual-logging"],
    limits: { members: 1, projects: 2, storageMB: 100, goals: 1 },
  },
  pro: {
    planId: "pro",
    name: "Starter",
    description: "Flat workspace pricing for solo operators who need invoices, exports, and planned work.",
    price: 9, // $9 / month flat workspace
    priceId: process.env.STRIPE_PRO_PRICE_ID || "price_dummy_pro",
    features: ["time-tracking", "manual-logging", "schedule", "analytics", "exports", "invoicing"],
    limits: { members: 2, projects: 10, storageMB: 1000, goals: 10 },
  },
  smb: {
    planId: "smb",
    name: "Studio",
    description: "Small-team operations with approvals, API keys, webhooks, and complete exports.",
    price: 29, // $29 / month flat workspace
    priceId: process.env.STRIPE_SMB_PRICE_ID || "price_dummy_smb",
    features: ["time-tracking", "manual-logging", "schedule", "analytics", "exports", "api", "webhooks", "invoicing", "approvals"],
    limits: { members: 5, projects: 50, storageMB: 5000, goals: 50 },
  },
  enterprise: {
    planId: "enterprise",
    name: "Business",
    description: "Growing firms that need more seats, audit depth, advanced API usage, and priority support.",
    price: 79, // $79 / month flat workspace
    priceId: process.env.STRIPE_ENTERPRISE_PRICE_ID || "price_dummy_enterprise",
    features: ["time-tracking", "manual-logging", "schedule", "analytics", "exports", "api", "webhooks", "invoicing", "approvals", "advanced-reports", "saml"],
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
