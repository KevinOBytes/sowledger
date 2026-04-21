import Stripe from "stripe";
import { env } from "./env";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY || "sk_test_dummy", {
  apiVersion: "2026-02-25.clover",
  typescript: true,
  appInfo: {
    name: "Billabled",
    version: "0.1.0",
  },
});
