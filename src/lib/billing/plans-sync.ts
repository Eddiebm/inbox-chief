import {
  plans,
  stripePriceEnvKey,
  type Plan,
} from "@/lib/plans";

/** DB-shaped subscription plan row derived from `plans.ts`. */
export type SubscriptionPlanSeed = {
  key: string;
  name: string;
  monthlyPriceUsd: number | null;
  customPricing: boolean;
  maxUsers: number | null;
  maxMailboxes: number | null;
  maxAssistants: number | null;
  /** Included call-in minutes / month (stored for ops; app also reads plans.ts). */
  aiUsageMonthly: number | null;
  features: string[];
  stripePriceId: string | null;
  active: boolean;
};

export function planToSubscriptionSeed(plan: Plan): SubscriptionPlanSeed {
  const customPricing = plan.price.kind === "custom";
  const monthlyPriceUsd =
    plan.price.kind === "monthly" ? plan.price.amountUsd : null;
  const stripePriceId = process.env[stripePriceEnvKey(plan.id)] ?? null;

  return {
    key: plan.id,
    name: plan.name,
    monthlyPriceUsd,
    customPricing,
    maxUsers: plan.resourceLimits.maxUsers,
    maxMailboxes: plan.resourceLimits.maxMailboxes,
    maxAssistants: plan.resourceLimits.maxAssistants,
    // Reuse aiUsageMonthly column for included call minutes until a dedicated column exists.
    aiUsageMonthly: plan.callLimits.includedCallMinutes,
    features: [...plan.features],
    stripePriceId,
    active: true,
  };
}

/** Map all marketing plans to SubscriptionPlan upsert payloads. */
export function getSubscriptionPlanSeeds(): SubscriptionPlanSeed[] {
  return plans.map(planToSubscriptionSeed);
}
