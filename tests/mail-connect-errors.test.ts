import { describe, expect, it } from "vitest";
import { humanizeMailboxConnectReason } from "@/lib/mail/connect-errors";
import {
  callInReadinessFromEnv,
  humanizeVapiError,
} from "@/lib/call-in/vapi-errors";
import { ONBOARDING_QUESTIONS } from "@/components/onboarding/questions";

describe("humanizeMailboxConnectReason (patron-safe)", () => {
  it("maps gmail_not_configured without env var names", () => {
    const msg = humanizeMailboxConnectReason("gmail_not_configured");
    expect(msg).toMatch(/isn’t ready to connect Gmail/i);
    expect(msg).not.toMatch(/GOOGLE_CLIENT/);
    expect(msg).not.toMatch(/MOCK_INTEGRATIONS/);
  });

  it("explains access_denied without Cloud Console jargon", () => {
    const msg = humanizeMailboxConnectReason("access_denied");
    expect(msg).toMatch(/isn’t enabled for Inbox Chief|Contact support/i);
    expect(msg).toMatch(/Connect Gmail again|try Connect/i);
    expect(msg).not.toMatch(/verification process/i);
    expect(msg).not.toMatch(/Google Cloud/i);
    expect(msg).not.toMatch(/Audience/i);
    expect(msg).not.toMatch(/\btester\b/i);
  });

  it("tells mock_session users to sign out and use a real account", () => {
    expect(humanizeMailboxConnectReason("mock_session")).toMatch(/demo session/i);
    expect(humanizeMailboxConnectReason("mock_session")).toMatch(/Sign out/i);
  });

  it("maps google_credentials_missing to contact support", () => {
    expect(humanizeMailboxConnectReason("google_credentials_missing")).toMatch(
      /contact support/i,
    );
  });
});

describe("humanizeVapiError", () => {
  it("maps assistant-link jargon to phone-setup speech", () => {
    expect(
      humanizeVapiError("Get assistant / set assistant ID on phone number"),
    ).toMatch(/Phone assistant is being set up/i);
    expect(
      humanizeVapiError("Get assistant / set assistant ID on phone number"),
    ).not.toMatch(/assistant ID/i);
  });

  it("callInReadinessFromEnv shows banner when number set but assistant missing", () => {
    const r = callInReadinessFromEnv({
      callInNumber: "+14055550100",
      assistantId: null,
    });
    expect(r.showSetupBanner).toBe(true);
    expect(r.patronMessage).toMatch(/Ask by voice/i);
  });

  it("hides banner when assistant is linked", () => {
    const r = callInReadinessFromEnv({
      callInNumber: "+14055550100",
      assistantId: "asst_123",
    });
    expect(r.showSetupBanner).toBe(false);
    expect(r.patronMessage).toBeNull();
  });
});

describe("patron onboarding steps", () => {
  it("exposes at most 3 steps and no operator jargon", () => {
    expect(ONBOARDING_QUESTIONS.length).toBeLessThanOrEqual(3);
    expect(ONBOARDING_QUESTIONS.map((q) => q.id)).toEqual([
      "welcomeConsent",
      "connectGmail",
      "callInPhone",
    ]);
    const blob = JSON.stringify(ONBOARDING_QUESTIONS);
    expect(blob).not.toMatch(/Google Cloud/i);
    expect(blob).not.toMatch(/VAPI/i);
    expect(blob).not.toMatch(/GOOGLE_CLIENT/i);
    expect(blob).not.toMatch(/\+15551234567/);
  });

  it("call-in phone placeholder is empty-guidance only, not a fake number", () => {
    const phone = ONBOARDING_QUESTIONS.find((q) => q.id === "callInPhone");
    expect(phone?.placeholder).toBeTruthy();
    expect(phone?.placeholder).not.toMatch(/^\+1555/);
    expect(phone?.placeholder).toMatch(/country code/i);
  });
});
