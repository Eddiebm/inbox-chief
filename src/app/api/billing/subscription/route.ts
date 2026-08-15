import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";
import {
  billingStatusSummary,
  resolveEntitlements,
} from "@/lib/billing/entitlements";
import { getDefaultPlan } from "@/lib/plans";

export const runtime = "nodejs";

/**
 * Current subscription + entitlement summary for the signed-in user's org.
 * Drives the accessible billing panel: current plan, trial countdown, whether
 * to prompt an upgrade, and whether a manage-subscription link is available.
 * Plain-language and spoken-friendly — safe to read aloud.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "authentication_required" },
      { status: 401 },
    );
  }

  const billingLive = Boolean(
    process.env.STRIPE_SECRET_KEY?.trim() &&
      process.env.STRIPE_PRICE_PATRON?.trim() &&
      process.env.STRIPE_PRICE_PRO?.trim(),
  );

  if (user.id === "mock_user" || process.env.MOCK_INTEGRATIONS === "true") {
    const entitlements = resolveEntitlements({
      planKey: getDefaultPlan().id,
      status: "TRIALING",
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    });
    return NextResponse.json({
      ok: true,
      isMock: true,
      billingLive,
      canManage: false,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEndsAt: entitlements.trialDaysRemaining,
      statusSummary: billingStatusSummary(entitlements),
      entitlements,
    });
  }

  const scope = await resolveUserMailboxScope(user.id);
  if (!scope || !process.env.DATABASE_URL?.trim()) {
    const entitlements = resolveEntitlements({
      planKey: getDefaultPlan().id,
      status: "TRIALING",
      trialEndsAt: null,
    });
    return NextResponse.json({
      ok: true,
      isMock: false,
      billingLive,
      canManage: false,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      statusSummary: billingStatusSummary(entitlements),
      entitlements,
    });
  }

  try {
    const { getNodePrisma } = await import("@/lib/db-node");
    const prisma = getNodePrisma();
    const subscription = await prisma.subscription.findFirst({
      where: { organizationId: scope.organizationId },
      orderBy: { updatedAt: "desc" },
      include: { plan: true },
    });

    const entitlements = resolveEntitlements({
      planKey: subscription?.plan?.key ?? getDefaultPlan().id,
      status: subscription?.status ?? "TRIALING",
      trialEndsAt: subscription?.trialEndsAt ?? null,
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    });

    return NextResponse.json({
      ok: true,
      isMock: false,
      billingLive,
      organizationId: scope.organizationId,
      canManage: Boolean(subscription?.stripeCustomerId),
      currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
      trialEndsAt: subscription?.trialEndsAt?.toISOString() ?? null,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      statusSummary: billingStatusSummary(entitlements),
      entitlements,
    });
  } catch (err) {
    console.error("[billing/subscription]", err);
    return NextResponse.json(
      { ok: false, error: "Could not load subscription." },
      { status: 500 },
    );
  }
}
