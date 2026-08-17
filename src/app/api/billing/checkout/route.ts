import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { resolveBillingOrganization } from "@/lib/billing/org-access";
import {
  getMinutePack,
  getPlan,
  resolvePlanId,
  stripeMinutePackPriceId,
  stripePriceEnvKey,
} from "@/lib/plans";
import { isOperatorEmail } from "@/lib/operator";
import { sameOriginRedirect } from "@/lib/security/redirects";

export const runtime = "nodejs";

const checkoutSchema = z.object({
  organizationId: z.string().min(1).optional(),
  planKey: z
    .enum([
      "patron",
      "pro",
      "business",
      "solo",
      "professional",
      "executive",
    ])
    .optional(),
  minutePackKey: z.enum(["pack_30", "pack_60", "pack_120"]).optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
}).refine((value) => Boolean(value.planKey) !== Boolean(value.minutePackKey), {
  message: "Choose one plan or minute pack.",
});

function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

function priceIdForPlan(planKey: string): string | null {
  const key = stripePriceEnvKey(planKey);
  return process.env[key]?.trim() || null;
}

/**
 * Create a Stripe Checkout Session when STRIPE_SECRET_KEY + STRIPE_PRICE_* exist.
 * Otherwise returns stripe_not_configured (operator-facing) or a clear stub.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose one plan or minute pack." },
      { status: 400 },
    );
  }

  const minutePack = parsed.data.minutePackKey
    ? getMinutePack(parsed.data.minutePackKey)
    : null;
  const planKey = parsed.data.planKey
    ? resolvePlanId(parsed.data.planKey)
    : null;
  const plan = planKey ? getPlan(planKey) : null;
  if (!minutePack && (!plan || plan.price.kind !== "monthly")) {
    return NextResponse.json(
      { error: "That plan is not available for self-serve checkout." },
      { status: 400 },
    );
  }

  const user = await getCurrentUser();
  const isOperator = user?.email ? isOperatorEmail(user.email) : false;

  // The org is bound from the session; a client-supplied id is only accepted
  // when the caller is actually a member of it.
  const orgResult = await resolveBillingOrganization({
    userId: user?.id,
    requestedOrganizationId: parsed.data.organizationId,
  });
  if (!orgResult.ok) {
    return NextResponse.json(
      { error: orgResult.error },
      { status: orgResult.status },
    );
  }
  const organizationId = orgResult.organizationId;
  if (minutePack && (!user || !organizationId)) {
    return NextResponse.json(
      { error: "Sign in to buy minutes for your organization." },
      { status: 401 },
    );
  }

  if (!stripeConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        reason: "stripe_not_configured",
        // Only operators see env guidance; patrons get a short support line.
        message: isOperator
          ? "Billing not live — set STRIPE_SECRET_KEY and the Stripe plan / minute-pack price IDs."
          : "Checkout is not available yet. Please contact support.",
      },
      { status: 503 },
    );
  }

  const priceId = minutePack
    ? stripeMinutePackPriceId(minutePack.id)
    : priceIdForPlan(planKey!);
  const origin = new URL(request.url).origin;
  for (const [field, value] of [
    ["successUrl", parsed.data.successUrl],
    ["cancelUrl", parsed.data.cancelUrl],
  ] as const) {
    if (value && !sameOriginRedirect(value, origin)) {
      return NextResponse.json(
        { error: `${field} must point back to Inbox Chief.` },
        { status: 400 },
      );
    }
  }
  const successUrl =
    sameOriginRedirect(parsed.data.successUrl, origin) ??
    `${origin}/dashboard/billing?checkout=success`;
  const cancelUrl =
    sameOriginRedirect(parsed.data.cancelUrl, origin) ??
    `${origin}/dashboard/billing?checkout=cancel`;

  if (!priceId) {
    // Keys present but price IDs missing — stub session for operator wiring.
    return NextResponse.json({
      ok: true,
      stub: true,
      sessionId: `cs_test_stub_${minutePack?.id ?? planKey}`,
      url: `${successUrl}${successUrl.includes("?") ? "&" : "?"}stub=1`,
      organizationId,
      planKey,
      minutePackKey: minutePack?.id ?? null,
      message: isOperator
        ? `Billing not live for ${minutePack?.id ?? planKey} — set ${
            minutePack?.stripePriceEnvKey ?? stripePriceEnvKey(planKey!)
          }.`
        : "Checkout is almost ready. Please contact support.",
    });
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    let customerId: string | undefined;
    if (organizationId && process.env.DATABASE_URL) {
      const { getNodePrisma } = await import("@/lib/db-node");
      const prisma = getNodePrisma();
      const sub = await prisma.subscription.findFirst({
        where: { organizationId },
        orderBy: { updatedAt: "desc" },
        select: { stripeCustomerId: true },
      });
      customerId = sub?.stripeCustomerId ?? undefined;
    }

    const session = await stripe.checkout.sessions.create({
      mode: minutePack ? "payment" : "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      ...(customerId ? { customer: customerId } : {}),
      ...(user?.email && !customerId ? { customer_email: user.email } : {}),
      metadata: {
        organizationId: organizationId ?? "",
        planKey: planKey ?? "",
        purchaseKind: minutePack ? "minute_pack" : "subscription",
        minutePackKey: minutePack?.id ?? "",
        userId: user?.id ?? "",
      },
      ...(minutePack
        ? {}
        : {
            subscription_data: {
              metadata: {
                organizationId: organizationId ?? "",
                planKey: planKey!,
              },
            },
          }),
    });

    return NextResponse.json({
      ok: true,
      stub: false,
      sessionId: session.id,
      url: session.url,
      organizationId,
      planKey,
      minutePackKey: minutePack?.id ?? null,
    });
  } catch (err) {
    console.error("[billing/checkout]", err);
    return NextResponse.json(
      {
        error: isOperator
          ? "Stripe checkout failed — check price IDs and secret key."
          : "Could not start checkout. Please try again or contact support.",
      },
      { status: 500 },
    );
  }
}
