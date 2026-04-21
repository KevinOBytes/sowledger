export const STRIPE_PLANS = {
  free: {
    planId: "free",
    name: "Free",
    description: "For freelancers and individuals getting started.",
    price: 0,
    priceId: "", // Free tier has no price ID
    features: ["time-tracking"],
    limits: { members: 3, projects: 5, storageMB: 100, goals: 3 },
  },
  pro: {
    planId: "pro",
    name: "Pro",
    description: "Unlimited tracking and basic invoicing for solopreneurs.",
    price: 15, // $15 / month
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO || "price_dummy_pro",
    features: ["time-tracking", "invoicing"],
    limits: { members: 5, projects: 20, storageMB: 1000, goals: 20 },
  },
  smb: {
    planId: "smb",
    name: "SMB",
    description: "Advanced tools and custom approvals for small teams.",
    price: 49, // $49 / month
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_SMB || "price_dummy_smb",
    features: ["time-tracking", "invoicing", "approvals"],
    limits: { members: 20, projects: 50, storageMB: 5000, goals: 50 },
  },
  enterprise: {
    planId: "enterprise",
    name: "Enterprise",
    description: "Custom schema and unlimited scale for large orgs.",
    price: 199, // $199 / month 
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE || "price_dummy_enterprise",
    features: ["time-tracking", "invoicing", "approvals", "advanced-reports", "saml"],
    limits: { members: 9999, projects: 9999, storageMB: 999999, goals: 9999 },
  },
};

export function getPlanByPriceId(priceId: string) {
  return Object.values(STRIPE_PLANS).find((plan) => plan.priceId === priceId) || STRIPE_PLANS.free;
}
