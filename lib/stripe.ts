import Stripe from "stripe";
import { env } from "./env";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY || "sk_test_dummy", {
  apiVersion: "2025-02-24.acacia" as any, // fallback to ignore type error if SDK demands different version
  typescript: true,
  appInfo: {
    name: "Billabled",
    version: "0.1.0",
  },
});
