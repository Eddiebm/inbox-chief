import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";
import { isOperatorEmail } from "@/lib/operator";

export const runtime = "nodejs";

const portalSchema = z.object({
  organizationId: z.string().min(1).optional(),
  returnUrl: z.string().url().optional(),
});

/**
 * Open the Stripe Customer Billing Portal so a patron can update their card or
 * cancel. Requires STRIPE_SECRET_KEY and a stored stripeCustomerId for the org
 * (created when their first checkout completes). Falls back to a clear,
 * plain-language message when billing is not live yet.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = portalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "organizationId is required." },
      { status: 400 },
    );
  }

  const user = await getCurrentUser();
  const isOperator = user?.email ? isOperatorEmail(user.email) : false;

  if (!process.env.STRIPE_SECRET_KEY?.trim()) {
    return NextResponse.json(
      {
        ok: false,
        reason: "stripe_not_configured",
        message: isOperator
          ? "Billing not live — set STRIPE_SECRET_KEY."
          : "The billing portal is not available yet. Please contact support.",
      },
      { status: 503 },
    );
  }

  const origin = new URL(request.url).origin;
  const returnUrl = parsed.data.returnUrl ?? `${origin}/dashboard/billing`;

  const scope =
    user && user.id !== "mock_user"
      ? await resolveUserMailboxScope(user.id)
      : null;
  const organizationId =
    scope?.organizationId ?? parsed.data.organizationId ?? null;

  const customerId = await loadStripeCustomerId(organizationId);
  if (!customerId) {
    return NextResponse.json(
      {
        ok: false,
        reason: "no_subscription",
        message:
          "You do not have a paid subscription to manage yet. Choose a plan to subscribe.",
      },
      { status: 409 },
    );
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return NextResponse.json({
      ok: true,
      url: session.url,
      organizationId,
    });
  } catch (err) {
    console.error("[billing/portal]", err);
    return NextResponse.json(
      {
        error: isOperator
          ? "Stripe portal failed — confirm the Billing Portal is enabled in Stripe settings."
          : "Could not open the billing portal. Please try again or contact support.",
      },
      { status: 500 },
    );
  }
}

async function loadStripeCustomerId(
  organizationId: string | null,
): Promise<string | null> {
  if (!organizationId || !process.env.DATABASE_URL?.trim()) return null;
  if (process.env.MOCK_INTEGRATIONS === "true") return null;
  try {
    const { getNodePrisma } = await import("@/lib/db-node");
    const prisma = getNodePrisma();
    const sub = await prisma.subscription.findFirst({
      where: { organizationId, stripeCustomerId: { not: null } },
      orderBy: { updatedAt: "desc" },
      select: { stripeCustomerId: true },
    });
    return sub?.stripeCustomerId ?? null;
  } catch (err) {
    console.error("[billing/portal] customer lookup", err);
    return null;
  }
}
