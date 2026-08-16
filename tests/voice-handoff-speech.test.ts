import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { speakUrlForVoice } from "@/lib/a11y/copy";

const mocks = vi.hoisted(() => ({
  provisionSignup: vi.fn(),
  sendProvisioningSms: vi.fn(),
  getProvisioningStatusForPhone: vi.fn(),
}));

vi.mock("@/lib/provisioning", () => ({
  provisionSignup: mocks.provisionSignup,
  getProvisioningStatusForPhone: mocks.getProvisioningStatusForPhone,
}));
vi.mock("@/lib/provisioning-sms", () => ({
  sendProvisioningSms: mocks.sendProvisioningSms,
}));

import { demoMailboxSnapshot } from "@/lib/call-in/assistant";
import { handleCallInTool } from "@/lib/call-in/vapi-tools";

const snapshot = demoMailboxSnapshot("Alex");

const provision = {
  requestId: "request_1",
  userId: "user_1",
  phoneE164: "+14055550123",
  gmail: "patron@gmail.com",
  shortCode: "ABCD2345",
  magicLink: "https://inboxchief.com/api/provision/connect?token=signed",
  provisionUrl: "https://inboxchief.com/provision/ABCD2345",
  provisionEntryUrl: "https://inboxchief.com/provision",
  status: "needs_google_consent" as const,
  created: true,
};

describe("speakUrlForVoice", () => {
  it("spells hosts and paths a caller can type without seeing them", () => {
    expect(speakUrlForVoice("https://inboxchief.com/provision")).toBe(
      "inboxchief dot com slash provision",
    );
    expect(
      speakUrlForVoice("https://inbox-chief-kappa.vercel.app/provision"),
    ).toBe("inbox dash chief dash kappa dot vercel dot app slash provision");
  });
});

describe("voice signup handoff speech", () => {
  const previousPublished = process.env.GOOGLE_OAUTH_PUBLISHED;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_OAUTH_PUBLISHED = "false";
    mocks.provisionSignup.mockResolvedValue(provision);
  });

  afterEach(() => {
    if (previousPublished === undefined) {
      delete process.env.GOOGLE_OAUTH_PUBLISHED;
    } else {
      process.env.GOOGLE_OAUTH_PUBLISHED = previousPublished;
    }
  });

  it("points the caller at the SMS magic link when a text is delivered", async () => {
    mocks.sendProvisioningSms.mockResolvedValue({
      sent: true,
      provider: "twilio",
    });

    const handled = await handleCallInTool({
      name: "provision_signup",
      args: { gmail: "patron@gmail.com" },
      callerPhone: "+14055550123",
      snapshot,
    });

    expect(handled.emailSent).toBe(false);
    expect(handled.spoken).toMatch(/sent the private connection link/i);
    expect(handled.spoken).toMatch(/expires in 24 hours/i);
    expect(handled.spoken).not.toMatch(/operator|cloud console/i);
  });

  it("falls back to the spoken short code using the configured domain", async () => {
    mocks.sendProvisioningSms.mockResolvedValue({
      sent: false,
      reason: "not_configured",
    });

    const handled = await handleCallInTool({
      name: "provision_signup",
      args: { gmail: "patron@gmail.com" },
      callerPhone: "+14055550123",
      snapshot,
    });

    expect(handled.spoken).toMatch(/inboxchief dot com slash provision/);
    expect(handled.spoken).toMatch(/A B C D 2 3 4 5/);
    expect(handled.spoken).not.toMatch(/vercel/i);
  });

  it("adds unverified-app guidance only while verification is pending", async () => {
    mocks.getProvisioningStatusForPhone.mockResolvedValue({
      status: "needs_google_consent",
    });

    const pending = await handleCallInTool({
      name: "check_provision_status",
      callerPhone: "+14055550123",
      snapshot,
    });
    expect(pending.spoken).toMatch(/choose Advanced, then Continue/i);
    expect(pending.spoken).toMatch(/screen reader/i);

    process.env.GOOGLE_OAUTH_PUBLISHED = "true";
    const verified = await handleCallInTool({
      name: "check_provision_status",
      callerPhone: "+14055550123",
      snapshot,
    });
    expect(verified.spoken).not.toMatch(/unverified|Advanced/i);
  });
});
