/**
 * Patron onboarding is 3 steps max: Welcome → Connect Gmail → Save phone.
 * Skip Connect when Gmail is already linked; skip phone when CallInIdentity exists
 * (including admin onboard that pre-saved the number).
 */

export const ONBOARDING_STEP_IDS = [
  "welcomeConsent",
  "connectGmail",
  "callInPhone",
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

export type OnboardingSkipState = {
  welcomeDone: boolean;
  gmailConnected: boolean;
  phoneSaved: boolean;
};

export function selectOnboardingSteps(
  state: OnboardingSkipState,
): OnboardingStepId[] {
  const steps: OnboardingStepId[] = [];
  if (!state.welcomeDone) steps.push("welcomeConsent");
  if (!state.gmailConnected) steps.push("connectGmail");
  if (!state.phoneSaved) steps.push("callInPhone");
  return steps;
}

export function shouldSkipConnectGmail(gmailConnected: boolean): boolean {
  return gmailConnected;
}

export function shouldSkipCallInPhone(phoneSaved: boolean): boolean {
  return phoneSaved;
}

export function onboardingIsComplete(state: OnboardingSkipState): boolean {
  return selectOnboardingSteps(state).length === 0;
}

export function phoneAlreadySavedAnnouncement(phoneE164?: string | null): string {
  if (phoneE164?.trim()) {
    return `Your call-in phone is already saved as ${phoneE164.trim()}. You can skip this step.`;
  }
  return "Your call-in phone is already saved. You can skip this step.";
}
