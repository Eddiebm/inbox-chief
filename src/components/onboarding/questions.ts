export type QuestionInputKind =
  | "consent"
  | "gmail"
  | "tel"
  | "text"
  | "textarea"
  | "select"
  | "choice"
  | "info";

export type QuestionOption = {
  value: string;
  label: string;
  spokenLabel?: string;
};

export type OnboardingQuestion = {
  id: string;
  /** Short heading shown on screen */
  title: string;
  /** Concise prompt spoken aloud */
  spokenPrompt: string;
  /** Optional extra help text (not always spoken) */
  help?: string;
  inputKind: QuestionInputKind;
  placeholder?: string;
  options?: QuestionOption[];
  /** If true, advancing without an answer is allowed */
  optional?: boolean;
  /** Primary CTA label */
  primaryLabel?: string;
};

/**
 * Patron onboarding — 3 steps max.
 * Operator jargon (Cloud Console, VAPI, env vars) never appears here.
 */
export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  {
    id: "welcomeConsent",
    title: "Welcome to Inbox Chief",
    spokenPrompt:
      "Welcome to Inbox Chief. We help you manage email by voice, and we never send mail without your approval. Press Continue to get started.",
    help: "We never send email without your approval.",
    inputKind: "consent",
    primaryLabel: "Continue",
  },
  {
    id: "connectGmail",
    title: "Connect your Gmail",
    spokenPrompt:
      "Connect your Gmail with one tap. You will approve access on Google’s secure screen. Nothing sends without your approval. You can skip and connect later.",
    help: "One Google consent screen. You can skip and connect later in Settings.",
    inputKind: "gmail",
    optional: true,
    primaryLabel: "Connect Gmail",
  },
  {
    id: "callInPhone",
    title: "Save your phone for call-in",
    spokenPrompt:
      "Save the phone number you will call from, including country code. We use it only to recognize you. You can skip and add it later.",
    help: "Include country code. Used only to recognize you on inbound calls.",
    inputKind: "tel",
    placeholder: "Your phone number with country code",
    optional: true,
    primaryLabel: "Save and finish",
  },
];

export type OnboardingAnswers = Record<string, string>;

export const STORAGE_KEY = "inbox-chief-onboarding";
export const CALL_IN_PHONE_STORAGE_KEY = "inbox-chief-call-in-phone";
