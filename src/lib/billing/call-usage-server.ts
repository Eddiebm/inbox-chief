/**
 * Server-side loaders for org call-minute usage (CallSession → soft-cap meter).
 */

import {
  aggregateCallMinuteUsage,
  emptyCallMinuteUsage,
  planForUsageKey,
  resolveBillingPeriod,
  type CallMinuteUsage,
  type CallSessionUsageRow,
} from "@/lib/billing/call-usage";
import { getDefaultPlan } from "@/lib/plans";

export type {
  CallMinuteUsage,
  CallUsageWarningLevel,
} from "@/lib/billing/call-usage";

export {
  aggregateCallMinuteUsage,
  buildPlainUsageSummary,
  buildSpokenUsageSummary,
  buildSpokenUsageWarning,
  emptyCallMinuteUsage,
  warningLevelForUsage,
} from "@/lib/billing/call-usage";

/**
 * Load included/used/overage call minutes for an organization this billing period.
 */
export async function loadCallMinuteUsageForOrg(
  organizationId: string,
): Promise<CallMinuteUsage> {
  if (
    !organizationId ||
    organizationId === "demo_org" ||
    organizationId === "unrecognized" ||
    process.env.MOCK_INTEGRATIONS === "true" ||
    !process.env.DATABASE_URL
  ) {
    return emptyCallMinuteUsage(getDefaultPlan());
  }

  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();

  const subscription = await prisma.subscription.findFirst({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
    include: { plan: true },
  });

  const plan = planForUsageKey(subscription?.plan?.key ?? getDefaultPlan().id);
  const { periodStart, periodEnd } = resolveBillingPeriod({
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
  });

  const sessions = await prisma.callSession.findMany({
    where: {
      organizationId,
      channel: "PHONE",
      startedAt: { gte: periodStart, lt: periodEnd },
    },
    select: {
      durationSeconds: true,
      costUsd: true,
      startedAt: true,
    },
  });

  const rows: CallSessionUsageRow[] = sessions.map((s) => {
    const cost =
      s.costUsd == null
        ? null
        : typeof s.costUsd === "number"
          ? s.costUsd
          : Number(s.costUsd);
    return {
      durationSeconds: s.durationSeconds,
      costUsd: cost != null && Number.isFinite(cost) ? cost : null,
      startedAt: s.startedAt,
    };
  });

  return aggregateCallMinuteUsage({
    plan,
    rows,
    periodStart,
    periodEnd,
  });
}
