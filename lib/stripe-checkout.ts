import type Stripe from "stripe";

type ActiveBillingInput = {
  stripeSubscriptionId?: string | null;
  plan?: string | null;
};

type CheckoutPlan = {
  planId: string;
  priceId: string;
};

type BuildStripeCheckoutParamsInput = {
  workspaceId: string;
  plan: CheckoutPlan;
  customerEmail: string;
  stripeCustomerId?: string | null;
  appUrl?: string;
};

export function hasActivePaidBilling({ stripeSubscriptionId, plan }: ActiveBillingInput) {
  return Boolean(stripeSubscriptionId || plan !== "free");
}

export function buildStripeCheckoutParams({
  workspaceId,
  plan,
  customerEmail,
  stripeCustomerId,
  appUrl = "http://localhost:3000",
}: BuildStripeCheckoutParamsInput): Stripe.Checkout.SessionCreateParams {
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    client_reference_id: workspaceId,
    line_items: [
      {
        price: plan.priceId,
        quantity: 1,
      },
    ],
    success_url: `${appUrl}/settings/billing?success=true`,
    cancel_url: `${appUrl}/settings/billing?canceled=true`,
    subscription_data: {
      metadata: {
        workspaceId,
        planId: plan.planId,
      },
    },
    metadata: {
      workspaceId,
      planId: plan.planId,
    },
  };

  if (stripeCustomerId) {
    params.customer = stripeCustomerId;
  } else {
    params.customer_email = customerEmail;
  }

  return params;
}
