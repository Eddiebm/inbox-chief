/**
 * Monthly call-in minute usage per organization (soft cap + overage metering).
 * Pure helpers are client-safe; DB loaders live in call-usage-server.ts.
 */

import {
  CALL_OVERAGE_USD_PER_MINUTE,
  CALL_USAGE_WARN_RATIO,
  formatOverageRate,
  getDefaultPlan,
  getPlan,
  type Plan,
} from "@/lib/plans";

export type CallUsageWarningLevel = "none" | "approaching" | "at_limit";

export type CallMinuteUsage = {
  planId: string;
  planName: string;
  periodStart: string;
  periodEnd: string;
  /** Sum of CallSession.durationSeconds / 60 for the period (org-scoped). */
  minutesUsed: number;
  minutesIncluded: number;
  minutesRemaining: number;
  overageMinutes: number;
  overageRateUsdPerMinute: number;
  estimatedOverageUsd: number;
  /** VAPI costUsd sum for the same period (margin tracking). */
  costUsdPeriod: number;
  percentUsed: number;
  warningLevel: CallUsageWarningLevel;
  /** Soft cap: calls continue; overage is metered — never cut off blindly. */
  softCap: true;
  /** e.g. "45 of 90 minutes used. Overage $0.60/min after." */
  plainSummary: string;
  /** Screen-reader / TTS friendly. */
  spokenSummary: string;
  /** Short spoken warning when approaching or at limit; empty when none. */
  spokenWarning: string;
};

export type CallSessionUsageRow = {
  durationSeconds: number | null;
  costUsd: number | null;
  startedAt: Date;
};

function roundMinutes(n: number): number {
  return Math.round(n * 10) / 10;
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function formatMinutesPlain(n: number): string {
  const rounded = roundMinutes(n);
  if (rounded === 1) return "1 minute";
  if (Number.isInteger(rounded)) return `${rounded} minutes`;
  return `${rounded} minutes`;
}

/** Calendar-month period when subscription period is unknown. */
export function calendarMonthPeriod(now = new Date()): {
  periodStart: Date;
  periodEnd: Date;
} {
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { periodStart, periodEnd };
}

/**
 * Billing period from Stripe-style currentPeriodEnd (exclusive end),
 * falling back to calendar month.
 */
export function resolveBillingPeriod(input: {
  currentPeriodEnd?: Date | null;
  now?: Date;
}): { periodStart: Date; periodEnd: Date } {
  const now = input.now ?? new Date();
  const end = input.currentPeriodEnd;
  if (end && end.getTime() > now.getTime()) {
    const periodEnd = end;
    const periodStart = new Date(end);
    periodStart.setMonth(periodStart.getMonth() - 1);
    if (periodStart.getTime() > now.getTime()) {
      return calendarMonthPeriod(now);
    }
    return { periodStart, periodEnd };
  }
  return calendarMonthPeriod(now);
}

export function warningLevelForUsage(
  minutesUsed: number,
  minutesIncluded: number,
  warnRatio = CALL_USAGE_WARN_RATIO,
): CallUsageWarningLevel {
  if (minutesIncluded <= 0) return "none";
  if (minutesUsed >= minutesIncluded) return "at_limit";
  if (minutesUsed >= minutesIncluded * warnRatio) return "approaching";
  return "none";
}

export function buildSpokenUsageWarning(
  level: CallUsageWarningLevel,
  overageRateUsdPerMinute: number,
): string {
  const rate = formatOverageRate(overageRateUsdPerMinute);
  if (level === "at_limit") {
    return `You've used your included minutes. Further calls are ${rate}. I won't hang up mid-email.`;
  }
  if (level === "approaching") {
    return `You've used most of your included call minutes this period. After your included minutes, further calls are ${rate}. I won't hang up mid-email.`;
  }
  return "";
}

export function buildPlainUsageSummary(input: {
  minutesUsed: number;
  minutesIncluded: number;
  overageRateUsdPerMinute: number;
}): string {
  const used = roundMinutes(input.minutesUsed);
  const included = input.minutesIncluded;
  const usedLabel = Number.isInteger(used) ? String(used) : used.toFixed(1);
  const rateLabel =
    input.overageRateUsdPerMinute >= 1
      ? `$${input.overageRateUsdPerMinute.toFixed(2)}/min`
      : `$${input.overageRateUsdPerMinute.toFixed(2)}/min`;
  return `${usedLabel} of ${included} minutes used. Overage ${rateLabel} after.`;
}

export function buildSpokenUsageSummary(input: {
  minutesUsed: number;
  minutesIncluded: number;
  overageMinutes: number;
  overageRateUsdPerMinute: number;
  warningLevel: CallUsageWarningLevel;
}): string {
  const used = formatMinutesPlain(input.minutesUsed);
  const included = formatMinutesPlain(input.minutesIncluded);
  const rate = formatOverageRate(input.overageRateUsdPerMinute);
  let base = `You have used ${used} of ${included} included this billing period.`;
  if (input.overageMinutes > 0) {
    base += ` That is ${formatMinutesPlain(input.overageMinutes)} of overage at ${rate}.`;
  } else {
    base += ` Overage is ${rate} after your included minutes.`;
  }
  const warn = buildSpokenUsageWarning(
    input.warningLevel,
    input.overageRateUsdPerMinute,
  );
  return warn ? `${base} ${warn}` : base;
}

/** Aggregate session rows into minute + cost usage for a plan. */
export function aggregateCallMinuteUsage(input: {
  plan: Plan;
  rows: CallSessionUsageRow[];
  periodStart: Date;
  periodEnd: Date;
}): CallMinuteUsage {
  const included =
    input.plan.callLimits.includedCallMinutes ??
    getDefaultPlan().callLimits.includedCallMinutes ??
    90;
  const overageRate =
    input.plan.callLimits.overagePerMinuteUsd ?? CALL_OVERAGE_USD_PER_MINUTE;

  let seconds = 0;
  let costUsdPeriod = 0;
  const startMs = input.periodStart.getTime();
  const endMs = input.periodEnd.getTime();

  for (const row of input.rows) {
    const t = row.startedAt.getTime();
    if (t < startMs || t >= endMs) continue;
    if (row.durationSeconds != null && Number.isFinite(row.durationSeconds)) {
      seconds += Math.max(0, row.durationSeconds);
    }
    if (row.costUsd != null && Number.isFinite(row.costUsd)) {
      costUsdPeriod += Math.max(0, row.costUsd);
    }
  }

  const minutesUsed = roundMinutes(seconds / 60);
  const overageMinutes = roundMinutes(Math.max(0, minutesUsed - included));
  const minutesRemaining = roundMinutes(Math.max(0, included - minutesUsed));
  const percentUsed =
    included > 0 ? Math.round((minutesUsed / included) * 1000) / 10 : 0;
  const warningLevel = warningLevelForUsage(minutesUsed, included);
  const estimatedOverageUsd = roundUsd(overageMinutes * overageRate);

  const plainSummary = buildPlainUsageSummary({
    minutesUsed,
    minutesIncluded: included,
    overageRateUsdPerMinute: overageRate,
  });
  const spokenSummary = buildSpokenUsageSummary({
    minutesUsed,
    minutesIncluded: included,
    overageMinutes,
    overageRateUsdPerMinute: overageRate,
    warningLevel,
  });
  const spokenWarning = buildSpokenUsageWarning(warningLevel, overageRate);

  return {
    planId: input.plan.id,
    planName: input.plan.name,
    periodStart: input.periodStart.toISOString(),
    periodEnd: input.periodEnd.toISOString(),
    minutesUsed,
    minutesIncluded: included,
    minutesRemaining,
    overageMinutes,
    overageRateUsdPerMinute: overageRate,
    estimatedOverageUsd,
    costUsdPeriod: roundUsd(costUsdPeriod),
    percentUsed,
    warningLevel,
    softCap: true,
    plainSummary,
    spokenSummary,
    spokenWarning,
  };
}

export function planForUsageKey(planKey: string | null | undefined): Plan {
  if (planKey) {
    const plan = getPlan(planKey);
    if (plan && plan.callLimits.includedCallMinutes != null) return plan;
  }
  return getDefaultPlan();
}

/** Empty / mock usage for demo users. */
export function emptyCallMinuteUsage(
  plan: Plan = getDefaultPlan(),
  now = new Date(),
): CallMinuteUsage {
  const { periodStart, periodEnd } = calendarMonthPeriod(now);
  return aggregateCallMinuteUsage({
    plan,
    rows: [],
    periodStart,
    periodEnd,
  });
}
