import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { resolveBillingOrganization } from "@/lib/billing/org-access";
import { isOperatorEmail } from "@/lib/operator";
import { sameOriginRedirect } from "@/lib/security/redirects";

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
  if (parsed.data.returnUrl && !sameOriginRedirect(parsed.data.returnUrl, origin)) {
    return NextResponse.json(
      { error: "returnUrl must point back to Inbox Chief." },
      { status: 400 },
    );
  }
  const returnUrl =
    sameOriginRedirect(parsed.data.returnUrl, origin) ??
    `${origin}/dashboard/billing`;

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
