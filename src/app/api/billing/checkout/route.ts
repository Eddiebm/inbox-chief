import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";
import { getPlan, resolvePlanId, stripePriceEnvKey } from "@/lib/plans";
import { isOperatorEmail } from "@/lib/operator";

const checkoutSchema = z.object({
  organizationId: z.string().min(1).optional(),
  planKey: z.enum([
    "patron",
    "pro",
    "business",
    "solo",
    "professional",
    "executive",
  ]),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
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
      { error: "planKey is required." },
      { status: 400 },
    );
  }

  const planKey = resolvePlanId(parsed.data.planKey);
  const plan = getPlan(planKey);
  if (!plan || plan.price.kind !== "monthly") {
    return NextResponse.json(
      { error: "That plan is not available for self-serve checkout." },
      { status: 400 },
    );
  }

  const user = await getCurrentUser();
  const isOperator = user?.email ? isOperatorEmail(user.email) : false;
  const scope =
    user && user.id !== "mock_user"
      ? await resolveUserMailboxScope(user.id)
      : null;
  const organizationId =
    scope?.organizationId ?? parsed.data.organizationId ?? null;

  if (!stripeConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        reason: "stripe_not_configured",
        // Only operators see env guidance; patrons get a short support line.
        message: isOperator
          ? "Billing not live — set STRIPE_SECRET_KEY and STRIPE_PRICE_PATRON / STRIPE_PRICE_PRO."
          : "Checkout is not available yet. Please contact support.",
      },
      { status: 503 },
    );
  }

  const priceId = priceIdForPlan(planKey);
  const origin = new URL(request.url).origin;
  const successUrl =
    parsed.data.successUrl ??
    `${origin}/dashboard/billing?checkout=success`;
  const cancelUrl =
    parsed.data.cancelUrl ?? `${origin}/dashboard/billing?checkout=cancel`;

  if (!priceId) {
    // Keys present but price IDs missing — stub session for operator wiring.
    return NextResponse.json({
      ok: true,
      stub: true,
      sessionId: `cs_test_stub_${planKey}`,
      url: `${successUrl}${successUrl.includes("?") ? "&" : "?"}stub=1`,
      organizationId,
      planKey,
      message: isOperator
        ? `Billing not live for ${planKey} — set ${stripePriceEnvKey(planKey)}.`
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
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      ...(customerId ? { customer: customerId } : {}),
      ...(user?.email && !customerId ? { customer_email: user.email } : {}),
      metadata: {
        organizationId: organizationId ?? "",
        planKey,
        userId: user?.id ?? "",
      },
      subscription_data: {
        metadata: {
          organizationId: organizationId ?? "",
          planKey,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      stub: false,
      sessionId: session.id,
      url: session.url,
      organizationId,
      planKey,
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
