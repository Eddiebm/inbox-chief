import Stripe from "stripe";

export type CreateStripeCheckoutSessionInput = {
  mode: "payment" | "subscription";
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerId?: string;
  customerEmail?: string;
  metadata: Record<string, string>;
  subscriptionMetadata?: Record<string, string>;
};

export type CreatedStripeCheckoutSession = {
  id: string;
  url: string | null;
};

/**
 * Shared Stripe Checkout Session create for dashboard and voice handoff.
 * Never collects a card on the phone — callers receive this session URL.
 */
export async function createStripeCheckoutSession(
  input: CreateStripeCheckoutSessionInput,
): Promise<CreatedStripeCheckoutSession> {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error("stripe_not_configured");
  }
  const stripe = new Stripe(secret);
  const session = await stripe.checkout.sessions.create({
    mode: input.mode,
    line_items: [{ price: input.priceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    ...(input.customerId ? { customer: input.customerId } : {}),
    ...(input.customerEmail && !input.customerId
      ? { customer_email: input.customerEmail }
      : {}),
    metadata: input.metadata,
    ...(input.mode === "subscription" && input.subscriptionMetadata
      ? {
          subscription_data: {
            metadata: input.subscriptionMetadata,
          },
        }
      : {}),
  });
  return { id: session.id, url: session.url };
}
