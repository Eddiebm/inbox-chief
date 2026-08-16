/**
 * Product subscription plans — single source of truth for marketing, billing UI,
 * and call-minute soft caps.
 *
 * Stripe remains stubbed until `STRIPE_PRICE_<PLAN_ID>` env vars are set
 * (e.g. STRIPE_PRICE_PATRON, STRIPE_PRICE_PRO). Checkout/portal APIs return
 * `stripe_not_configured` or stub sessions until then; plan keys/prices here
 * must still match what we intend to charge.
 *
 * Model: included call-in **minutes** per billing period (not unlimited).
 * Overage is metered at a clear per-minute rate — calls are not cut off mid-email;
 * patrons are warned at 80% and at the included limit.
 */

export type PlanPrice =
  | { kind: "monthly"; amountUsd: number; label: string }
  | { kind: "custom"; label: string };

/** Soft-cap call limits — overage allowed and metered; never “unlimited”. */
export type PlanCallLimits = {
  /** Included phone call-in minutes per billing period. null = contact sales. */
  includedCallMinutes: number | null;
  /** USD charged per minute after included minutes (spoken + shown). */
  overagePerMinuteUsd: number | null;
};

export type PlanResourceLimits = {
  maxMailboxes: number | null;
  maxAssistants: number | null;
  maxUsers: number | null;
};

export type Plan = {
  id: string;
  name: string;
  description: string;
  price: PlanPrice;
  highlighted?: boolean;
  /** Default plan for new signups when no ?plan= is chosen. */
  isDefault?: boolean;
  ctaLabel: string;
  ctaHref: string;
  features: string[];
  callLimits: PlanCallLimits;
  resourceLimits: PlanResourceLimits;
};

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFloat(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Shared overage rate for capped plans ($0.60/min). */
export const CALL_OVERAGE_USD_PER_MINUTE = envFloat(
  "NEXT_PUBLIC_CALL_OVERAGE_USD_PER_MINUTE",
  0.6,
);

/** Warn when included minutes reach this fraction (80%). */
export const CALL_USAGE_WARN_RATIO = 0.8;

const patronPrice = envInt("NEXT_PUBLIC_PLAN_PATRON_PRICE_USD", 29);
const proPrice = envInt("NEXT_PUBLIC_PLAN_PRO_PRICE_USD", 79);
const patronMinutes = envInt("NEXT_PUBLIC_PLAN_PATRON_MINUTES", 90);
const proMinutes = envInt("NEXT_PUBLIC_PLAN_PRO_MINUTES", 300);

export const DEFAULT_PLAN_ID = "patron";

export const plans: Plan[] = [
  {
    id: "patron",
    name: "Patron",
    description:
      "One mailbox, clear call-in minutes, and human approval before any send.",
    price: {
      kind: "monthly",
      amountUsd: patronPrice,
      label: `$${patronPrice}/mo`,
    },
    highlighted: true,
    isDefault: true,
    ctaLabel: "Start Patron",
    ctaHref: "/signup?plan=patron",
    callLimits: {
      includedCallMinutes: patronMinutes,
      overagePerMinuteUsd: CALL_OVERAGE_USD_PER_MINUTE,
    },
    resourceLimits: {
      maxMailboxes: 1,
      maxAssistants: 1,
      maxUsers: 1,
    },
    features: [
      `Includes ${patronMinutes} minutes of phone call-in per month`,
      `Overage ${formatOverageRate(CALL_OVERAGE_USD_PER_MINUTE)} after included minutes (calls continue; you are warned)`,
      "Standard call-in voice (clear, lower cost)",
      "1 connected mailbox",
      "Read aloud: From, Subject, body, and attachments (text / PDF / DOCX / PPTX)",
      "Never auto-send — human approval before any send",
      "Accessible large-type interface",
      "7-day activity audit trail",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    description: "More minutes and mailboxes for people juggling several inboxes.",
    price: {
      kind: "monthly",
      amountUsd: proPrice,
      label: `$${proPrice}/mo`,
    },
    ctaLabel: "Start Pro",
    ctaHref: "/signup?plan=pro",
    callLimits: {
      includedCallMinutes: proMinutes,
      overagePerMinuteUsd: CALL_OVERAGE_USD_PER_MINUTE,
    },
    resourceLimits: {
      maxMailboxes: 3,
      maxAssistants: 2,
      maxUsers: 5,
    },
    features: [
      `Includes ${proMinutes} minutes of phone call-in per month`,
      `Overage ${formatOverageRate(CALL_OVERAGE_USD_PER_MINUTE)} after included minutes (same rate as Patron)`,
      "Premium call-in voice included (richer sound; uses more of plan dollar value)",
      "Outbound phone alerts for new Primary email",
      "3 connected mailboxes",
      "Read aloud with attachments (text / PDF / DOCX / PPTX)",
      "Never auto-send — human approval before any send",
      "Full searchable audit log",
      "Priority accessibility support",
    ],
  },
  {
    id: "business",
    name: "Business",
    description: "Teams that need policy, scale, and a DPA — minutes still capped, never unlimited.",
    price: {
      kind: "custom",
      label: "Custom",
    },
    ctaLabel: "Talk to us",
    ctaHref: "/signup?plan=business",
    callLimits: {
      includedCallMinutes: null,
      overagePerMinuteUsd: CALL_OVERAGE_USD_PER_MINUTE,
    },
    resourceLimits: {
      maxMailboxes: null,
      maxAssistants: null,
      maxUsers: null,
    },
    features: [
      "Custom mailbox & assistant limits",
      "Custom included call-in minutes (still metered — no unlimited calling)",
      `Overage ${formatOverageRate(CALL_OVERAGE_USD_PER_MINUTE)} unless contracted otherwise`,
      "Org-wide approval policies",
      "Outbound phone alerts for new Primary email",
      "Signed DPA and security review",
      "Admin controls & role permissions",
      "SLA and dedicated success contact",
    ],
  },
];

/** Legacy marketing/checkout ids → current plan ids. */
const PLAN_ALIASES: Record<string, string> = {
  solo: "patron",
  professional: "pro",
  executive: "pro",
};

export function resolvePlanId(id: string): string {
  return PLAN_ALIASES[id] ?? id;
}

export function getPlan(id: string): Plan | undefined {
  const resolved = resolvePlanId(id);
  return plans.find((plan) => plan.id === resolved);
}

export function getDefaultPlan(): Plan {
  return plans.find((p) => p.isDefault) ?? plans[0]!;
}

export function formatPlanPrice(plan: Plan): string {
  return plan.price.label;
}

export function formatOverageRate(usdPerMinute: number): string {
  if (!Number.isFinite(usdPerMinute) || usdPerMinute <= 0) return "$0.00/min";
  const cents = Math.round(usdPerMinute * 100);
  if (cents > 0 && cents < 100 && Math.abs(usdPerMinute * 100 - cents) < 0.05) {
    return cents === 1 ? "1 cent per minute" : `${cents} cents per minute`;
  }
  return `$${usdPerMinute.toFixed(2)}/min`;
}

/**
 * Stripe price env key for a plan (`STRIPE_PRICE_PATRON`, etc.).
 * Documented so operators know which secrets to set when leaving stub mode.
 */
export function stripePriceEnvKey(planId: string): string {
  return `STRIPE_PRICE_${resolvePlanId(planId).toUpperCase()}`;
}
