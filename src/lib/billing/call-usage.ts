/**
 * Monthly call-in minute usage per organization.
 *
 * Model: included plan minutes per billing period + prepaid purchased-minute
 * balance (rollover). No silent soft overage. Hard stop only when included
 * remaining AND purchased balance are both exhausted.
 *
 * Pure helpers are client-safe; DB loaders live in call-usage-server.ts.
 */

import {
  CALL_USAGE_WARN_RATIO,
  getDefaultPlan,
  getPlan,
  type Plan,
} from "@/lib/plans";

export type CallUsageWarningLevel =
  | "none"
  | "approaching"
  | "included_exhausted"
  | "at_limit";

/** Context needed to build plain / spoken cap + warning messages. */
export type CallUsageMessageContext = {
  minutesIncluded: number;
  planName: string;
  /** Plain date the included minutes reset, e.g. "September 1". */
  resetDateLabel: string;
  purchasedMinutesRemaining: number;
};

export type CallMinuteUsage = {
  planId: string;
  planName: string;
  periodStart: string;
  periodEnd: string;
  /** Sum of CallSession.durationSeconds / 60 for the period (org-scoped). */
  minutesUsed: number;
  minutesIncluded: number;
  /** Remaining included minutes this period (does not include purchased). */
  minutesRemaining: number;
  /** Prepaid purchased minutes still available (rollover wallet). */
  purchasedMinutesRemaining: number;
  /** Total minutes still available: included remaining + purchased. */
  totalMinutesRemaining: number;
  /**
   * Minutes used beyond included this period — informational; paid for by
   * drawing the purchased wallet (not silent $0.60 overage).
   */
  overageMinutes: number;
  /** Always 0 — there is no metered overage rate. */
  overageRateUsdPerMinute: number;
  /** Always 0 — no silent metered overage. */
  estimatedOverageUsd: number;
  /** VAPI costUsd sum for the same period (margin tracking). */
  costUsdPeriod: number;
  percentUsed: number;
  warningLevel: CallUsageWarningLevel;
  /** Hard stop when total remaining is zero. */
  hardCap: true;
  /** True when included remaining + purchased balance <= 0 → deny usage. */
  hardCapReached: boolean;
  /** Included allotment used up, but purchased balance may still remain. */
  includedExhausted: boolean;
  /** e.g. "45 of 90 minutes used. 30 purchased minutes left." */
  plainSummary: string;
  /** Screen-reader / TTS friendly. */
  spokenSummary: string;
  /** Short spoken warning when approaching or at limit; empty when none. */
  spokenWarning: string;
  /** Verbatim spoken hard-stop when fully out of minutes. */
  spokenCapReached: string;
};

export type CallSessionUsageRow = {
  durationSeconds: number | null;
  costUsd: number | null;
  startedAt: Date;
};

function roundMinutes(n: number): number {
  return Math.round(n * 10) / 10;
}

function roundMinuteBalance(n: number): number {
  return Math.round(n * 10_000) / 10_000;
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

export function warningLevelForUsage(input: {
  minutesUsed: number;
  minutesIncluded: number;
  purchasedMinutesRemaining: number;
  warnRatio?: number;
}): CallUsageWarningLevel {
  const warnRatio = input.warnRatio ?? CALL_USAGE_WARN_RATIO;
  const included = input.minutesIncluded;
  const used = input.minutesUsed;
  const purchased = Math.max(0, input.purchasedMinutesRemaining);
  if (included <= 0 && purchased <= 0) return "at_limit";

  const includedRemaining = Math.max(0, included - used);
  const totalRemaining = includedRemaining + purchased;
  if (totalRemaining <= 0) return "at_limit";
  if (includedRemaining <= 0 && purchased > 0) return "included_exhausted";
  if (included > 0 && used >= included * warnRatio) return "approaching";
  return "none";
}

/**
 * How many purchased minutes a call should draw after included is applied.
 * Pure — used by end-of-call reconciliation and tests.
 */
export function purchasedMinutesToDraw(input: {
  callDurationMinutes: number;
  periodMinutesUsedBeforeCall: number;
  minutesIncluded: number;
  purchasedBalance: number;
}): { draw: number; remainingBalance: number } {
  const duration = Math.max(0, input.callDurationMinutes);
  const includedLeft = Math.max(
    0,
    input.minutesIncluded - Math.max(0, input.periodMinutesUsedBeforeCall),
  );
  const fromPurchased = Math.max(0, duration - includedLeft);
  const draw = roundMinuteBalance(
    Math.min(fromPurchased, Math.max(0, input.purchasedBalance)),
  );
  return {
    draw,
    remainingBalance: roundMinuteBalance(
      Math.max(0, input.purchasedBalance) - draw,
    ),
  };
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Plain reset date ("September 1") from the exclusive period end. */
export function formatResetDateLabel(periodEnd: Date): string {
  return `${MONTH_NAMES[periodEnd.getMonth()]} ${periodEnd.getDate()}`;
}

/**
 * Verbatim spoken hard-stop when included + purchased are both exhausted.
 * Calm and clear for blind patrons: buy more, upgrade, or wait.
 */
export function buildSpokenCapReached(ctx: CallUsageMessageContext): string {
  return `You have no call minutes left. Your ${ctx.minutesIncluded} included minutes for this ${ctx.planName} period are used up, and you have no purchased minutes remaining. To keep using call-in, buy more minutes or upgrade your plan in the Inbox Chief dashboard, or wait until your included minutes reset on ${ctx.resetDateLabel}. I cannot read more mail or start a new request until then.`;
}

/**
 * Spoken refusal when the minute balance itself cannot be read (database
 * error, unapplied migration). Billable work fails closed rather than serving
 * unmetered calls that Inbox Chief pays VAPI for.
 */
export const USAGE_UNAVAILABLE_SPOKEN =
  "I can't check your call minutes right now, so I can't read mail or start a new request on this call. This is a problem on our side, not yours. Please try again in a few minutes, or contact Inbox Chief support. You can still check your connection status or finish setting up.";

/** Soft warnings append after a tool result — never replace the opening or block reading. */
export function isSoftCallUsageWarning(
  level: CallUsageWarningLevel,
): boolean {
  return level === "approaching" || level === "included_exhausted";
}

export function buildSpokenUsageWarning(
  level: CallUsageWarningLevel,
  ctx: CallUsageMessageContext,
): string {
  switch (level) {
    case "at_limit":
      return buildSpokenCapReached(ctx);
    case "included_exhausted": {
      const left = formatMinutesPlain(ctx.purchasedMinutesRemaining);
      return `Heads up: included call minutes are used up. About ${left} of purchased call minutes remain.`;
    }
    case "approaching":
      return "Heads up: you're nearing your included call minutes for this period.";
    case "none":
      return "";
    default: {
      const never: never = level;
      return never;
    }
  }
}

export function buildPlainUsageSummary(input: {
  minutesUsed: number;
  minutesIncluded: number;
  purchasedMinutesRemaining: number;
  hardCapReached: boolean;
  includedExhausted: boolean;
}): string {
  const used = roundMinutes(input.minutesUsed);
  const included = input.minutesIncluded;
  const usedLabel = Number.isInteger(used) ? String(used) : used.toFixed(1);
  const purchased = roundMinutes(input.purchasedMinutesRemaining);
  const purchasedLabel = Number.isInteger(purchased)
    ? String(purchased)
    : purchased.toFixed(1);
  const base = `${usedLabel} of ${included} included minutes used.`;
  if (input.hardCapReached) {
    return `${base} No purchased minutes left — buy more minutes, upgrade, or wait for the next period.`;
  }
  if (input.includedExhausted) {
    return `${base} Using purchased minutes — ${purchasedLabel} left.`;
  }
  if (purchased > 0) {
    return `${base} ${purchasedLabel} purchased minutes available.`;
  }
  return base;
}

export function buildSpokenUsageSummary(input: {
  minutesUsed: number;
  minutesIncluded: number;
  warningLevel: CallUsageWarningLevel;
  context: CallUsageMessageContext;
}): string {
  const used = formatMinutesPlain(input.minutesUsed);
  const included = formatMinutesPlain(input.minutesIncluded);
  const purchased = formatMinutesPlain(
    input.context.purchasedMinutesRemaining,
  );
  let base = `You have used ${used} of ${included} included this billing period.`;
  if (input.context.purchasedMinutesRemaining > 0) {
    base += ` You also have ${purchased} of purchased minutes remaining.`;
  }
  const warn = buildSpokenUsageWarning(input.warningLevel, input.context);
  return warn ? `${base} ${warn}` : base;
}

/** Aggregate session rows into minute + cost usage for a plan + wallet. */
export function aggregateCallMinuteUsage(input: {
  plan: Plan;
  rows: CallSessionUsageRow[];
  periodStart: Date;
  periodEnd: Date;
  /** Prepaid purchased minutes remaining (rollover wallet). */
  purchasedMinutesRemaining?: number;
}): CallMinuteUsage {
  const included =
    input.plan.callLimits.includedCallMinutes ??
    getDefaultPlan().callLimits.includedCallMinutes ??
    90;
  const purchasedMinutesRemaining = roundMinutes(
    Math.max(0, input.purchasedMinutesRemaining ?? 0),
  );

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
  const totalMinutesRemaining = roundMinutes(
    minutesRemaining + purchasedMinutesRemaining,
  );
  const percentUsed =
    included > 0 ? Math.round((minutesUsed / included) * 1000) / 10 : 0;
  const includedExhausted = included > 0 && minutesUsed >= included;
  const hardCapReached = totalMinutesRemaining <= 0;
  const warningLevel = warningLevelForUsage({
    minutesUsed,
    minutesIncluded: included,
    purchasedMinutesRemaining,
  });

  const context: CallUsageMessageContext = {
    minutesIncluded: included,
    planName: input.plan.name,
    resetDateLabel: formatResetDateLabel(input.periodEnd),
    purchasedMinutesRemaining,
  };
  const plainSummary = buildPlainUsageSummary({
    minutesUsed,
    minutesIncluded: included,
    purchasedMinutesRemaining,
    hardCapReached,
    includedExhausted,
  });
  const spokenSummary = buildSpokenUsageSummary({
    minutesUsed,
    minutesIncluded: included,
    warningLevel,
    context,
  });
  const spokenWarning = buildSpokenUsageWarning(warningLevel, context);
  const spokenCapReached = buildSpokenCapReached(context);

  return {
    planId: input.plan.id,
    planName: input.plan.name,
    periodStart: input.periodStart.toISOString(),
    periodEnd: input.periodEnd.toISOString(),
    minutesUsed,
    minutesIncluded: included,
    minutesRemaining,
    purchasedMinutesRemaining,
    totalMinutesRemaining,
    overageMinutes,
    overageRateUsdPerMinute: 0,
    estimatedOverageUsd: 0,
    costUsdPeriod: roundUsd(costUsdPeriod),
    percentUsed,
    warningLevel,
    hardCap: true,
    hardCapReached,
    includedExhausted,
    plainSummary,
    spokenSummary,
    spokenWarning,
    spokenCapReached,
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
    purchasedMinutesRemaining: 0,
  });
}
