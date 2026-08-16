import { describe, expect, it } from "vitest";
import {
  aggregateCallMinuteUsage,
  buildPlainUsageSummary,
  buildSpokenCapReached,
  buildSpokenUsageWarning,
  purchasedMinutesToDraw,
  warningLevelForUsage,
  type CallUsageMessageContext,
} from "@/lib/billing/call-usage";
import {
  getDefaultPlan,
  getMinutePack,
  getPlan,
  MINUTE_PACKS,
  minutePackEffectiveRate,
  plans,
  resolvePlanId,
} from "@/lib/plans";
import {
  normalizeMinutePackPurchase,
  normalizeStripeEvent,
} from "@/lib/billing/stripe-webhook";

const CTX: CallUsageMessageContext = {
  minutesIncluded: 90,
  planName: "Patron",
  resetDateLabel: "September 1",
  purchasedMinutesRemaining: 0,
};

describe("capped plans (Patron / Pro)", () => {
  it("exposes Patron as default at $29 with 90 minutes", () => {
    const patron = getDefaultPlan();
    expect(patron.id).toBe("patron");
    expect(patron.price.kind).toBe("monthly");
    if (patron.price.kind === "monthly") {
      expect(patron.price.amountUsd).toBe(29);
    }
    expect(patron.callLimits.includedCallMinutes).toBe(90);
    expect(patron.callLimits.overagePerMinuteUsd).toBeNull();
    expect(patron.resourceLimits.maxMailboxes).toBe(1);
  });

  it("exposes Pro at $79 with 300 minutes", () => {
    const pro = getPlan("pro");
    expect(pro).toBeDefined();
    expect(pro!.callLimits.includedCallMinutes).toBe(300);
  });

  it("does not offer unlimited calling or silent overage on any plan", () => {
    for (const plan of plans) {
      if (plan.id !== "business") {
        expect(plan.callLimits.includedCallMinutes).toBeTypeOf("number");
        expect(plan.callLimits.includedCallMinutes!).toBeGreaterThan(0);
      }
      expect(plan.callLimits.overagePerMinuteUsd).toBeNull();
      expect(plan.features.some((f) => /^unlimited/i.test(f))).toBe(false);
    }
  });

  it("maps legacy plan ids to patron/pro", () => {
    expect(resolvePlanId("solo")).toBe("patron");
    expect(getPlan("solo")?.id).toBe("patron");
  });
});

describe("prepaid minute packs", () => {
  it("defines 30 / 60 / 120 packs priced for margin above COGS", () => {
    expect(MINUTE_PACKS.map((p) => p.id)).toEqual([
      "pack_30",
      "pack_60",
      "pack_120",
    ]);
    expect(getMinutePack("pack_30")).toMatchObject({
      minutes: 30,
      priceUsd: 18,
      stripePriceEnvKey: "STRIPE_PRICE_MINUTES_30",
    });
    expect(minutePackEffectiveRate(getMinutePack("pack_30")!)).toBe(0.6);
    expect(minutePackEffectiveRate(getMinutePack("pack_60")!)).toBe(0.5);
    expect(minutePackEffectiveRate(getMinutePack("pack_120")!)).toBe(0.4);
  });

  it("credits packs from paid checkout.session.completed metadata", () => {
    const credit = normalizeMinutePackPurchase("checkout.session.completed", {
      id: "cs_test_pack",
      mode: "payment",
      payment_status: "paid",
      metadata: {
        purchaseKind: "minute_pack",
        minutePackKey: "pack_60",
        organizationId: "org_1",
      },
    });
    expect(credit).toMatchObject({
      kind: "credit",
      organizationId: "org_1",
      packId: "pack_60",
      minutes: 60,
      amountUsdCents: 3000,
      stripeCheckoutSessionId: "cs_test_pack",
    });
  });

  it("ignores unpaid or subscription checkouts for minute packs", () => {
    expect(
      normalizeMinutePackPurchase("checkout.session.completed", {
        id: "cs_sub",
        mode: "subscription",
        payment_status: "paid",
        metadata: { purchaseKind: "subscription", organizationId: "org_1" },
      }).kind,
    ).toBe("ignore");

    expect(
      normalizeStripeEvent("checkout.session.completed", {
        id: "cs_pack",
        mode: "payment",
        metadata: {
          purchaseKind: "minute_pack",
          minutePackKey: "pack_30",
          organizationId: "org_1",
        },
      }).kind,
    ).toBe("ignore");
  });
});

describe("call minute usage with purchased balance", () => {
  const periodStart = new Date(2026, 7, 1);
  const periodEnd = new Date(2026, 8, 1);

  it("warns at 80% of included while still under total cap", () => {
    expect(
      warningLevelForUsage({
        minutesUsed: 72,
        minutesIncluded: 90,
        purchasedMinutesRemaining: 0,
      }),
    ).toBe("approaching");
    expect(
      buildSpokenUsageWarning("approaching", CTX),
    ).toContain("buy more minutes");
  });

  it("hard-stops when included and purchased are both exhausted", () => {
    const usage = aggregateCallMinuteUsage({
      plan: getDefaultPlan(),
      periodStart,
      periodEnd,
      purchasedMinutesRemaining: 0,
      rows: [
        {
          durationSeconds: 100 * 60,
          costUsd: 3,
          startedAt: new Date(2026, 7, 12, 10, 0, 0),
        },
      ],
    });
    expect(usage.hardCapReached).toBe(true);
    expect(usage.includedExhausted).toBe(true);
    expect(usage.totalMinutesRemaining).toBe(0);
    expect(usage.estimatedOverageUsd).toBe(0);
    expect(usage.spokenCapReached).toContain("buy more minutes");
    expect(usage.spokenCapReached).toContain("no purchased minutes remaining");
    expect(usage.plainSummary).toContain("No purchased minutes left");
  });

  it("continues when included is exhausted but purchased balance remains", () => {
    const usage = aggregateCallMinuteUsage({
      plan: getDefaultPlan(),
      periodStart,
      periodEnd,
      purchasedMinutesRemaining: 30,
      rows: [
        {
          durationSeconds: 95 * 60,
          costUsd: 2,
          startedAt: new Date(2026, 7, 12, 10, 0, 0),
        },
      ],
    });
    expect(usage.includedExhausted).toBe(true);
    expect(usage.hardCapReached).toBe(false);
    expect(usage.warningLevel).toBe("included_exhausted");
    expect(usage.totalMinutesRemaining).toBe(30);
    expect(usage.spokenWarning).toContain("purchased minutes");
    expect(usage.plainSummary).toContain("30 left");
  });

  it("draws purchased minutes only after included is used", () => {
    expect(
      purchasedMinutesToDraw({
        callDurationMinutes: 20,
        periodMinutesUsedBeforeCall: 80,
        minutesIncluded: 90,
        purchasedBalance: 50,
      }),
    ).toEqual({ draw: 10, remainingBalance: 40 });

    expect(
      purchasedMinutesToDraw({
        callDurationMinutes: 5,
        periodMinutesUsedBeforeCall: 50,
        minutesIncluded: 90,
        purchasedBalance: 50,
      }),
    ).toEqual({ draw: 0, remainingBalance: 50 });
  });

  it("stops drawing when purchased balance hits zero", () => {
    expect(
      purchasedMinutesToDraw({
        callDurationMinutes: 20,
        periodMinutesUsedBeforeCall: 90,
        minutesIncluded: 90,
        purchasedBalance: 5,
      }),
    ).toEqual({ draw: 5, remainingBalance: 0 });
  });

  it("builds plain summary under the cap without overage billing language", () => {
    expect(
      buildPlainUsageSummary({
        minutesUsed: 45,
        minutesIncluded: 90,
        purchasedMinutesRemaining: 0,
        hardCapReached: false,
        includedExhausted: false,
      }),
    ).toBe("45 of 90 included minutes used.");
  });

  it("speaks a calm fully-out message with buy / upgrade / wait choices", () => {
    const spoken = buildSpokenCapReached(CTX);
    expect(spoken).toContain("buy more minutes");
    expect(spoken).toContain("upgrade your plan");
    expect(spoken).toContain("September 1");
    expect(spoken.toLowerCase()).not.toContain("overage");
    expect(spoken.toLowerCase()).not.toContain("per minute");
  });
});
