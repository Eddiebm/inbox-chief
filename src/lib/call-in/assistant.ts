import { completeChat } from "@/lib/ai/llm-client";
import { resolveLlmConfig, type LlmConfig } from "@/lib/ai/llm-config";
import {
  chunkBodyForSpeech,
  estimateSpokenWords,
  prepareBodyForSpeech,
  speakBodyRemainder,
} from "@/lib/call-in/body-speech";
import { speakPhoneLastFour } from "@/lib/call-in/phone-display";
import { speakReceivedAt } from "@/lib/call-in/speak-received";
import {
  parseCallInInboxScope,
  speakPrimaryInboxIntro,
  type CallInInboxScope,
  type GmailInboxTab,
} from "@/lib/call-in/primary-inbox";
import {
  speechBudgetsForTier,
  type CallInVoiceTierId,
} from "@/lib/call-in/voice-tiers";
import type { CallInAttachmentSpeech } from "@/lib/gmail/attachments";
import { product } from "@/lib/product";
import {
  MAX_ATTACHMENT_TEXT_CHARS as MAX_ATTACHMENT_TEXT_CHARS_DEFAULT,
  sliceAttachmentTextForSpeech,
} from "@/lib/mail/attachment-text";

/** One inbox message shaped for phone TTS (accessibility-first). */
export type CallInReadableEmail = {
  messageId?: string;
  gmailMessageId?: string;
  fromAddress: string;
  subject: string;
  /** Prefer full body; fall back to Gmail/Outlook snippet */
  readableText: string;
  contentSource: "body" | "snippet" | "metadata_only";
  /** Attachment speech — populated on demand when reading; never invented */
  attachments?: CallInAttachmentSpeech[];
  /** Gmail tab — Primary by default for call-in */
  inboxTab?: GmailInboxTab;
  /** ISO received time from Gmail/DB — never invented */
  receivedAt?: string | null;
};

export type CallInIdentityStatus = "matched" | "unrecognized" | "demo" | "syncing";

export type CallInMailboxSnapshot = {
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  ownerFirstName: string;
  mailboxEmail: string;
  connectionStatus: "connected" | "disconnected" | "error" | "syncing";
  /** How caller identity was resolved — unrecognized must never invent demo emails */
  identityStatus: CallInIdentityStatus;
  needingAttention: number;
  draftsAwaitingReview: number;
  approvalsPending: number;
  followUpsDue: number;
  upcomingDeadlines: Array<{ title: string; dueIn: string }>;
  briefing: string;
  recentSubjects: string[];
  /** Primary-inbox messages to read aloud (default) */
  readableEmails: CallInReadableEmail[];
  /**
   * Non-primary tab messages (promotions/social/updates/forums) kept for opt-in
   * phrases like "read promotions" / "read everything". Spam excluded.
   */
  readableEmailsNonPrimary: CallInReadableEmail[];
  /** How many synced messages were skipped as non-Primary for the default path */
  skippedNonPrimaryCount: number;
  securityNote: string;
  /** Effective TTS tier for speech budgets (Standard tighter; Premium richer). */
  voiceTier?: CallInVoiceTierId;
  /** Matched caller E.164 — used once in the opening to confirm last four digits. */
  matchedPhoneE164?: string | null;
  /** IANA zone for Received speech; phone defaults to US Central. */
  speechTimeZone?: string | null;
  /** Primary-classified messages received after the previous completed call. */
  newPrimaryCount?: number;
  /** Previous completed-call boundary used to select the actual new messages. */
  lastSuccessfulCallAt?: string | null;
  /** True until this identity has a completed call timestamp. */
  isFirstSuccessfulCall?: boolean;
  /** Exact line the voice assistant must announce. */
  newPrimaryAnnouncement?: string;
};

/**
 * Spoken when inbound caller ID is not registered in CallInIdentity.
 * Hard rules (blind patrons rely on exact speech):
 * - Reference the phone only — never invent or speak a person’s name from CNAM,
 *   caller ID name, or LLM guess.
 * - Never mention demo/fixture emails.
 * - One clear action: save the calling number in Settings, then call again.
 */
export const UNRECOGNIZED_CALLER_SPOKEN =
  "I don't recognize this phone number. Say sign up or get started and I can create your account using this phone. If you already have an account, open Settings, find Anytime call-in phone, save the exact number you are calling from, then call again.";

/** Spoken when Primary has no messages after a real sync — never demo mail. */
export const EMPTY_PRIMARY_SPOKEN = "Your primary inbox is empty";

export function speakEmptyPrimaryInbox(skippedNonPrimaryCount = 0): string {
  if (skippedNonPrimaryCount > 0) {
    const n = skippedNonPrimaryCount;
    return `${EMPTY_PRIMARY_SPOKEN}. Skipping ${n} promotional and other-tab message${n === 1 ? "" : "s"}. Say read promotions or read everything if you want other tabs. Nothing sends from this call.`;
  }
  return `${EMPTY_PRIMARY_SPOKEN}. Nothing sends from this call.`;
}

export function unrecognizedCallerSnapshot(): CallInMailboxSnapshot {
  return {
    organizationId: "unrecognized",
    workspaceId: "unrecognized",
    mailboxId: "unrecognized",
    ownerFirstName: "there",
    mailboxEmail: "unknown",
    connectionStatus: "disconnected",
    identityStatus: "unrecognized",
    needingAttention: 0,
    draftsAwaitingReview: 0,
    approvalsPending: 0,
    followUpsDue: 0,
    upcomingDeadlines: [],
    briefing: UNRECOGNIZED_CALLER_SPOKEN,
    recentSubjects: [],
    readableEmails: [],
    readableEmailsNonPrimary: [],
    skippedNonPrimaryCount: 0,
    // Identical to briefing — short, phone-only, one action (no CNAM/name)
    securityNote: UNRECOGNIZED_CALLER_SPOKEN,
    matchedPhoneE164: null,
  };
}

/**
 * Signed-in web user with no mailbox yet — never invent demo emails.
 */
export function mailboxNotConnectedSnapshot(
  preferredName = "there",
): CallInMailboxSnapshot {
  const spoken =
    "Your Gmail is not connected yet. Open Settings, connect Gmail, then ask again. Nothing sends without your approval.";
  return {
    organizationId: "no_mailbox",
    workspaceId: "no_mailbox",
    mailboxId: "no_mailbox",
    ownerFirstName: preferredName,
    mailboxEmail: "not connected",
    connectionStatus: "disconnected",
    identityStatus: "matched",
    needingAttention: 0,
    draftsAwaitingReview: 0,
    approvalsPending: 0,
    followUpsDue: 0,
    upcomingDeadlines: [],
    briefing: spoken,
    recentSubjects: [],
    readableEmails: [],
    readableEmailsNonPrimary: [],
    skippedNonPrimaryCount: 0,
    securityNote: spoken,
    matchedPhoneE164: null,
  };
}

/**
 * Matched patron whose Gmail token no longer works (client switch / revoked).
 * Never read stale synced mail — send them back to Connect Gmail.
 */
export function mailboxNeedsReconnectSnapshot(
  preferredName = "there",
  mailboxEmail = "your mailbox",
): CallInMailboxSnapshot {
  const spoken =
    "Your mailbox needs reconnecting. Open Settings and tap Connect Gmail, then try again. Nothing sends without your approval.";
  return {
    organizationId: "needs_reconnect",
    workspaceId: "needs_reconnect",
    mailboxId: "needs_reconnect",
    ownerFirstName: preferredName,
    mailboxEmail,
    connectionStatus: "error",
    identityStatus: "matched",
    needingAttention: 0,
    draftsAwaitingReview: 0,
    approvalsPending: 0,
    followUpsDue: 0,
    upcomingDeadlines: [],
    briefing: spoken,
    recentSubjects: [],
    readableEmails: [],
    readableEmailsNonPrimary: [],
    skippedNonPrimaryCount: 0,
    securityNote: spoken,
    matchedPhoneE164: null,
  };
}

export type CallInIntent =
  | "greeting"
  | "briefing"
  | "attention"
  | "read_emails"
  | "attachment_more"
  | "drafts"
  | "approvals"
  | "follow_ups"
  | "deadlines"
  | "connection"
  | "help"
  | "unknown"
  | "goodbye";

export type CallInAnswer = {
  spoken: string;
  intent: CallInIntent;
  /** True when a local/OpenAI-compatible LLM rewrote an unknown-intent reply */
  llmAssisted?: boolean;
  llmProvider?: LlmConfig["provider"];
};

const DEFAULT_BATCH_SIZE = 1;
/** Defaults = Standard (tighter TTS). Premium overrides via speechBudgetsForTier. */
const MAX_EMAIL_TEXT_CHARS = speechBudgetsForTier("standard").maxEmailTextChars;
const MAX_SPOKEN_CHARS = speechBudgetsForTier("standard").maxSpokenChars;

function budgetsForSnapshot(snapshot?: Pick<CallInMailboxSnapshot, "voiceTier">) {
  return speechBudgetsForTier(snapshot?.voiceTier ?? "standard");
}

/** Demo snapshot used when DB/Gmail are not connected — never personal production data */
export function demoMailboxSnapshot(preferredName = "there"): CallInMailboxSnapshot {
  const readableEmails: CallInReadableEmail[] = [
    {
      fromAddress: "Jordan Lee <jordan@example.com>",
      subject: "Schedule confirmation for Thursday",
      readableText:
        "Hi — confirming our Thursday meeting at 2pm. Please reply if that still works.",
      contentSource: "body",
      inboxTab: "primary",
      receivedAt: "2026-08-12T15:41:00-05:00",
    },
    {
      fromAddress: "Sam Rivera <sam@example.com>",
      subject: "Question about the proposal",
      readableText:
        "Could you clarify the budget line on page 2? I want to send a revised quote.",
      contentSource: "snippet",
      inboxTab: "primary",
      receivedAt: "2026-08-11T10:15:00-05:00",
    },
    {
      fromAddress: "Family Travel <updates@family.example>",
      subject: "Family travel update",
      readableText: "",
      contentSource: "metadata_only",
      inboxTab: "primary",
      receivedAt: "2026-08-10T09:00:00-05:00",
    },
  ];

  const readableEmailsNonPrimary: CallInReadableEmail[] = [
    {
      fromAddress: "Deals <noreply@shop.example>",
      subject: "40% off flash sale — unsubscribe anytime",
      readableText: "Limited time offer. List-Unsubscribe. Manage preferences.",
      contentSource: "snippet",
      inboxTab: "promotions",
      receivedAt: "2026-08-09T08:00:00-05:00",
    },
  ];

  return {
    organizationId: "demo_org",
    workspaceId: "demo_ws",
    mailboxId: "demo_mb",
    ownerFirstName: preferredName,
    mailboxEmail: "you@example.com",
    connectionStatus: "disconnected",
    identityStatus: "demo",
    needingAttention: 3,
    draftsAwaitingReview: 2,
    approvalsPending: 1,
    followUpsDue: 2,
    upcomingDeadlines: [
      { title: "Reply about scheduling", dueIn: "today" },
      { title: "Invoice follow-up", dueIn: "2 days" },
    ],
    briefing:
      "Three primary messages need attention. I will read each one: from, subject, then the message.",
    recentSubjects: readableEmails.map((e) => e.subject),
    readableEmails,
    readableEmailsNonPrimary,
    skippedNonPrimaryCount: 1,
    securityNote: `${product.name} is connected in demo mode. Link Gmail in Settings when you are ready.`,
    matchedPhoneE164: null,
  };
}

/** True when the snapshot must not invent or read demo mail as if it were the caller's. */
export function isUnrecognizedCaller(
  snapshot: CallInMailboxSnapshot,
): boolean {
  return snapshot.identityStatus === "unrecognized";
}

export function unrecognizedCallerAnswer(): CallInAnswer {
  return {
    intent: "connection",
    spoken: unrecognizedCallerSnapshot().securityNote,
  };
}

/** Reserved room for the continuation offer / end-of-list line in a turn. */
const TURN_TAIL_RESERVE_CHARS = 260;

export type ReadableEmailChunkSpeech = {
  spoken: string;
  /** Absolute body offset to resume from; 0 when the body finished. */
  nextBodyOffset: number;
  /** Attachment still owing text, or null when none. */
  nextAttachmentIndex: number | null;
  nextAttachmentOffset: number;
};

/**
 * Build one spoken turn for an email: header, then as much of the body as fits.
 * A body longer than one turn is never cut silently — the turn ends on a
 * sentence boundary and says what remains and how to hear it. Attachments are
 * only announced once the body has been read all the way through.
 */
export function formatReadableEmailChunkForSpeech(
  email: CallInReadableEmail,
  index: number,
  total: number,
  options?: {
    bodyOffset?: number;
    attachmentIndex?: number;
    attachmentOffset?: number;
    maxEmailTextChars?: number;
    maxAttachmentTextChars?: number;
    /** Whole-turn budget, including header and continuation offer. */
    maxSpokenChars?: number;
    timeZone?: string | null;
  },
): ReadableEmailChunkSpeech {
  const from = speakableFrom(email.fromAddress);
  const subject = email.subject.trim() || "no subject";
  const bodyOffset = Math.max(0, options?.bodyOffset ?? 0);
  const turnBudget = options?.maxSpokenChars ?? MAX_SPOKEN_CHARS;
  const received = speakReceivedAt(email.receivedAt, options?.timeZone);
  const receivedPart = received ? ` ${received}.` : "";
  const header =
    bodyOffset > 0
      ? `Continuing email ${index} of ${total}. Subject: ${subject}.`
      : `Email ${index} of ${total}. From ${from}. Subject: ${subject}.${receivedPart}`;

  const prepared = prepareBodyForSpeech(email.readableText);
  const bodyBudget = Math.max(
    280,
    Math.min(
      options?.maxEmailTextChars ?? MAX_EMAIL_TEXT_CHARS,
      turnBudget - header.length - TURN_TAIL_RESERVE_CHARS,
    ),
  );
  const chunk = chunkBodyForSpeech(prepared, bodyOffset, bodyBudget);

  const parts: string[] = [header];
  if (chunk.spoken) {
    const label =
      bodyOffset > 0
        ? ""
        : email.contentSource === "body"
          ? "Message: "
          : "Preview: ";
    parts.push(`${label}${chunk.spoken}`);
  } else if (bodyOffset > 0) {
    parts.push("That was the end of this message.");
  } else {
    parts.push(
      "I only have the subject and sender for this one — the full message text is not synced yet.",
    );
  }

  if (chunk.hasMore) {
    parts.push(speakBodyRemainder(chunk));
    return {
      spoken: parts.join(" "),
      nextBodyOffset: chunk.nextOffset,
      nextAttachmentIndex: null,
      nextAttachmentOffset: 0,
    };
  }

  const attachmentChoice = formatAttachmentChoicesForSpeech(email.attachments);
  if (attachmentChoice) parts.push(attachmentChoice);

  return {
    spoken: parts.join(" "),
    nextBodyOffset: 0,
    nextAttachmentIndex: null,
    nextAttachmentOffset: 0,
  };
}

/**
 * Single-turn read of one email. Kept for callers that do not track offsets;
 * paginated reads use formatReadableEmailChunkForSpeech.
 */
export function formatReadableEmailForSpeech(
  email: CallInReadableEmail,
  index: number,
  total: number,
  options?: { maxEmailTextChars?: number; timeZone?: string | null },
): string {
  return formatReadableEmailChunkForSpeech(email, index, total, options).spoken;
}

export type AttachmentSpeech = {
  spoken: string;
  /** Attachment index that still owes text, or null when all were read. */
  nextAttachmentIndex: number | null;
  /** Offset inside that attachment's text; 0 means start of a new attachment. */
  nextAttachmentOffset: number;
};

/** Announce attachment metadata without downloading or extracting file bytes. */
export function formatAttachmentChoicesForSpeech(
  attachments: CallInAttachmentSpeech[] | undefined,
): string {
  if (!attachments?.length) return "";
  const count = attachments.length;
  const labels = attachments.map((attachment, index) => {
    const name = attachment.filename.trim() || `attachment ${index + 1}`;
    const type = attachment.speakableType || "file";
    return `${name}, ${type}`;
  });
  const list =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
  const choices =
    count === 1
      ? "Would you like me to read it in full, give an extractive summary, or skip it?"
      : "Would you like a specific attachment, all of them one at a time, an extractive summary, or to skip them?";
  return `This email has ${count} attachment${count === 1 ? "" : "s"}: ${list}. ${choices} Say next email at any time to move on.`;
}

/**
 * Read one explicitly selected attachment. Callers must first consent; normal
 * email speech only uses formatAttachmentChoicesForSpeech.
 */
export function speakSelectedAttachment(
  attachment: CallInAttachmentSpeech,
  options?: {
    offset?: number;
    maxAttachmentTextChars?: number;
    budgetChars?: number;
  },
): { spoken: string; nextOffset: number } {
  const name = attachment.filename.trim() || "unnamed file";
  const type = attachment.speakableType || "file";
  if (attachment.status !== "ok" && attachment.status !== "ocr_ok") {
    return {
      spoken:
        attachment.reason ??
        `I could not extract readable text from ${name}, ${type}. I will not guess at its contents. Say next email to move on.`,
      nextOffset: 0,
    };
  }

  const fullText = fullAttachmentText(attachment);
  if (!fullText) {
    return {
      spoken: `I could not find readable text in ${name}, ${type}. I will not guess at its contents. Say next email to move on.`,
      nextOffset: 0,
    };
  }

  const offset = Math.max(0, options?.offset ?? 0);
  const maxChars = Math.max(
    280,
    Math.min(
      options?.maxAttachmentTextChars ?? MAX_ATTACHMENT_TEXT_CHARS_DEFAULT,
      (options?.budgetChars ?? MAX_SPOKEN_CHARS) - 220,
    ),
  );
  const chunk = chunkBodyForSpeech(
    { text: fullText, mainLength: fullText.length, hasQuotedThread: false },
    offset,
    maxChars,
  );
  const lead =
    offset > 0
      ? `Continuing ${name}: `
      : `Reading ${name}, ${type}, in full: `;
  const tail = chunk.hasMore
    ? ` There is more of ${name} — about ${estimateSpokenWords(chunk.remainingChars)} words remain. Say continue to hear the rest, summarize instead for an extractive summary, or next email to stop and move on.`
    : ` That was the end of ${name}. Say next email to move on, or choose another attachment.`;
  return {
    spoken: `${lead}${chunk.spoken}.${tail}`,
    nextOffset: chunk.hasMore ? chunk.nextOffset : 0,
  };
}

/**
 * Deterministic, clearly labeled extractive summary. This deliberately avoids
 * an LLM: it previews opening sentences and states that it is not full content.
 */
export function summarizeAttachmentForSpeech(
  attachment: CallInAttachmentSpeech,
  maxChars = 600,
): string {
  const name = attachment.filename.trim() || "unnamed file";
  const type = attachment.speakableType || "file";
  if (attachment.status !== "ok" && attachment.status !== "ocr_ok") {
    return (
      attachment.reason ??
      `I could not extract readable text from ${name}, ${type}, so I cannot summarize it without guessing.`
    );
  }
  const fullText = fullAttachmentText(attachment);
  if (!fullText) {
    return `I could not find readable text in ${name}, ${type}, so I cannot summarize it without guessing.`;
  }
  const preview = chunkBodyForSpeech(
    { text: fullText, mainLength: fullText.length, hasQuotedThread: false },
    0,
    Math.max(120, maxChars),
  );
  const limitation = preview.hasMore
    ? "This extractive summary uses the opening portion of the document; it is not the full content."
    : "This extractive summary is based on all extracted text; it is not a verbatim full reading.";
  return `Summary of ${name}: ${preview.spoken}. ${limitation} Say read it in full for the exact text, or next email to move on.`;
}

/**
 * Speak attachment announcements plus as much extracted text as fits this turn.
 * Never invents file contents and never drops text silently — a remainder is
 * always announced with the exact phrase that resumes it.
 */
export function speakAttachmentsWithContinuation(
  attachments: CallInAttachmentSpeech[] | undefined,
  options?: {
    startIndex?: number;
    startOffset?: number;
    maxAttachmentTextChars?: number;
    budgetChars?: number;
  },
): AttachmentSpeech {
  const none: AttachmentSpeech = {
    spoken: "",
    nextAttachmentIndex: null,
    nextAttachmentOffset: 0,
  };
  if (!attachments || attachments.length === 0) return none;

  const startIndex = Math.max(0, options?.startIndex ?? 0);
  const startOffset = Math.max(0, options?.startOffset ?? 0);
  const maxChars =
    options?.maxAttachmentTextChars ?? MAX_ATTACHMENT_TEXT_CHARS_DEFAULT;
  let budget = Math.max(320, options?.budgetChars ?? MAX_SPOKEN_CHARS);
  if (startIndex >= attachments.length) return none;

  const count = attachments.length;
  const parts: string[] =
    startIndex === 0
      ? [`This email has ${count} attachment${count === 1 ? "" : "s"}.`]
      : [];
  budget -= parts[0]?.length ?? 0;

  for (let i = startIndex; i < count; i++) {
    const att = attachments[i]!;
    const n = i + 1;
    const name = att.filename.trim() || "unnamed file";
    const type = att.speakableType || "file";
    const label = `Attachment ${n}: ${name}, ${type}.`;

    if (budget < label.length + 200 && i > startIndex) {
      parts.push(
        `There ${count - i === 1 ? "is" : "are"} ${count - i} more attachment${count - i === 1 ? "" : "s"} on this email. Say continue to hear ${count - i === 1 ? "it" : "them"}, or say next to skip to the next email.`,
      );
      return {
        spoken: parts.join(" "),
        nextAttachmentIndex: i,
        nextAttachmentOffset: 0,
      };
    }

    parts.push(label);
    budget -= label.length;

    if (att.status !== "ok" && att.status !== "ocr_ok") {
      const reason =
        att.reason ?? `I can't read this yet. I can note the filename: ${name}.`;
      parts.push(reason);
      budget -= reason.length;
      continue;
    }

    const fullText = fullAttachmentText(att);
    if (!fullText) continue;

    const offset = i === startIndex ? startOffset : 0;
    const chunk = chunkBodyForSpeech(
      { text: fullText, mainLength: fullText.length, hasQuotedThread: false },
      offset,
      Math.max(280, Math.min(maxChars, budget - 160)),
    );
    if (!chunk.spoken) continue;

    const lead = offset > 0 ? `Continuing ${name}: ` : "Contents: ";
    parts.push(`${lead}${chunk.spoken}`);
    budget -= chunk.spoken.length + lead.length;

    if (chunk.hasMore) {
      parts.push(
        `There is more of ${name} — about ${estimateSpokenWords(chunk.remainingChars)} words remain. Say continue to hear the rest, or say next to skip to the next email.`,
      );
      return {
        spoken: parts.join(" "),
        nextAttachmentIndex: i,
        nextAttachmentOffset: chunk.nextOffset,
      };
    }
  }

  return {
    spoken: parts.join(" "),
    nextAttachmentIndex: null,
    nextAttachmentOffset: 0,
  };
}

/**
 * Speak attachment announcement + content. Never invents file contents.
 */
export function formatAttachmentsForSpeech(
  attachments: CallInAttachmentSpeech[] | undefined,
  options?: { maxAttachmentTextChars?: number; budgetChars?: number },
): string {
  return speakAttachmentsWithContinuation(attachments, options).spoken;
}

/** Extracted text for an attachment, reassembled from spoken + remaining. */
export function fullAttachmentText(att: CallInAttachmentSpeech): string {
  if (att.fullText?.trim()) return att.fullText.replace(/\s+/g, " ").trim();
  return `${att.readableText.trim()} ${att.remainingText.trim()}`
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Continue reading the current email's attachment text when the caller asks.
 * Uses the first email that still has remainingText; never invents content.
 */
export function speakMoreAboutAttachment(
  emails: CallInReadableEmail[],
  options?: {
    emailIndex?: number;
    attachmentIndex?: number;
    maxAttachmentTextChars?: number;
  },
): string {
  const emailIndex = Math.max(0, options?.emailIndex ?? 0);
  const email = emails[emailIndex];
  if (!email?.attachments?.length) {
    return "There is no attachment text left to continue. Say next for the next email, or ask me to read your emails again.";
  }

  const attachmentIndex = Math.max(0, options?.attachmentIndex ?? 0);
  // Prefer explicit index; else first attachment with remaining text
  let att =
    email.attachments[attachmentIndex] ??
    email.attachments.find((a) => a.remainingText.trim()) ??
    email.attachments[0];

  if (!att) {
    return "There is no attachment text left to continue.";
  }

  if (!att.remainingText.trim()) {
    // Try another attachment on this email with remaining text
    const withMore = email.attachments.find((a) => a.remainingText.trim());
    if (!withMore) {
      return `That is all I could read from the attachments on this email. The last file was ${att.filename}. Say next for the next email. Nothing sends from this call.`;
    }
    att = withMore;
  }

  const chunk = sliceAttachmentTextForSpeech(
    att.remainingText,
    0,
    options?.maxAttachmentTextChars,
  );
  // Mutate remaining for subsequent “say more” in the same snapshot lifetime
  att.readableText = chunk.spoken;
  att.remainingText = chunk.hasMore
    ? att.remainingText.slice(chunk.nextOffset).trim()
    : "";

  const moreHint = att.remainingText
    ? " Say more about this attachment to continue."
    : " That was the end of this attachment.";

  return truncateForSpeech(
    `Continuing ${att.filename}: ${chunk.spoken}.${moreHint} Nothing sends from this call.`,
    MAX_SPOKEN_CHARS,
  );
}

/**
 * Subjects-first overview — from + subject only, then offer full read.
 * Keeps TTS short for “what's in my inbox” style asks.
 */
export function speakEmailSubjectsList(
  emails: CallInReadableEmail[],
  options?: {
    skippedNonPrimaryCount?: number;
    scope?: CallInInboxScope;
    maxSubjects?: number;
    timeZone?: string | null;
  },
): string {
  const total = emails.length;
  if (total === 0) {
    return speakReadableEmails([], {
      skippedNonPrimaryCount: options?.skippedNonPrimaryCount,
      scope: options?.scope,
    });
  }

  const max = Math.max(1, Math.min(options?.maxSubjects ?? 8, total));
  const parts: string[] = [];
  parts.push(
    speakPrimaryInboxIntro({
      keptCount: total,
      skippedCount: options?.skippedNonPrimaryCount ?? 0,
      scope: options?.scope ?? "primary",
    }),
  );
  parts.push("Subjects first:");
  for (let i = 0; i < max; i++) {
    const email = emails[i]!;
    const from = speakableFrom(email.fromAddress);
    const subject = email.subject.trim() || "no subject";
    const received = speakReceivedAt(email.receivedAt, options?.timeZone);
    parts.push(
      `Email ${i + 1} of ${total}. From ${from}. Subject: ${subject}.${received ? ` ${received}.` : ""}`,
    );
  }
  if (max < total) {
    parts.push(`And ${total - max} more.`);
  }
  parts.push(
    "Say read email 1 for the full message, or say read my emails to hear them one by one. Nothing sends from this call.",
  );
  return truncateForSpeech(parts.join(" "), MAX_SPOKEN_CHARS);
}

export type ReadableEmailsSpeech = {
  spoken: string;
  /** Resume offset for the message just spoken; 0 when it finished. */
  nextBodyOffset: number;
  nextAttachmentIndex: number | null;
  nextAttachmentOffset: number;
  /** Zero-based index of the message spoken, or null when nothing was read. */
  spokenIndex: number | null;
};

export type SpeakReadableEmailsOptions = {
  startIndex?: number;
  batchSize?: number;
  intro?: string;
  skippedNonPrimaryCount?: number;
  scope?: CallInInboxScope;
  voiceTier?: CallInVoiceTierId;
  timeZone?: string | null;
  /** Resume the current message's body here instead of at the beginning. */
  bodyOffset?: number;
  attachmentIndex?: number;
  attachmentOffset?: number;
};

/**
 * Read emails one-by-one (default batch of 1) with an accessibility pause prompt.
 */
export function speakReadableEmails(
  emails: CallInReadableEmail[],
  options?: SpeakReadableEmailsOptions,
): string {
  return speakReadableEmailsDetailed(emails, options).spoken;
}

/**
 * Same read, plus where speech stopped so the server can resume the exact spot
 * on "continue". A long body spans several turns instead of being truncated.
 */
export function speakReadableEmailsDetailed(
  emails: CallInReadableEmail[],
  options?: SpeakReadableEmailsOptions,
): ReadableEmailsSpeech {
  const budgets = speechBudgetsForTier(options?.voiceTier ?? "standard");
  const finished = (spoken: string): ReadableEmailsSpeech => ({
    spoken,
    nextBodyOffset: 0,
    nextAttachmentIndex: null,
    nextAttachmentOffset: 0,
    spokenIndex: null,
  });

  const total = emails.length;
  if (total === 0) {
    const scope = options?.scope ?? "primary";
    if (scope === "primary") {
      return finished(
        speakEmptyPrimaryInbox(options?.skippedNonPrimaryCount ?? 0),
      );
    }
    if (scope === "promotions") {
      return finished(
        "There are no promotional or other-tab messages to read right now. Nothing sends from this call.",
      );
    }
    return finished(speakEmptyPrimaryInbox(0));
  }

  const startIndex = Math.max(0, options?.startIndex ?? 0);
  const batchSize = Math.max(1, options?.batchSize ?? DEFAULT_BATCH_SIZE);
  const slice = emails.slice(startIndex, startIndex + batchSize);

  if (slice.length === 0) {
    return finished(
      `That is the end of the list. ${total} message${total === 1 ? "" : "s"} were available. Say briefing to start over, or ask about drafts or approvals. Nothing sends from this call.`,
    );
  }

  const parts: string[] = [];
  if (options?.intro) {
    parts.push(options.intro);
  } else if (startIndex === 0 && !options?.bodyOffset) {
    parts.push(
      speakPrimaryInboxIntro({
        keptCount: total,
        skippedCount: options?.skippedNonPrimaryCount ?? 0,
        scope: options?.scope ?? "primary",
      }),
    );
  }

  const introChars = parts.join(" ").length;
  let pending: ReadableEmailChunkSpeech = {
    spoken: "",
    nextBodyOffset: 0,
    nextAttachmentIndex: null,
    nextAttachmentOffset: 0,
  };

  slice.forEach((email, i) => {
    const chunk = formatReadableEmailChunkForSpeech(
      email,
      startIndex + i + 1,
      total,
      {
        // Offsets only ever apply to the first message in the batch.
        bodyOffset: i === 0 ? options?.bodyOffset : 0,
        attachmentIndex: i === 0 ? options?.attachmentIndex : 0,
        attachmentOffset: i === 0 ? options?.attachmentOffset : 0,
        maxEmailTextChars: budgets.maxEmailTextChars,
        maxAttachmentTextChars: budgets.maxAttachmentTextChars,
        maxSpokenChars: Math.max(
          800,
          budgets.maxSpokenChars - introChars,
        ),
        timeZone: options?.timeZone,
      },
    );
    parts.push(chunk.spoken);
    if (i === 0) pending = chunk;
  });

  const hasRemainder =
    pending.nextBodyOffset > 0 || pending.nextAttachmentIndex !== null;
  const hasAttachmentChoice = Boolean(slice[0]?.attachments?.length);
  const nextIndex = startIndex + slice.length;

  if (!hasRemainder && !hasAttachmentChoice) {
    if (nextIndex < total) {
      parts.push(
        `Say next for email ${nextIndex + 1}, or ask for drafts or approvals. Nothing sends from this call.`,
      );
    } else {
      parts.push(
        "That was the last message. Say briefing to hear them again, or ask about drafts or approvals. Nothing sends from this call.",
      );
    }
  }

  return {
    spoken: parts.join(" "),
    nextBodyOffset: pending.nextBodyOffset,
    nextAttachmentIndex: pending.nextAttachmentIndex,
    nextAttachmentOffset: pending.nextAttachmentOffset,
    spokenIndex: startIndex,
  };
}

/** Select which emails to speak based on Primary vs opt-in scope. */
export function emailsForCallInScope(
  snapshot: CallInMailboxSnapshot,
  scope: CallInInboxScope,
): CallInReadableEmail[] {
  if (scope === "everything") {
    return [...snapshot.readableEmails, ...snapshot.readableEmailsNonPrimary].sort(
      (a, b) => receivedTimestamp(b) - receivedTimestamp(a),
    );
  }
  if (scope === "promotions") {
    return snapshot.readableEmailsNonPrimary;
  }
  return snapshot.readableEmails;
}

function receivedTimestamp(email: CallInReadableEmail): number {
  const timestamp = email.receivedAt ? Date.parse(email.receivedAt) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/** Map Message fields → readable email for call-in TTS */
export function toReadableEmail(input: {
  messageId?: string;
  gmailMessageId?: string;
  fromAddress: string;
  subject: string;
  snippet?: string | null;
  bodyText?: string | null;
  attachments?: CallInAttachmentSpeech[];
  inboxTab?: CallInReadableEmail["inboxTab"];
  receivedAt?: Date | string | null;
}): CallInReadableEmail {
  const body = input.bodyText?.trim() ?? "";
  const snippet = input.snippet?.trim() ?? "";
  const attachments = input.attachments;
  const inboxTab = input.inboxTab;
  const receivedAt =
    input.receivedAt instanceof Date
      ? input.receivedAt.toISOString()
      : input.receivedAt?.trim() || null;
  if (body) {
    return {
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(input.gmailMessageId ? { gmailMessageId: input.gmailMessageId } : {}),
      fromAddress: input.fromAddress,
      subject: input.subject,
      readableText: body,
      contentSource: "body",
      ...(attachments?.length ? { attachments } : {}),
      ...(inboxTab ? { inboxTab } : {}),
      ...(receivedAt ? { receivedAt } : {}),
    };
  }
  if (snippet) {
    return {
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(input.gmailMessageId ? { gmailMessageId: input.gmailMessageId } : {}),
      fromAddress: input.fromAddress,
      subject: input.subject,
      readableText: snippet,
      contentSource: "snippet",
      ...(attachments?.length ? { attachments } : {}),
      ...(inboxTab ? { inboxTab } : {}),
      ...(receivedAt ? { receivedAt } : {}),
    };
  }
  return {
    ...(input.messageId ? { messageId: input.messageId } : {}),
    ...(input.gmailMessageId ? { gmailMessageId: input.gmailMessageId } : {}),
    fromAddress: input.fromAddress,
    subject: input.subject,
    readableText: "",
    contentSource: "metadata_only",
    ...(attachments?.length ? { attachments } : {}),
    ...(inboxTab ? { inboxTab } : {}),
    ...(receivedAt ? { receivedAt } : {}),
  };
}

function normalize(text: string) {
  return text.toLowerCase().replace(/[^\w\s']/g, " ").replace(/\s+/g, " ").trim();
}

function speakableFrom(fromAddress: string): string {
  const trimmed = fromAddress.trim();
  if (!trimmed) return "unknown sender";
  const angle = trimmed.match(/^([^<]+)<([^>]+)>$/);
  if (angle) {
    const name = angle[1]?.trim();
    const email = angle[2]?.trim();
    if (name) return name;
    if (email) return email;
  }
  return trimmed;
}

function truncateForSpeech(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function parseStartIndex(q: string): number {
  const next = /\b(next|continue|keep going|more emails?|another)\b/.test(q);
  const numbered = q.match(/\b(?:email|message|number)\s*(\d+)\b/);
  if (numbered?.[1]) {
    const n = Number(numbered[1]);
    return Number.isFinite(n) && n >= 1 ? n - 1 : 0;
  }
  // "next" alone is handled by callers that track state; for rule-based
  // we interpret "next" as start at index 1 (second email) when no number given.
  if (next && !/\b(first|start|begin|briefing)\b/.test(q)) {
    return 1;
  }
  return 0;
}

/**
 * Rule-first call-in brain: answers anything about the user's correspondence status.
 * Phone and web voice share this so behavior stays consistent and tenant-scoped.
 * Never sends email from this path.
 */
export function answerCallInQuestion(
  rawQuestion: string,
  snapshot: CallInMailboxSnapshot,
): CallInAnswer {
  if (isUnrecognizedCaller(snapshot)) {
    return unrecognizedCallerAnswer();
  }

  if (snapshot.identityStatus === "syncing") {
    return {
      intent: "briefing",
      spoken:
        "I'm syncing your inbox now. Ask me to read your emails again in a moment — I'll use your real messages, never demo ones.",
    };
  }

  const q = normalize(rawQuestion);
  const timeZone = snapshot.speechTimeZone;

  if (!q) {
    return {
      intent: "help",
      spoken:
        "I did not catch that. You can ask me to read your emails, give a briefing, what needs attention, drafts, approvals, follow-ups, deadlines, or connection status.",
    };
  }

  if (
    /\b(bye|goodbye|hang up|that's all|that is all|end call|stop|cancel)\b/.test(q)
  ) {
    return {
      intent: "goodbye",
      spoken: `Goodbye, ${snapshot.ownerFirstName}. Call ${product.name} anytime you need an update. Nothing was sent.`,
    };
  }

  if (
    /\b(help|what can (i|you)|options|menu|commands)\b/.test(q) ||
    q === "what can you do"
  ) {
    return {
      intent: "help",
      spoken: `You can ask me anytime: read my emails; give me a briefing; what needs attention; any drafts; approvals waiting; follow-ups; deadlines; or is my email connected. I read each message aloud in full — from, subject, when it arrived, the whole text, then any attachments I can read. If a message is long I read part of it and tell you what is left: say continue for the rest, or say next at any time to skip it. I will never send mail from this call without a separate explicit approval.`,
    };
  }

  if (/\b(hello|hi|hey|good morning|good afternoon|good evening)\b/.test(q)) {
    return {
      intent: "greeting",
      spoken: `Hello ${snapshot.ownerFirstName}. This is ${product.name}. Ask me to read your emails, or say briefing for a full update.`,
    };
  }

  // Continue a long attachment after the first TTS chunk
  if (
    /\b(say more( about (this |the )?attachment)?|continue (the |this )?attachment|more (of )?(the |this )?attachment|rest of (the |this )?attachment|read (the )?rest of (the |this )?attachment)\b/.test(
      q,
    )
  ) {
    return {
      intent: "attachment_more",
      spoken: speakMoreAboutAttachment(snapshot.readableEmails, {
        emailIndex: 0,
        maxAttachmentTextChars: budgetsForSnapshot(snapshot)
          .maxAttachmentTextChars,
      }),
    };
  }

  // Explicit "next email" / continue reading — treat as read_emails from index 1+
  if (
    /\b(next( email| message)?|continue|keep going|another email)\b/.test(q) &&
    !/\b(draft|approval|follow|deadline|connect|attachment)\b/.test(q)
  ) {
    const startIndex = parseStartIndex(q);
    const scope = parseCallInInboxScope(rawQuestion);
    const emails = emailsForCallInScope(snapshot, scope);
    return {
      intent: "read_emails",
      spoken: speakReadableEmails(emails, {
        startIndex,
        skippedNonPrimaryCount: snapshot.skippedNonPrimaryCount,
        scope,
        voiceTier: snapshot.voiceTier,
        timeZone,
      }),
    };
  }

  if (
    /\b(what's in my inbox|what is in my inbox|inbox overview|list (my )?(emails?|subjects?)|subjects? (first|only|please)?)\b/.test(
      q,
    )
  ) {
    const scope = parseCallInInboxScope(rawQuestion);
    const emails = emailsForCallInScope(snapshot, scope);
    return {
      intent: "briefing",
      spoken: speakEmailSubjectsList(emails, {
        skippedNonPrimaryCount: snapshot.skippedNonPrimaryCount,
        scope,
        timeZone,
      }),
    };
  }

  if (
    /\b(read (my |the )?(emails?|mail|inbox|messages?)|read (them|it)( (to|for) me)?|go through (my )?(emails?|inbox)|tell me (my |the )?emails?|read (junk|spam|promotions?|promo|social|updates?|forums?|everything)|include (promotions?|everything|all tabs?))\b/.test(
      q,
    )
  ) {
    const scope = parseCallInInboxScope(rawQuestion);
    const emails = emailsForCallInScope(snapshot, scope);
    return {
      intent: "read_emails",
      spoken: speakReadableEmails(emails, {
        startIndex: 0,
        skippedNonPrimaryCount: snapshot.skippedNonPrimaryCount,
        scope,
        voiceTier: snapshot.voiceTier,
        timeZone,
      }),
    };
  }

  if (
    /\b(brief|briefing|summary|overview|catch me up|what's going on|what is going on|status)\b/.test(
      q,
    )
  ) {
    const scope = parseCallInInboxScope(rawQuestion);
    const emails = emailsForCallInScope(snapshot, scope);
    const counts = [
      `${emails.length} needing attention in Primary`,
      `${snapshot.draftsAwaitingReview} draft${snapshot.draftsAwaitingReview === 1 ? "" : "s"} awaiting review`,
      `${snapshot.approvalsPending} approval${snapshot.approvalsPending === 1 ? "" : "s"} pending`,
    ].join(", ");
    const subjects = speakEmailSubjectsList(emails, {
      skippedNonPrimaryCount: snapshot.skippedNonPrimaryCount,
      scope,
      timeZone,
    });
    return {
      intent: "briefing",
      spoken: truncateForSpeech(
        `${snapshot.briefing} Quick counts: ${counts}. Mailbox ${snapshot.mailboxEmail}. ${subjects} ${snapshot.securityNote}`,
        MAX_SPOKEN_CHARS,
      ),
    };
  }

  if (
    /\b(need(s)? attention|urgent|important|inbox|unread|waiting for me)\b/.test(q)
  ) {
    const scope = parseCallInInboxScope(rawQuestion);
    const emails = emailsForCallInScope(snapshot, scope);
    return {
      intent: "attention",
      spoken: speakReadableEmails(emails, {
        startIndex: 0,
        skippedNonPrimaryCount: snapshot.skippedNonPrimaryCount,
        scope,
        voiceTier: snapshot.voiceTier,
        timeZone,
      }),
    };
  }

  if (/\b(drafts?|wrote for me|waiting (for )?review)\b/.test(q)) {
    return {
      intent: "drafts",
      spoken: `There ${snapshot.draftsAwaitingReview === 1 ? "is" : "are"} ${snapshot.draftsAwaitingReview} draft${snapshot.draftsAwaitingReview === 1 ? "" : "s"} awaiting your review. Nothing sends until you approve.`,
    };
  }

  if (/\b(approvals?|approve|to send|ready to send)\b/.test(q)) {
    return {
      intent: "approvals",
      spoken: `There ${snapshot.approvalsPending === 1 ? "is" : "are"} ${snapshot.approvalsPending} approval${approvalsWord(snapshot.approvalsPending)} pending. Say the draft title in the app or ask an assistant to read it before you approve.`,
    };
  }

  if (/\b(follow[- ]?ups?|waiting on (them|others)|nudge)\b/.test(q)) {
    return {
      intent: "follow_ups",
      spoken: `You have ${snapshot.followUpsDue} follow-up${snapshot.followUpsDue === 1 ? "" : "s"} due.`,
    };
  }

  if (/\b(deadline|due|upcoming|calendar|schedule)\b/.test(q)) {
    if (snapshot.upcomingDeadlines.length === 0) {
      return {
        intent: "deadlines",
        spoken: "You have no upcoming correspondence deadlines on file.",
      };
    }
    const list = snapshot.upcomingDeadlines
      .map((d) => `${d.title}, due ${d.dueIn}`)
      .join(". ");
    return {
      intent: "deadlines",
      spoken: `Upcoming: ${list}.`,
    };
  }

  if (
    /\b(connect|connected|connection|gmail|sync|security|secure|logged in)\b/.test(
      q,
    )
  ) {
    return {
      intent: "connection",
      spoken: `Connection status: ${snapshot.connectionStatus}. ${snapshot.securityNote}`,
    };
  }

  if (/\b(who are you|your name|what is this)\b/.test(q)) {
    return {
      intent: "help",
      spoken: `I am ${product.name}, your secure AI-powered personal digital assistant. Call or speak anytime and I will read your mail aloud. I organize and draft; I do not send without your approval.`,
    };
  }

  return {
    intent: "unknown",
    spoken: `I heard: ${rawQuestion.trim()}. I can read your emails one by one, or help with briefing, drafts, approvals, follow-ups, deadlines, or connection status. What would you like to know?`,
  };
}

export type AnswerCallInWithLlmInput = {
  question: string;
  snapshot: CallInMailboxSnapshot;
  /** Optional LLM config override (tests) */
  llmConfig?: LlmConfig;
  /** Optional fetch override for tests — never hits a real network when provided */
  fetchImpl?: typeof fetch;
};

/**
 * Rule-first, then local LLM for unknown intents only.
 * Known intents stay deterministic. Never sends email.
 * Snapshot may include readable email text for TTS — do not invent extra bodies.
 */
export async function answerCallInQuestionWithLlm(
  input: AnswerCallInWithLlmInput,
): Promise<CallInAnswer> {
  const ruled = answerCallInQuestion(input.question, input.snapshot);
  if (ruled.intent !== "unknown") {
    return ruled;
  }
  // Never invent mail for unrecognized callers via LLM
  if (isUnrecognizedCaller(input.snapshot)) {
    return unrecognizedCallerAnswer();
  }

  const llmConfig = input.llmConfig ?? resolveLlmConfig();
  if (!llmConfig.ready) {
    return ruled;
  }

  const systemPrompt = [
    `You are ${product.name}, a secure personal inbox assistant on a phone/web call-in.`,
    "Answer only from the mailbox status snapshot below. Do not invent message bodies.",
    "Default: only Primary-inbox emails (readableEmails). Do not invent promotions/junk. skippedNonPrimaryCount is how many other-tab messages were skipped.",
    "When readableEmails are present, READ them aloud clearly: From, Subject, then message/preview text, then attachments when listed — do not vaguely summarize counts only.",
    "Never invent attachment contents. If an attachment cannot be read, say so and offer to note the filename.",
    "Never send, schedule, or claim to send email. Keep replies speakable for blind patrons.",
    "If the question cannot be answered from the snapshot, briefly say what you can help with: read emails, briefing, attention, drafts, approvals, follow-ups, deadlines, or connection.",
    `Tenant scope: ${input.snapshot.organizationId}/${input.snapshot.workspaceId}/${input.snapshot.mailboxId}.`,
    "Mailbox status snapshot (JSON):",
    JSON.stringify(snapshotForLlm(input.snapshot)),
  ].join("\n");

  const llm = await completeChat({
    config: llmConfig,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: input.question.trim().slice(0, 500) },
    ],
    fetchImpl: input.fetchImpl,
  });

  if (!llm.ok || llm.stub || !llm.content.trim()) {
    return {
      ...ruled,
      llmAssisted: false,
      llmProvider: llmConfig.provider,
    };
  }

  const spoken = sanitizeSpoken(llm.content);
  if (!spoken) {
    return {
      ...ruled,
      llmAssisted: false,
      llmProvider: llmConfig.provider,
    };
  }

  return {
    intent: "unknown",
    spoken,
    llmAssisted: true,
    llmProvider: llmConfig.provider,
  };
}

/** Payload for the LLM — includes readable email text for TTS, never invents more */
function snapshotForLlm(snapshot: CallInMailboxSnapshot) {
  return {
    ownerFirstName: snapshot.ownerFirstName,
    mailboxEmail: snapshot.mailboxEmail,
    connectionStatus: snapshot.connectionStatus,
    needingAttention: snapshot.needingAttention,
    draftsAwaitingReview: snapshot.draftsAwaitingReview,
    approvalsPending: snapshot.approvalsPending,
    followUpsDue: snapshot.followUpsDue,
    upcomingDeadlines: snapshot.upcomingDeadlines,
    skippedNonPrimaryCount: snapshot.skippedNonPrimaryCount,
    inboxNote:
      "readableEmails are Primary only. readableEmailsNonPrimary are other tabs for opt-in only.",
    readableEmails: snapshot.readableEmails.slice(0, 5).map((e) => ({
      fromAddress: e.fromAddress,
      subject: e.subject,
      receivedAt: e.receivedAt ?? null,
      receivedSpoken: speakReceivedAt(e.receivedAt, snapshot.speechTimeZone),
      readableText: e.readableText.slice(0, 400),
      contentSource: e.contentSource,
      inboxTab: e.inboxTab ?? "primary",
      attachments: (e.attachments ?? []).slice(0, 3).map((a) => ({
        filename: a.filename,
        speakableType: a.speakableType,
        status: a.status,
        readableText: a.readableText.slice(0, 200),
      })),
    })),
    readableEmailsNonPrimaryCount: snapshot.readableEmailsNonPrimary.length,
  };
}

function sanitizeSpoken(raw: string): string {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  return trimmed.length > MAX_SPOKEN_CHARS
    ? `${trimmed.slice(0, MAX_SPOKEN_CHARS - 1)}…`
    : trimmed;
}

function approvalsWord(n: number) {
  return n === 1 ? "" : "s";
}

export function openingPrompt(snapshot: CallInMailboxSnapshot): string {
  if (isUnrecognizedCaller(snapshot)) {
    return unrecognizedCallerSnapshot().securityNote;
  }
  if (snapshot.identityStatus === "syncing") {
    return `Hello ${snapshot.ownerFirstName}. This is ${product.name}. I'm syncing your inbox — ask me to read your emails in a moment.`;
  }
  const confirm = snapshot.matchedPhoneE164
    ? ` ${speakPhoneLastFour(snapshot.matchedPhoneE164)}`
    : "";
  const newMail = snapshot.newPrimaryAnnouncement
    ? ` ${snapshot.newPrimaryAnnouncement}`
    : "";
  return `Hello ${snapshot.ownerFirstName}. This is ${product.name}.${confirm}${newMail} You can ask me to read your emails anytime. For example, say read my emails, briefing, or help.`;
}
