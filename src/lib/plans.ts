/**
 * Product subscription plans — single source of truth for marketing, billing UI,
 * and call-minute accounting.
 *
 * Stripe remains stubbed until `STRIPE_PRICE_<PLAN_ID>` env vars are set
 * (e.g. STRIPE_PRICE_PATRON, STRIPE_PRICE_PRO). Checkout/portal APIs return
 * `stripe_not_configured` or stub sessions until then; plan keys/prices here
 * must still match what we intend to charge.
 *
 * Model: included call-in **minutes** per billing period (not unlimited), plus
 * optional **prepaid minute packs** (one-time Stripe purchases that roll over).
 * No silent soft overage. When included + purchased balance is exhausted,
 * call-in hard-stops until the patron buys more, upgrades, or the included
 * allotment resets next period.
 */

export type PlanPrice =
  | { kind: "monthly"; amountUsd: number; label: string }
  | { kind: "custom"; label: string };

/** Call limits — included minutes per period; prepaid packs cover extra use. */
export type PlanCallLimits = {
  /** Included phone call-in minutes per billing period. null = contact sales. */
  includedCallMinutes: number | null;
  /**
   * No silent soft overage. Always null.
   * Extra minutes come from prepaid packs (`MINUTE_PACKS`), not metered billing.
   */
  overagePerMinuteUsd: number | null;
};

/**
 * Prepaid minute pack (one-time Stripe purchase). Purchased minutes **roll over**
 * across billing periods until used — patron-friendly and simpler than expiry.
 *
 * Pricing targets ~$0.40–0.60/min effective vs ~$0.12–0.22/min VAPI COGS so
 * margin holds after pack purchase.
 */
export type MinutePack = {
  id: "pack_30" | "pack_60" | "pack_120";
  minutes: number;
  /** USD charged once for the pack. */
  priceUsd: number;
  label: string;
  description: string;
  /** Env var holding the Stripe one-time Price ID (`price_…`). */
  stripePriceEnvKey: string;
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

/** Warn when included minutes reach this fraction (80%). */
export const CALL_USAGE_WARN_RATIO = 0.8;

/**
 * Prepaid minute packs. Stripe Price IDs come from env — never hardcode live IDs.
 *
 * | Pack | Minutes | Price | Effective $/min | Margin vs $0.12–0.22 COGS |
 * | pack_30 | 30 | $18 | $0.60 | ~$0.38–0.48/min |
 * | pack_60 | 60 | $30 | $0.50 | ~$0.28–0.38/min |
 * | pack_120 | 120 | $48 | $0.40 | ~$0.18–0.28/min |
 */
export const MINUTE_PACKS: MinutePack[] = [
  {
    id: "pack_30",
    minutes: 30,
    priceUsd: 18,
    label: "30 minutes",
    description: "Small top-up — about 60 cents per minute.",
    stripePriceEnvKey: "STRIPE_PRICE_MINUTES_30",
  },
  {
    id: "pack_60",
    minutes: 60,
    priceUsd: 30,
    label: "60 minutes",
    description: "Most chosen top-up — about 50 cents per minute.",
    stripePriceEnvKey: "STRIPE_PRICE_MINUTES_60",
  },
  {
    id: "pack_120",
    minutes: 120,
    priceUsd: 48,
    label: "120 minutes",
    description: "Best value — about 40 cents per minute.",
    stripePriceEnvKey: "STRIPE_PRICE_MINUTES_120",
  },
];

export function getMinutePack(id: string): MinutePack | undefined {
  return MINUTE_PACKS.find((pack) => pack.id === id);
}

export function stripeMinutePackPriceId(packId: string): string | null {
  const pack = getMinutePack(packId);
  if (!pack) return null;
  return process.env[pack.stripePriceEnvKey]?.trim() || null;
}

/** Effective USD per minute for a pack (for UI copy). */
export function minutePackEffectiveRate(pack: MinutePack): number {
  if (pack.minutes <= 0) return 0;
  return Math.round((pack.priceUsd / pack.minutes) * 100) / 100;
}

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
      overagePerMinuteUsd: null,
    },
    resourceLimits: {
      maxMailboxes: 1,
      maxAssistants: 1,
      maxUsers: 1,
    },
    features: [
      `Includes ${patronMinutes} minutes of phone call-in per month`,
      "When included minutes run out, buy prepaid minute packs (they roll over) — no surprise overage",
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
      overagePerMinuteUsd: null,
    },
    resourceLimits: {
      maxMailboxes: 3,
      maxAssistants: 2,
      maxUsers: 5,
    },
    features: [
      `Includes ${proMinutes} minutes of phone call-in per month`,
      "When included minutes run out, buy prepaid minute packs (they roll over) — no surprise overage",
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
      overagePerMinuteUsd: null,
    },
    resourceLimits: {
      maxMailboxes: null,
      maxAssistants: null,
      maxUsers: null,
    },
    features: [
      "Custom mailbox & assistant limits",
      "Custom included call-in minutes (hard-capped — no unlimited calling)",
      "Prepaid minute packs available; contracted pools on request",
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
