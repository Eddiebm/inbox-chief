/**
 * Single server-side source of truth for whether Google has approved the app
 * for unrestricted production use. Keep false while test-user enrollment is
 * still required, even if the consent screen says "In production".
 */
export function isGoogleOauthPublished(): boolean {
  return process.env.GOOGLE_OAUTH_PUBLISHED?.trim().toLowerCase() === "true";
}

export const GOOGLE_TESTING_CONSENT_GUIDANCE =
  "Google may show an “unverified app” notice. Choose Advanced, then Continue to Inbox Chief. If you cannot find those controls with your screen reader, ask a trusted helper to complete this one Google screen.";

export const GOOGLE_TESTING_CONSENT_GUIDANCE_SPOKEN =
  "Google may say this app is unverified. On that Google page, choose Advanced, then Continue to Inbox Chief. If those controls are hard to find with your screen reader, a trusted helper can complete this one Google screen.";

export function googleConsentGuidance(
  googleOauthPublished: boolean,
): string | null {
  return googleOauthPublished ? null : GOOGLE_TESTING_CONSENT_GUIDANCE;
}

export function googleConsentGuidanceSpoken(
  googleOauthPublished: boolean,
): string | null {
  return googleOauthPublished ? null : GOOGLE_TESTING_CONSENT_GUIDANCE_SPOKEN;
}
