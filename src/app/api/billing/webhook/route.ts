import { NextResponse } from "next/server";
import { resolvePlanId } from "@/lib/plans";

export const runtime = "nodejs";

/**
 * Stripe webhook shape — syncs subscription status / plan when live.
 * Without STRIPE_WEBHOOK_SECRET, acknowledges with a clear operator note.
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

    if (
      event.type === "checkout.session.completed" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.created"
    ) {
      await applySubscriptionEvent(event);
    }

    if (event.type === "customer.subscription.deleted") {
      await markSubscriptionCanceled(event);
    }

    return NextResponse.json({ ok: true, received: true, type: event.type });
  } catch (err) {
    console.error("[billing/webhook]", err);
    return NextResponse.json(
      { ok: false, error: "Webhook verification or apply failed." },
      { status: 400 },
    );
  }
}

async function applySubscriptionEvent(event: {
  type: string;
  data: { object: unknown };
}) {
  if (!process.env.DATABASE_URL) return;
  const obj = event.data.object as {
    metadata?: { organizationId?: string; planKey?: string };
    customer?: string;
    subscription?: string;
    id?: string;
    status?: string;
    current_period_end?: number;
    cancel_at_period_end?: boolean;
  };

  const organizationId = obj.metadata?.organizationId?.trim();
  if (!organizationId) return;

  const planKey = resolvePlanId(obj.metadata?.planKey ?? "patron");
  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();
  const plan = await prisma.subscriptionPlan.findUnique({
    where: { key: planKey },
  });
  if (!plan) return;

  const stripeCustomerId =
    typeof obj.customer === "string" ? obj.customer : null;
  const stripeSubscriptionId =
    typeof obj.subscription === "string"
      ? obj.subscription
      : event.type.startsWith("customer.subscription")
        ? obj.id ?? null
        : null;

  const existing = await prisma.subscription.findFirst({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
  });

  const periodEnd = obj.current_period_end
    ? new Date(obj.current_period_end * 1000)
    : null;

  if (existing) {
    await prisma.subscription.update({
      where: { id: existing.id },
      data: {
        planId: plan.id,
        status: mapStripeStatus(obj.status),
        stripeCustomerId: stripeCustomerId ?? existing.stripeCustomerId,
        stripeSubscriptionId:
          stripeSubscriptionId ?? existing.stripeSubscriptionId,
        currentPeriodEnd: periodEnd ?? existing.currentPeriodEnd,
        cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
      },
    });
  } else {
    await prisma.subscription.create({
      data: {
        organizationId,
        planId: plan.id,
        status: mapStripeStatus(obj.status),
        stripeCustomerId,
        stripeSubscriptionId,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
      },
    });
  }
}

async function markSubscriptionCanceled(event: {
  data: { object: unknown };
}) {
  if (!process.env.DATABASE_URL) return;
  const obj = event.data.object as {
    id?: string;
    metadata?: { organizationId?: string };
  };
  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();
  if (obj.id) {
    await prisma.subscription.updateMany({
      where: { stripeSubscriptionId: obj.id },
      data: { status: "CANCELED", cancelAtPeriodEnd: false },
    });
  }
}

function mapStripeStatus(
  status: string | undefined,
): "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE" {
  switch (status) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    default:
      return "INCOMPLETE";
  }
}
