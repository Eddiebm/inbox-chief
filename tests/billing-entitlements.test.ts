import { describe, expect, it } from "vitest";
import {
  billingStatusSummary,
  planAllowsEmailCalls,
  resolveEntitlements,
} from "@/lib/billing/entitlements";

const NOW = new Date("2026-08-15T12:00:00Z");
const IN_10_DAYS = new Date("2026-08-25T12:00:00Z");
const YESTERDAY = new Date("2026-08-14T12:00:00Z");

describe("plan feature predicates", () => {
  it("gates outbound email calls to Pro and Business only", () => {
    expect(planAllowsEmailCalls("patron")).toBe(false);
    expect(planAllowsEmailCalls("pro")).toBe(true);
    expect(planAllowsEmailCalls("business")).toBe(true);
    // Legacy aliases resolve correctly.
    expect(planAllowsEmailCalls("professional")).toBe(true);
    expect(planAllowsEmailCalls("solo")).toBe(false);
  });
});

describe("resolveEntitlements — keys off real subscription state", () => {
  it("active Pro grants email calls and premium voice", () => {
    const ent = resolveEntitlements({
      planKey: "pro",
      status: "ACTIVE",
      now: NOW,
    });
    expect(ent.inGoodStanding).toBe(true);
    expect(ent.allowsEmailCalls).toBe(true);
    expect(ent.allowsPremiumVoice).toBe(true);
    expect(ent.needsUpgradePrompt).toBe(false);
    expect(ent.effectivePlanId).toBe("pro");
  });

  it("trialing (not expired) grants the plan and reports days left", () => {
    const ent = resolveEntitlements({
      planKey: "pro",
      status: "TRIALING",
      trialEndsAt: IN_10_DAYS,
      now: NOW,
    });
    expect(ent.trialing).toBe(true);
    expect(ent.trialExpired).toBe(false);
    expect(ent.trialDaysRemaining).toBe(10);
    expect(ent.inGoodStanding).toBe(true);
    expect(ent.allowsEmailCalls).toBe(true);
    expect(ent.needsUpgradePrompt).toBe(false);
  });

  it("expired trial downgrades to free and prompts upgrade", () => {
    const ent = resolveEntitlements({
      planKey: "pro",
      status: "TRIALING",
      trialEndsAt: YESTERDAY,
      now: NOW,
    });
    expect(ent.trialExpired).toBe(true);
    expect(ent.inGoodStanding).toBe(false);
    expect(ent.allowsEmailCalls).toBe(false);
    expect(ent.allowsPremiumVoice).toBe(false);
    expect(ent.effectivePlanId).toBe("patron");
    expect(ent.trialDaysRemaining).toBe(0);
    expect(ent.needsUpgradePrompt).toBe(true);
  });

  it("past_due keeps access during grace but flags a prompt", () => {
    const ent = resolveEntitlements({
      planKey: "pro",
      status: "PAST_DUE",
      now: NOW,
    });
    expect(ent.inGoodStanding).toBe(true);
    expect(ent.allowsEmailCalls).toBe(true);
    expect(ent.pastDue).toBe(true);
    expect(ent.needsUpgradePrompt).toBe(true);
  });

  it("canceled downgrades to free (no Pro features)", () => {
    const ent = resolveEntitlements({
      planKey: "pro",
      status: "CANCELED",
      now: NOW,
    });
    expect(ent.inGoodStanding).toBe(false);
    expect(ent.allowsEmailCalls).toBe(false);
    expect(ent.allowsPremiumVoice).toBe(false);
    expect(ent.effectivePlanId).toBe("patron");
    expect(ent.needsUpgradePrompt).toBe(true);
  });

  it("incomplete signups do not grant Pro features", () => {
    const ent = resolveEntitlements({
      planKey: "pro",
      status: "INCOMPLETE",
      now: NOW,
    });
    expect(ent.inGoodStanding).toBe(false);
    expect(ent.allowsEmailCalls).toBe(false);
    expect(ent.needsUpgradePrompt).toBe(true);
  });

  it("active Patron never unlocks Pro-only features", () => {
    const ent = resolveEntitlements({
      planKey: "patron",
      status: "ACTIVE",
      now: NOW,
    });
    expect(ent.inGoodStanding).toBe(true);
    expect(ent.allowsEmailCalls).toBe(false);
    expect(ent.allowsPremiumVoice).toBe(false);
  });
});

describe("billingStatusSummary — plain, spoken-friendly copy", () => {
  it("describes an active plan without jargon", () => {
    const ent = resolveEntitlements({ planKey: "pro", status: "ACTIVE", now: NOW });
    expect(billingStatusSummary(ent)).toBe("You are subscribed to Pro.");
  });

  it("counts down the trial", () => {
    const ent = resolveEntitlements({
      planKey: "patron",
      status: "TRIALING",
      trialEndsAt: IN_10_DAYS,
      now: NOW,
    });
    expect(billingStatusSummary(ent)).toContain("free trial of Patron");
    expect(billingStatusSummary(ent)).toContain("10 days left");
  });

  it("explains an ended trial", () => {
    const ent = resolveEntitlements({
      planKey: "patron",
      status: "TRIALING",
      trialEndsAt: YESTERDAY,
      now: NOW,
    });
    expect(billingStatusSummary(ent)).toContain("free trial has ended");
  });

  it("explains a failed payment gently", () => {
    const ent = resolveEntitlements({ planKey: "pro", status: "PAST_DUE", now: NOW });
    const copy = billingStatusSummary(ent);
    expect(copy).toContain("update your card");
    expect(copy).toContain("still works");
  });
});
