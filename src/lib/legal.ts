/**
 * Facts the legal pages depend on that only the business owner can supply.
 * Every value that still reads "[[...]]" must be replaced before a production deploy;
 * scripts/check-legal.mjs blocks production builds while any remain.
 */
export const legal = {
  entityName: "[[LEGAL_ENTITY_NAME]]",
  entityDescription: "[[ENTITY_DESCRIPTION, for example a Delaware limited liability company]]",
  mailingAddress: "[[MAILING_ADDRESS]]",
  privacyEmail: "[[PRIVACY_EMAIL]]",
  legalEmail: "[[LEGAL_NOTICES_EMAIL]]",
  accessibilityEmail: "[[ACCESSIBILITY_FEEDBACK_EMAIL]]",
  governingState: "[[GOVERNING_STATE]]",
  venue: "[[VENUE_COUNTY_AND_STATE]]",
  effectiveDate: "[[EFFECTIVE_DATE]]",
  dataRegion: "[[DATA_HOSTING_REGION, for example the United States]]",
  aiModelProvider: "[[AI_MODEL_PROVIDER_FOR_DRAFTING_AND_SUMMARIES]]",
  retention: {
    accountAfterDeletion: "[[DAYS_ACCOUNT_DATA_KEPT_AFTER_DELETION]]",
    mailAfterDisconnect: "[[DAYS_SYNCED_MAIL_KEPT_AFTER_MAILBOX_DISCONNECT]]",
    callTranscripts: "[[DAYS_CALL_TRANSCRIPTS_KEPT]]",
    callAudio: "[[DAYS_CALL_AUDIO_KEPT_OR_STATE_NOT_RECORDED]]",
    auditLogs: "[[DAYS_AUDIT_LOGS_KEPT]]",
  },
} as const;

/** Bump when the Terms or Privacy Policy change in a way users must re-accept. */
export const TERMS_VERSION = "2026-10";

export type Subprocessor = {
  name: string;
  purpose: string;
  data: string;
};

/** Single source for the Privacy Policy and DPA Annex III. Keep in sync with real vendors. */
export const subprocessors: readonly Subprocessor[] = [
  {
    name: "Vercel",
    purpose: "Application hosting and delivery",
    data: "Account, mailbox, assistant and call data processed by the application; technical request logs",
  },
  {
    name: "Neon",
    purpose: "PostgreSQL database hosting",
    data: "All stored account, mailbox, draft, audit and call records",
  },
  {
    name: "Google",
    purpose: "Gmail and Google Calendar APIs when you connect them",
    data: "Mailbox and calendar data you authorise",
  },
  {
    name: "Microsoft and other mailbox operators",
    purpose: "Outlook (Microsoft Graph) and IMAP mailboxes when you connect them",
    data: "Mailbox data you authorise",
  },
  {
    name: "Twilio",
    purpose: "Telephone call connectivity and text messages (setup links, checkout links)",
    data: "Phone numbers, call metadata, message content of setup and checkout texts",
  },
  {
    name: "VAPI",
    purpose: "Voice call orchestration",
    data: "Call audio, transcripts and the mailbox text needed to answer your request",
  },
  {
    name: "OpenAI, Deepgram, Cartesia and ElevenLabs",
    purpose: "Language model, speech-to-text and text-to-speech used by VAPI for a call, depending on voice settings",
    data: "Call audio, transcripts and mailbox text needed for the request",
  },
  {
    name: "AI model provider for drafting and summaries",
    purpose: "Preparing draft replies and summaries at your direction",
    data: "Message subject and text needed to draft or summarise",
  },
  {
    name: "Stripe",
    purpose: "Payments and subscription billing",
    data: "Name, email, billing details, plan and payment status. Card numbers go to Stripe, not to us",
  },
  {
    name: "Resend",
    purpose: "Transactional email such as password resets and call alerts",
    data: "Your email address and the content of the notice",
  },
  {
    name: "OCR.space or Google Cloud Vision (only when optional OCR is used)",
    purpose: "Extracting text from a supported attachment",
    data: "The attachment you ask us to read",
  },
];
