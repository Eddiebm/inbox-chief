import { afterEach, describe, expect, it } from "vitest";
import {
  GOOGLE_TESTING_CONSENT_GUIDANCE,
  googleConsentGuidance,
  googleConsentGuidanceSpoken,
  isGoogleOauthPublished,
} from "@/lib/google-oauth-publication";

describe("Google OAuth publication guidance", () => {
  const previous = process.env.GOOGLE_OAUTH_PUBLISHED;

  afterEach(() => {
    if (previous === undefined) delete process.env.GOOGLE_OAUTH_PUBLISHED;
    else process.env.GOOGLE_OAUTH_PUBLISHED = previous;
  });

  it("reads the server environment flag", () => {
    process.env.GOOGLE_OAUTH_PUBLISHED = " true ";
    expect(isGoogleOauthPublished()).toBe(true);
    process.env.GOOGLE_OAUTH_PUBLISHED = "false";
    expect(isGoogleOauthPublished()).toBe(false);
  });

  it("shows accessible testing guidance only before verification", () => {
    expect(googleConsentGuidance(false)).toBe(
      GOOGLE_TESTING_CONSENT_GUIDANCE,
    );
    expect(googleConsentGuidance(false)).toMatch(/Advanced/i);
    expect(googleConsentGuidance(false)).toMatch(/Continue to Inbox Chief/i);
    expect(googleConsentGuidanceSpoken(false)).toMatch(/screen reader/i);
    expect(googleConsentGuidance(true)).toBeNull();
    expect(googleConsentGuidanceSpoken(true)).toBeNull();
  });
});
