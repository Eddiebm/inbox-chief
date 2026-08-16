/**
 * Server-side loaders + prepaid minute-pack wallet (credit / draw-down).
 *
 * Purchased minutes **roll over** across billing periods until consumed.
 * Included plan minutes reset each billing period (computed from CallSessions).
 */

import {
  aggregateCallMinuteUsage,
  emptyCallMinuteUsage,
  planForUsageKey,
  purchasedMinutesToDraw,
  resolveBillingPeriod,
  type CallMinuteUsage,
  type CallSessionUsageRow,
} from "@/lib/billing/call-usage";
import { getDefaultPlan, getMinutePack } from "@/lib/plans";

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
  purchasedMinutesToDraw,
  warningLevelForUsage,
} from "@/lib/billing/call-usage";

function roundMinutes(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Load included/used/purchased call minutes for an organization this period.
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

  const [sessions, balance] = await Promise.all([
    prisma.callSession.findMany({
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
    }),
    prisma.callMinuteBalance.findUnique({
      where: { organizationId },
      select: { purchasedMinutesRemaining: true },
    }),
  ]);

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
    purchasedMinutesRemaining: balance?.purchasedMinutesRemaining ?? 0,
  });
}

export type CreditMinutePackResult =
  | {
      credited: true;
      minutes: number;
      purchasedMinutesRemaining: number;
      purchaseId: string;
    }
  | { credited: false; reason: string };

/**
 * Credit prepaid minutes after a successful Stripe one-time checkout.
 * Idempotent on stripeCheckoutSessionId.
 */
export async function creditMinutePackPurchase(input: {
  organizationId: string;
  packId: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId?: string | null;
  amountUsdCents?: number | null;
}): Promise<CreditMinutePackResult> {
  const pack = getMinutePack(input.packId);
  if (!pack) return { credited: false, reason: "unknown_pack" };
  if (!input.organizationId) {
    return { credited: false, reason: "no_organization" };
  }
  if (!process.env.DATABASE_URL) {
    return { credited: false, reason: "no_database" };
  }

  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();

  const existing = await prisma.callMinutePackPurchase.findUnique({
    where: { stripeCheckoutSessionId: input.stripeCheckoutSessionId },
  });
  if (existing) {
    const balance = await prisma.callMinuteBalance.findUnique({
      where: { organizationId: input.organizationId },
    });
    return {
      credited: true,
      minutes: existing.minutesCredited,
      purchasedMinutesRemaining: balance?.purchasedMinutesRemaining ?? 0,
      purchaseId: existing.id,
    };
  }

  const amountUsdCents =
    input.amountUsdCents != null && Number.isFinite(input.amountUsdCents)
      ? Math.round(input.amountUsdCents)
      : Math.round(pack.priceUsd * 100);

  const result = await prisma.$transaction(async (tx) => {
    const balance = await tx.callMinuteBalance.upsert({
      where: { organizationId: input.organizationId },
      create: {
        organizationId: input.organizationId,
        purchasedMinutesRemaining: pack.minutes,
        purchasedMinutesLifetime: pack.minutes,
      },
      update: {
        purchasedMinutesRemaining: { increment: pack.minutes },
        purchasedMinutesLifetime: { increment: pack.minutes },
      },
    });

    const purchase = await tx.callMinutePackPurchase.create({
      data: {
        organizationId: input.organizationId,
        balanceId: balance.id,
        packId: pack.id,
        minutesCredited: pack.minutes,
        amountUsdCents,
        stripeCheckoutSessionId: input.stripeCheckoutSessionId,
        stripePaymentIntentId: input.stripePaymentIntentId ?? null,
      },
    });

    return { balance, purchase };
  });

  return {
    credited: true,
    minutes: pack.minutes,
    purchasedMinutesRemaining: result.balance.purchasedMinutesRemaining,
    purchaseId: result.purchase.id,
  };
}

export type DrawPurchasedMinutesResult = {
  drawn: number;
  purchasedMinutesRemaining: number;
};

/**
 * Draw purchased minutes for a completed call after included allotment.
 * Idempotent when the CallSession already has purchasedMinutesDrawn set.
 */
export async function drawPurchasedMinutesForCall(input: {
  organizationId: string;
  sessionId: string;
  callDurationMinutes: number;
  periodMinutesUsedBeforeCall: number;
  minutesIncluded: number;
}): Promise<DrawPurchasedMinutesResult> {
  if (!process.env.DATABASE_URL) {
    return { drawn: 0, purchasedMinutesRemaining: 0 };
  }

  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();

  const session = await prisma.callSession.findFirst({
    where: { id: input.sessionId, organizationId: input.organizationId },
    select: { purchasedMinutesDrawn: true },
  });
  if (!session) {
    return { drawn: 0, purchasedMinutesRemaining: 0 };
  }
  if (
    session.purchasedMinutesDrawn != null &&
    Number.isFinite(session.purchasedMinutesDrawn)
  ) {
    const balance = await prisma.callMinuteBalance.findUnique({
      where: { organizationId: input.organizationId },
    });
    return {
      drawn: session.purchasedMinutesDrawn,
      purchasedMinutesRemaining: balance?.purchasedMinutesRemaining ?? 0,
    };
  }

  const balance = await prisma.callMinuteBalance.findUnique({
    where: { organizationId: input.organizationId },
  });
  const current = balance?.purchasedMinutesRemaining ?? 0;
  const { draw, remainingBalance } = purchasedMinutesToDraw({
    callDurationMinutes: input.callDurationMinutes,
    periodMinutesUsedBeforeCall: input.periodMinutesUsedBeforeCall,
    minutesIncluded: input.minutesIncluded,
    purchasedBalance: current,
  });

  if (draw <= 0) {
    await prisma.callSession.updateMany({
      where: { id: input.sessionId, organizationId: input.organizationId },
      data: { purchasedMinutesDrawn: 0 },
    });
    return { drawn: 0, purchasedMinutesRemaining: roundMinutes(current) };
  }

  await prisma.$transaction(async (tx) => {
    if (balance) {
      await tx.callMinuteBalance.update({
        where: { id: balance.id },
        data: { purchasedMinutesRemaining: remainingBalance },
      });
    }
    await tx.callSession.updateMany({
      where: { id: input.sessionId, organizationId: input.organizationId },
      data: { purchasedMinutesDrawn: draw },
    });
  });

  return {
    drawn: draw,
    purchasedMinutesRemaining: remainingBalance,
  };
}
