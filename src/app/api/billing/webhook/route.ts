import { NextResponse } from "next/server";
import {
  applySubscriptionChange,
  normalizeStripeEvent,
  type PrismaForWebhook,
  type StripeWebhookObject,
} from "@/lib/billing/stripe-webhook";

export const runtime = "nodejs";

/**
 * Stripe webhook — syncs subscription status / plan / trial into Neon.
 *
 * Handled events:
 * - checkout.session.completed            → create/attach the subscription
 * - customer.subscription.created/updated → refresh plan, status, period, trial
 * - customer.subscription.deleted         → mark canceled (downgrade to free)
 * - invoice.payment_failed                → mark past due (grace, with warning)
 *
 * Without STRIPE_WEBHOOK_SECRET / STRIPE_SECRET_KEY it acknowledges with a
 * clear operator note and applies nothing (test-mode safe).
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!stripeKey || !secret) {
    return NextResponse.json({
      ok: true,
      stub: true,
      received: true,
      note: "Billing not live — STRIPE_WEBHOOK_SECRET / STRIPE_SECRET_KEY missing. Event not applied.",
    });
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(stripeKey);
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature ?? "",
      secret,
    );

    let obj = event.data.object as StripeWebhookObject;

    // On checkout completion, the session lacks the subscription's status,
    // period, and trial. Retrieve the live subscription so state is accurate.
    if (event.type === "checkout.session.completed") {
      const subId =
        typeof obj.subscription === "string"
          ? obj.subscription
          : obj.subscription?.id;
      if (subId) {
        try {
          const sub = (await stripe.subscriptions.retrieve(
            subId,
          )) as unknown as StripeWebhookObject;
          // Preserve checkout metadata (organizationId / planKey) if the
          // subscription object is missing it.
          obj = {
            ...sub,
            metadata: {
              ...(sub.metadata ?? {}),
              organizationId:
                sub.metadata?.organizationId ??
                obj.metadata?.organizationId,
              planKey: sub.metadata?.planKey ?? obj.metadata?.planKey,
            },
          };
          const change = normalizeStripeEvent(
            "customer.subscription.updated",
            obj,
          );
          await applyIfConfigured(change);
          return NextResponse.json({
            ok: true,
            received: true,
            type: event.type,
          });
        } catch (retrieveErr) {
          console.warn(
            "[billing/webhook] subscription retrieve failed; using session",
            retrieveErr,
          );
        }
      }
    }

    const change = normalizeStripeEvent(event.type, obj);
    const result = await applyIfConfigured(change);

    return NextResponse.json({
      ok: true,
      received: true,
      type: event.type,
      applied: result?.applied ?? false,
    });
  } catch (err) {
    console.error("[billing/webhook]", err);
    return NextResponse.json(
      { ok: false, error: "Webhook verification or apply failed." },
      { status: 400 },
    );
  }
}

async function applyIfConfigured(
  change: ReturnType<typeof normalizeStripeEvent>,
) {
  if (!process.env.DATABASE_URL) return null;
  if (change.kind === "ignore") return { applied: false };
  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma() as unknown as PrismaForWebhook;
  return applySubscriptionChange(prisma, change);
}
