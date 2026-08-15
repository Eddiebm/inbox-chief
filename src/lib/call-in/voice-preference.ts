/**
 * Load / save call-in voice tier preference (AccessibilityPreference).
 * Applies plan gating + minute-based cost guardrail (auto-Standard at ≥80%).
 */

import type { CallUsageWarningLevel } from "@/lib/billing/call-usage";
import { resolveEntitlements } from "@/lib/billing/entitlements";
import { getDefaultPlan } from "@/lib/plans";
import {
  dbVoiceTier,
  defaultVoiceTierForPlan,
  fromDbVoiceTier,
  parseVoiceTier,
  planAllowsPremiumVoice,
  resolveEffectiveVoiceTier,
  speakCostGuardVoiceTip,
  speakStandardVoiceTip,
  voiceTierInfo,
  type CallInVoiceTierId,
} from "@/lib/call-in/voice-tiers";

export type ResolvedCallInVoice = {
  planId: string;
  preferred: CallInVoiceTierId;
  effective: CallInVoiceTierId;
  allowsPremium: boolean;
  tipSpoken: boolean;
  costGuardActive: boolean;
  /** Spoken tip to prepend once (null if already spoken or not applicable). */
  spokenTip: string | null;
  voice: ReturnType<typeof voiceTierInfo>["vapi"];
};

function costGuardFromWarning(
  level: CallUsageWarningLevel | null | undefined,
): boolean {
  return level === "approaching" || level === "at_limit";
}

/**
 * Resolve voice for an org/user on an inbound call.
 * Marks tip as spoken when returning a tip (best-effort).
 */
export async function resolveCallInVoiceForUser(input: {
  userId: string;
  organizationId: string;
}): Promise<ResolvedCallInVoice> {
  const planId = await loadOrgPlanId(input.organizationId);
  const allowsPremium = planAllowsPremiumVoice(planId);
  const usageLevel = await loadUsageWarningLevel(input.organizationId);
  const costGuardPreferStandard = costGuardFromWarning(usageLevel);

  if (
    process.env.MOCK_INTEGRATIONS === "true" ||
    !process.env.DATABASE_URL ||
    !input.userId ||
    input.userId === "unrecognized"
  ) {
    const preferred = defaultVoiceTierForPlan(planId);
    const effective = resolveEffectiveVoiceTier({
      planId,
      preferred,
      costGuardPreferStandard,
    });
    return {
      planId,
      preferred,
      effective,
      allowsPremium,
      tipSpoken: true,
      costGuardActive: costGuardPreferStandard && preferred === "premium",
      spokenTip: null,
      voice: voiceTierInfo(effective).vapi,
    };
  }

  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();

  let prefs = await prisma.accessibilityPreference.findUnique({
    where: { userId: input.userId },
    select: {
      callInVoiceTier: true,
      callInVoiceTipSpoken: true,
      callInCostGuardTipSpoken: true,
    },
  });

  if (!prefs) {
    const preferred = defaultVoiceTierForPlan(planId);
    prefs = await prisma.accessibilityPreference.create({
      data: {
        userId: input.userId,
        callInVoiceTier: dbVoiceTier(preferred),
        screenReaderOptimized: true,
        preferVoiceOnboarding: true,
      },
      select: {
        callInVoiceTier: true,
        callInVoiceTipSpoken: true,
        callInCostGuardTipSpoken: true,
      },
    });
  }

  const preferred = fromDbVoiceTier(prefs.callInVoiceTier);
  const effective = resolveEffectiveVoiceTier({
    planId,
    preferred,
    costGuardPreferStandard,
  });
  const costGuardActive =
    costGuardPreferStandard &&
    preferred === "premium" &&
    effective === "standard";

  let tipSpoken = prefs.callInVoiceTipSpoken;
  let spokenTip: string | null = null;

  if (costGuardActive && !prefs.callInCostGuardTipSpoken) {
    spokenTip = speakCostGuardVoiceTip();
    try {
      await prisma.accessibilityPreference.update({
        where: { userId: input.userId },
        data: { callInCostGuardTipSpoken: true },
      });
    } catch {
      /* tip may repeat once — acceptable */
    }
  } else if (!tipSpoken && effective === "standard" && !allowsPremium) {
    spokenTip = speakStandardVoiceTip();
    try {
      await prisma.accessibilityPreference.update({
        where: { userId: input.userId },
        data: { callInVoiceTipSpoken: true },
      });
      tipSpoken = true;
    } catch {
      /* tip may repeat once — acceptable */
    }
  }

  return {
    planId,
    preferred,
    effective,
    allowsPremium,
    tipSpoken,
    costGuardActive,
    spokenTip,
    voice: voiceTierInfo(effective).vapi,
  };
}

async function loadUsageWarningLevel(
  organizationId: string,
): Promise<CallUsageWarningLevel | null> {
  if (
    !organizationId ||
    organizationId === "demo_org" ||
    organizationId === "unrecognized" ||
    process.env.MOCK_INTEGRATIONS === "true" ||
    !process.env.DATABASE_URL
  ) {
    return null;
  }
  try {
    const { loadCallMinuteUsageForOrg } = await import(
      "@/lib/billing/call-usage-server"
    );
    const usage = await loadCallMinuteUsageForOrg(organizationId);
    return usage.warningLevel;
  } catch {
    return null;
  }
}

async function loadOrgPlanId(organizationId: string): Promise<string> {
  if (
    !organizationId ||
    organizationId === "demo_org" ||
    organizationId === "unrecognized" ||
    process.env.MOCK_INTEGRATIONS === "true" ||
    !process.env.DATABASE_URL
  ) {
    return getDefaultPlan().id;
  }
  try {
    const { getNodePrisma } = await import("@/lib/db-node");
    const prisma = getNodePrisma();
    const sub = await prisma.subscription.findFirst({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
      include: { plan: true },
    });
    // Gate on the *entitled* plan so a canceled/lapsed Pro loses premium voice.
    const entitlements = resolveEntitlements({
      planKey: sub?.plan?.key ?? getDefaultPlan().id,
      status: sub?.status ?? "TRIALING",
      trialEndsAt: sub?.trialEndsAt ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
    });
    return entitlements.effectivePlanId;
  } catch {
    return getDefaultPlan().id;
  }
}

export async function getCallInVoicePreferenceForUser(userId: string): Promise<{
  planId: string;
  preferred: CallInVoiceTierId;
  effective: CallInVoiceTierId;
  allowsPremium: boolean;
  costGuardActive: boolean;
  costGuardPreferStandard: boolean;
} | null> {
  if (!userId || userId === "mock_user") return null;
  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();
  const membership = await prisma.organizationMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  const planId = membership
    ? await loadOrgPlanId(membership.organizationId)
    : getDefaultPlan().id;
  const prefs = await prisma.accessibilityPreference.findUnique({
    where: { userId },
    select: { callInVoiceTier: true },
  });
  const preferred = prefs
    ? fromDbVoiceTier(prefs.callInVoiceTier)
    : defaultVoiceTierForPlan(planId);
  const usageLevel = membership
    ? await loadUsageWarningLevel(membership.organizationId)
    : null;
  const costGuardPreferStandard = costGuardFromWarning(usageLevel);
  const effective = resolveEffectiveVoiceTier({
    planId,
    preferred,
    costGuardPreferStandard,
  });
  return {
    planId,
    preferred,
    effective,
    allowsPremium: planAllowsPremiumVoice(planId),
    costGuardActive:
      costGuardPreferStandard &&
      preferred === "premium" &&
      effective === "standard",
    costGuardPreferStandard,
  };
}

export async function setCallInVoicePreference(input: {
  userId: string;
  tier: string;
}): Promise<{
  preferred: CallInVoiceTierId;
  effective: CallInVoiceTierId;
  allowsPremium: boolean;
  planId: string;
  costGuardActive: boolean;
  blocked?: "premium_requires_pro";
}> {
  const requested = parseVoiceTier(input.tier);
  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();
  const membership = await prisma.organizationMember.findFirst({
    where: { userId: input.userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  const planId = membership
    ? await loadOrgPlanId(membership.organizationId)
    : getDefaultPlan().id;
  const allowsPremium = planAllowsPremiumVoice(planId);
  const usageLevel = membership
    ? await loadUsageWarningLevel(membership.organizationId)
    : null;
  const costGuardPreferStandard = costGuardFromWarning(usageLevel);

  if (requested === "premium" && !allowsPremium) {
    const preferred: CallInVoiceTierId = "standard";
    await prisma.accessibilityPreference.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        callInVoiceTier: "STANDARD",
        screenReaderOptimized: true,
        preferVoiceOnboarding: true,
      },
      update: { callInVoiceTier: "STANDARD" },
    });
    return {
      preferred,
      effective: "standard",
      allowsPremium,
      planId,
      costGuardActive: false,
      blocked: "premium_requires_pro",
    };
  }

  await prisma.accessibilityPreference.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      callInVoiceTier: dbVoiceTier(requested),
      screenReaderOptimized: true,
      preferVoiceOnboarding: true,
    },
    update: { callInVoiceTier: dbVoiceTier(requested) },
  });

  const effective = resolveEffectiveVoiceTier({
    planId,
    preferred: requested,
    costGuardPreferStandard,
  });

  return {
    preferred: requested,
    effective,
    allowsPremium,
    planId,
    costGuardActive:
      costGuardPreferStandard &&
      requested === "premium" &&
      effective === "standard",
  };
}
