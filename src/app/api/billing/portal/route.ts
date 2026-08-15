import { NextResponse } from "next/server";
import { z } from "zod";

const portalSchema = z.object({
  organizationId: z.string().min(1),
  returnUrl: z.string().url().optional(),
});

/**
 * Stub: create a Stripe Customer Billing Portal session.
 * Requires STRIPE_SECRET_KEY and an existing stripeCustomerId on the org subscription.
 */
export async function POST(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { ok: false, reason: "stripe_not_configured" },
      { status: 503 },
    );
  }

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

  const origin = new URL(request.url).origin;
  return NextResponse.json({
    ok: true,
    stub: true,
    url: `${parsed.data.returnUrl ?? `${origin}/dashboard`}?portal=stub`,
    organizationId: parsed.data.organizationId,
  });
}
