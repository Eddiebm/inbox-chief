import { describe, expect, it } from "vitest";
import {
  buildOutboundEmailOpening,
  countNewPrimaryForOutboundAlert,
  outboundAlertEligibility,
} from "@/lib/call-in/outbound-email-alert";
import { planAllowsEmailCalls } from "@/lib/call-in/email-call-plan";

const NOW = new Date("2026-08-15T12:00:00Z");

describe("outbound Primary email calls", () => {
  it("does not call when the toggle is off", () => {
    expect(
      outboundAlertEligibility({
        newPrimaryCount: 2,
        enabled: false,
        hasPhone: true,
        mailboxConnected: true,
        lastCalledAt: null,
        atMinuteCap: false,
        now: NOW,
      }),
    ).toEqual({ eligible: false, reason: "toggle_off" });
  });

  it("does not call when no new Primary mail exists", () => {
    expect(
      outboundAlertEligibility({
        newPrimaryCount: 0,
        enabled: true,
        hasPhone: true,
        mailboxConnected: true,
        lastCalledAt: null,
        atMinuteCap: false,
        now: NOW,
      }),
    ).toEqual({ eligible: false, reason: "no_new_primary" });
  });

  it("batches bursts with a fifteen-minute cooldown", () => {
    expect(
      outboundAlertEligibility({
        newPrimaryCount: 3,
        enabled: true,
        hasPhone: true,
        mailboxConnected: true,
        lastCalledAt: new Date("2026-08-15T11:50:00Z"),
        atMinuteCap: false,
        now: NOW,
      }),
    ).toEqual({ eligible: false, reason: "cooldown" });
  });

  it("counts Primary only and excludes promotions", () => {
    expect(
      countNewPrimaryForOutboundAlert([
        {
          fromAddress: "person@example.com",
          categoryName: "PRIMARY",
          metadata: { labelIds: ["INBOX", "CATEGORY_PERSONAL"] },
        },
        {
          fromAddress: "offers@shop.example",
          categoryName: "PROMOTIONS",
          metadata: { labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] },
        },
      ]),
    ).toBe(1);
  });

  it("gates the feature to Pro and Business", () => {
    expect(planAllowsEmailCalls("patron")).toBe(false);
    expect(planAllowsEmailCalls("pro")).toBe(true);
    expect(planAllowsEmailCalls("business")).toBe(true);
  });

  it("announces the newest Primary sender and subject", () => {
    expect(
      buildOutboundEmailOpening([
        {
          fromAddress: "Older Person <older@example.com>",
          subject: "Earlier note",
          categoryName: "PRIMARY",
          receivedAt: new Date("2026-08-15T10:00:00Z"),
        },
        {
          fromAddress: "Jordan Lee <jordan@example.com>",
          subject: "Schedule confirmation",
          categoryName: "PRIMARY",
          receivedAt: new Date("2026-08-15T11:00:00Z"),
        },
        {
          fromAddress: "offers@example.com",
          subject: "Half off",
          categoryName: "PROMOTIONS",
          receivedAt: new Date("2026-08-15T12:00:00Z"),
        },
      ]),
    ).toBe(
      "You have 2 new emails in Primary. The newest is from Jordan Lee about Schedule confirmation. Say read the new ones.",
    );
  });
});
