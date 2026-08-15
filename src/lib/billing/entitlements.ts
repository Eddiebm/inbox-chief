/**
 * Subscription entitlements — the single source of truth for what a tenant is
 * allowed to use, derived from *real* subscription state (plan + status + trial).
 *
 * Pure and client-safe: no Prisma / no env reads, so it is easy to unit test and
 * to reuse from server loaders (email-call gating, premium voice, billing UI).
 *
 * Product rules (plain language):
 * - A trial that has not ended, an active paid plan, or a plan in a short
 *   past-due grace period all keep the tenant "in good standing".
 * - An expired trial, a canceled plan, or an incomplete signup drop the tenant
 *   to the base (free) entitlement: Pro-only features (outbound email→call
 *   alerts, premium voice) turn off until they subscribe again.
 */

import { getDefaultPlan, getPlan, resolvePlanId } from "@/lib/plans";
import { planAllowsPremiumVoice } from "@/lib/call-in/voice-tiers";

/**
 * Plans that include outbound new-Primary email → phone call alerts.
 * Single source of truth for Pro-alert gating (before status is considered).
 */
export function planAllowsEmailCalls(
  planId: string | null | undefined,
): boolean {
  const resolved = resolvePlanId(planId ?? getDefaultPlan().id);
  return resolved === "pro" || resolved === "business";
}

/** Mirrors the Prisma `SubscriptionStatus` enum without importing Prisma. */
export type SubscriptionStatusValue =
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED"
  | "INCOMPLETE";

export type SubscriptionStateInput = {
  planKey: string | null | undefined;
  status: SubscriptionStatusValue | null | undefined;
  trialEndsAt?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean | null;
  now?: Date;
};

export type PlanEntitlements = {
  /** Plan the tenant pays for (what they chose), resolved through aliases. */
  planId: string;
  /** Human plan name for spoken / shown copy. */
  planName: string;
  /** Plan used for feature gating — base plan when not in good standing. */
  effectivePlanId: string;
  status: SubscriptionStatusValue;
  /** Trial that has not yet ended. */
  trialing: boolean;
  /** Trial whose end date has passed with no active paid subscription. */
  trialExpired: boolean;
  /** Whole days left in the trial (null when not trialing). */
  trialDaysRemaining: number | null;
  /** Active / trialing / past-due grace → paid entitlements apply. */
  inGoodStanding: boolean;
  /** Pro-only: outbound new-Primary email → phone call alerts. */
  allowsEmailCalls: boolean;
  /** Pro-only: premium (richer) call-in voice. */
  allowsPremiumVoice: boolean;
  /** Payment is failing but access is retained during Stripe retries. */
  pastDue: boolean;
  /** Trial ended, past due, canceled, or incomplete → prompt to (re)subscribe. */
  needsUpgradePrompt: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function statusOrDefault(
  status: SubscriptionStatusValue | null | undefined,
): SubscriptionStatusValue {
  return status ?? "TRIALING";
}

/** Statuses that grant the tenant their paid plan (incl. trial + grace). */
export function isGoodStandingStatus(
  status: SubscriptionStatusValue,
  trialExpired: boolean,
): boolean {
  switch (status) {
    case "ACTIVE":
      return true;
    case "PAST_DUE":
      // Grace period: Stripe is still retrying the charge. Never abruptly cut a
      // blind patron off mid-flow; surface a warning instead.
      return true;
    case "TRIALING":
      return !trialExpired;
    case "CANCELED":
    case "INCOMPLETE":
      return false;
    default: {
      const never: never = status;
      return never;
    }
  }
}

export function trialDaysRemaining(
  trialEndsAt: Date | null | undefined,
  now: Date,
): number | null {
  if (!trialEndsAt) return null;
  const ms = trialEndsAt.getTime() - now.getTime();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return 0;
  return Math.ceil(ms / DAY_MS);
}

/**
 * Derive entitlements from a subscription snapshot. This is the ONE place that
 * decides whether Pro features are on, so gating everywhere reads real state.
 */
export function resolveEntitlements(
  input: SubscriptionStateInput,
): PlanEntitlements {
  const now = input.now ?? new Date();
  const planId = resolvePlanId(input.planKey ?? getDefaultPlan().id);
  const planName = getPlan(planId)?.name ?? getDefaultPlan().name;
  const status = statusOrDefault(input.status);

  const trialing = status === "TRIALING";
  const trialExpired =
    trialing &&
    !!input.trialEndsAt &&
    input.trialEndsAt.getTime() <= now.getTime();
  const inGoodStanding = isGoodStandingStatus(status, trialExpired);
  const effectivePlanId = inGoodStanding ? planId : getDefaultPlan().id;

  const allowsEmailCalls =
    inGoodStanding && planAllowsEmailCalls(effectivePlanId);
  const allowsPremiumVoice =
    inGoodStanding && planAllowsPremiumVoice(effectivePlanId);

  const pastDue = status === "PAST_DUE";
  const needsUpgradePrompt =
    trialExpired ||
    status === "PAST_DUE" ||
    status === "CANCELED" ||
    status === "INCOMPLETE";

  return {
    planId,
    planName,
    effectivePlanId,
    status,
    trialing: trialing && !trialExpired,
    trialExpired,
    trialDaysRemaining: trialing
      ? trialDaysRemaining(input.trialEndsAt, now)
      : null,
    inGoodStanding,
    allowsEmailCalls,
    allowsPremiumVoice,
    pastDue,
    needsUpgradePrompt,
  };
}

/**
 * Short, plain-language billing status line (screen-reader / spoken friendly).
 * No dev jargon — safe to read aloud to a blind patron.
 */
export function billingStatusSummary(ent: PlanEntitlements): string {
  if (ent.trialExpired) {
    return `Your free trial has ended. Subscribe to ${ent.planName} to keep your call-in assistant.`;
  }
  if (ent.trialing) {
    const days = ent.trialDaysRemaining;
    const dayLabel =
      days == null
        ? "a few days"
        : days === 0
          ? "less than a day"
          : days === 1
            ? "1 day"
            : `${days} days`;
    return `You are on a free trial of ${ent.planName}, with ${dayLabel} left. You can subscribe any time to continue without interruption.`;
  }
  switch (ent.status) {
    case "ACTIVE":
      return `You are subscribed to ${ent.planName}.`;
    case "PAST_DUE":
      return `Your last payment did not go through. Please update your card to keep ${ent.planName}. Your assistant still works for now.`;
    case "CANCELED":
      return `Your subscription is canceled. Choose a plan to turn your assistant back on.`;
    case "INCOMPLETE":
      return `Your subscription is not finished yet. Choose a plan to continue.`;
    case "TRIALING":
      return `You are on a free trial of ${ent.planName}.`;
    default: {
      const never: never = ent.status;
      return never;
    }
  }
}
