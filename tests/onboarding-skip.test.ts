import { describe, expect, it } from "vitest";
import {
  onboardingIsComplete,
  phoneAlreadySavedAnnouncement,
  selectOnboardingSteps,
  shouldSkipCallInPhone,
  shouldSkipConnectGmail,
} from "@/lib/onboarding/skip-steps";

describe("patron onboarding skip logic", () => {
  it("keeps all 3 steps when nothing is done", () => {
    expect(
      selectOnboardingSteps({
        welcomeDone: false,
        gmailConnected: false,
        phoneSaved: false,
      }),
    ).toEqual(["welcomeConsent", "connectGmail", "callInPhone"]);
  });

  it("skips Connect Gmail when already connected", () => {
    expect(shouldSkipConnectGmail(true)).toBe(true);
    expect(
      selectOnboardingSteps({
        welcomeDone: false,
        gmailConnected: true,
        phoneSaved: false,
      }),
    ).toEqual(["welcomeConsent", "callInPhone"]);
  });

  it("skips phone when CallInIdentity already exists (admin onboard)", () => {
    expect(shouldSkipCallInPhone(true)).toBe(true);
    expect(
      selectOnboardingSteps({
        welcomeDone: false,
        gmailConnected: false,
        phoneSaved: true,
      }),
    ).toEqual(["welcomeConsent", "connectGmail"]);
    expect(phoneAlreadySavedAnnouncement("+14055106989")).toMatch(
      /already saved as \+14055106989/i,
    );
  });

  it("finishes when welcome, gmail, and phone are all done", () => {
    expect(
      onboardingIsComplete({
        welcomeDone: true,
        gmailConnected: true,
        phoneSaved: true,
      }),
    ).toBe(true);
    expect(
      selectOnboardingSteps({
        welcomeDone: true,
        gmailConnected: true,
        phoneSaved: true,
      }),
    ).toEqual([]);
  });

  it("after admin phone + gmail connect, only welcome remains if not agreed", () => {
    expect(
      selectOnboardingSteps({
        welcomeDone: false,
        gmailConnected: true,
        phoneSaved: true,
      }),
    ).toEqual(["welcomeConsent"]);
  });
});
