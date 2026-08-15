import { describe, expect, it } from "vitest";
import {
  aggregateCallMinuteUsage,
  buildPlainUsageSummary,
  buildSpokenUsageWarning,
  warningLevelForUsage,
} from "@/lib/billing/call-usage";
import {
  CALL_OVERAGE_USD_PER_MINUTE,
  getDefaultPlan,
  getPlan,
  plans,
  resolvePlanId,
} from "@/lib/plans";

describe("capped plans (Patron / Pro)", () => {
  it("exposes Patron as default at $29 with 90 minutes", () => {
    const patron = getDefaultPlan();
    expect(patron.id).toBe("patron");
    expect(patron.price.kind).toBe("monthly");
    if (patron.price.kind === "monthly") {
      expect(patron.price.amountUsd).toBe(29);
    }
    expect(patron.callLimits.includedCallMinutes).toBe(90);
    expect(patron.callLimits.overagePerMinuteUsd).toBe(
      CALL_OVERAGE_USD_PER_MINUTE,
    );
    expect(patron.resourceLimits.maxMailboxes).toBe(1);
  });

  it("exposes Pro at $79 with 300 minutes", () => {
    const pro = getPlan("pro");
    expect(pro).toBeDefined();
    expect(pro!.price.kind).toBe("monthly");
    if (pro!.price.kind === "monthly") {
      expect(pro!.price.amountUsd).toBe(79);
    }
    expect(pro!.callLimits.includedCallMinutes).toBe(300);
    expect(pro!.resourceLimits.maxMailboxes).toBe(3);
  });

  it("does not offer unlimited calling on any plan", () => {
    for (const plan of plans) {
      // Soft-cap model: every non-custom plan has a finite included minute allotment.
      if (plan.id !== "business") {
        expect(plan.callLimits.includedCallMinutes).toBeTypeOf("number");
        expect(plan.callLimits.includedCallMinutes!).toBeGreaterThan(0);
        expect(plan.callLimits.includedCallMinutes!).toBeLessThan(10_000);
      }
      expect(plan.callLimits.overagePerMinuteUsd).toBe(0.6);
      expect(plan.features.some((f) => /^unlimited/i.test(f))).toBe(false);
    }
  });

  it("maps legacy plan ids to patron/pro", () => {
    expect(resolvePlanId("solo")).toBe("patron");
    expect(resolvePlanId("professional")).toBe("pro");
    expect(resolvePlanId("executive")).toBe("pro");
    expect(getPlan("solo")?.id).toBe("patron");
  });
});

describe("call minute soft-cap usage", () => {
  const periodStart = new Date(2026, 7, 1);
  const periodEnd = new Date(2026, 8, 1);

  it("builds plain summary like '45 of 90 minutes used'", () => {
    expect(
      buildPlainUsageSummary({
        minutesUsed: 45,
        minutesIncluded: 90,
        overageRateUsdPerMinute: 0.6,
      }),
    ).toBe("45 of 90 minutes used. Overage $0.60/min after.");
  });

  it("warns at 80% and at the included limit", () => {
    expect(warningLevelForUsage(71, 90)).toBe("none");
    expect(warningLevelForUsage(72, 90)).toBe("approaching");
    expect(warningLevelForUsage(90, 90)).toBe("at_limit");
    expect(warningLevelForUsage(100, 90)).toBe("at_limit");
    expect(buildSpokenUsageWarning("at_limit", 0.6)).toContain(
      "You've used your included minutes",
    );
    expect(buildSpokenUsageWarning("at_limit", 0.6)).toContain(
      "60 cents per minute",
    );
  });

  it("aggregates org CallSession minutes and cost for the period", () => {
    const usage = aggregateCallMinuteUsage({
      plan: getDefaultPlan(),
      periodStart,
      periodEnd,
      rows: [
        {
          durationSeconds: 45 * 60,
          costUsd: 1.2,
          startedAt: new Date(2026, 7, 5, 10, 0, 0),
        },
        {
          durationSeconds: 30 * 60,
          costUsd: 0.8,
          startedAt: new Date(2026, 7, 10, 10, 0, 0),
        },
        // Outside period — ignored
        {
          durationSeconds: 60 * 60,
          costUsd: 9,
          startedAt: new Date(2026, 6, 1, 10, 0, 0),
        },
      ],
    });

    expect(usage.minutesUsed).toBe(75);
    expect(usage.minutesIncluded).toBe(90);
    expect(usage.minutesRemaining).toBe(15);
    expect(usage.overageMinutes).toBe(0);
    expect(usage.costUsdPeriod).toBe(2);
    expect(usage.warningLevel).toBe("approaching");
    expect(usage.softCap).toBe(true);
    expect(usage.plainSummary).toBe(
      "75 of 90 minutes used. Overage $0.60/min after.",
    );
  });

  it("meters overage after included minutes without blocking", () => {
    const usage = aggregateCallMinuteUsage({
      plan: getDefaultPlan(),
      periodStart,
      periodEnd,
      rows: [
        {
          durationSeconds: 100 * 60,
          costUsd: 3,
          startedAt: new Date(2026, 7, 12, 10, 0, 0),
        },
      ],
    });
    expect(usage.minutesUsed).toBe(100);
    expect(usage.overageMinutes).toBe(10);
    expect(usage.estimatedOverageUsd).toBe(6);
    expect(usage.warningLevel).toBe("at_limit");
    expect(usage.spokenWarning).toContain("Further calls are");
  });
});
