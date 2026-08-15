import { getDefaultPlan } from "@/lib/plans";
import {
  planAllowsEmailCalls,
  resolveEntitlements,
  type PlanEntitlements,
} from "@/lib/billing/entitlements";
import type { PrismaClient } from "@/generated/prisma/client";

type PrismaForEmailCallPlan = Pick<PrismaClient, "subscription">;

export { planAllowsEmailCalls };

/**
 * Resolve whether an organization may use outbound email→call alerts.
 *
 * Gating keys off the *real* subscription state (plan + status + trial), not
 * just the stored plan key — a canceled or lapsed Pro plan loses the feature.
 */
export async function loadEmailCallPlan(
  prisma: PrismaForEmailCallPlan,
  organizationId: string,
  now: Date = new Date(),
): Promise<{
  planId: string;
  allowsEmailCalls: boolean;
  entitlements: PlanEntitlements;
}> {
  const subscription = await prisma.subscription.findFirst({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
    include: { plan: true },
  });

  const entitlements = resolveEntitlements({
    planKey: subscription?.plan?.key ?? getDefaultPlan().id,
    status: subscription?.status ?? "TRIALING",
    trialEndsAt: subscription?.trialEndsAt ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    now,
  });

  return {
    planId: entitlements.planId,
    allowsEmailCalls: entitlements.allowsEmailCalls,
    entitlements,
  };
}
