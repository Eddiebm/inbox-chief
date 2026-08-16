import { speakUrlForVoice } from "@/lib/a11y/copy";
import {
  answerCallInQuestion,
  answerCallInQuestionWithLlm,
  emailsForCallInScope,
  isUnrecognizedCaller,
  speakSelectedAttachment,
  speakReadableEmailsDetailed,
  summarizeAttachmentForSpeech,
  unrecognizedCallerAnswer,
  type CallInIntent,
  type CallInMailboxSnapshot,
} from "@/lib/call-in/assistant";
import { enrichReadableEmailOnDemand } from "@/lib/call-in/attachment-enrichment";
import { ensureFullBodyForSpeech } from "@/lib/call-in/full-body";
import {
  parseCallInInboxScope,
} from "@/lib/call-in/primary-inbox";
import {
  attachmentCursorKey,
  computeReadStartIndex,
  isCursorUsable,
  loadReadCursor,
  parseReadPosition,
  resumeAttachmentCursor,
  resumeBodyOffset,
  saveReadCursor,
} from "@/lib/call-in/read-cursor";
import {
  createReadSelection,
  decodeStoredReadSelection,
  emailsFromStoredSelection,
  encodeStoredReadSelection,
  parseSelectionCount,
  parseSelectionIndex,
  parseSelectionScope,
  readableEmailKey,
  type CallInReadSelectionScope,
} from "@/lib/call-in/read-selection";
import {
  speechBudgetsForTier,
  voiceTierInfo,
  type CallInVoiceTierId,
} from "@/lib/call-in/voice-tiers";
import {
  DEFAULT_CALL_IN_SPEECH_RATE,
  adjustSpeechRate,
  applySpeechRateToVoice,
  detectSpeechRateCommand,
  parseSpeechRateCommandArg,
  speakSpeechRateChange,
  type CallInSpeechRate,
  type SpeechRateCommand,
} from "@/lib/call-in/speech-rate";
import {
  getCallInSpeechRateForUser,
  setCallInSpeechRateForUser,
} from "@/lib/call-in/voice-preference";
import { patchLiveCallSpeechRate } from "@/lib/call-in/vapi-live-call";
import { product } from "@/lib/product";
import { queueAttachmentDelivery } from "@/lib/attachment-deliveries";
import {
  getProvisioningStatusForPhone,
  provisionSignup,
} from "@/lib/provisioning";
import { sendProvisioningSms } from "@/lib/provisioning-sms";
import { createApprovedVoiceDraft, sendApprovedDraft } from "@/lib/email-send";
import { getCalendarSpeech, type CalendarRange } from "@/lib/calendar";
import { getNodePrisma } from "@/lib/db-node";
import {
  googleConsentGuidanceSpoken,
  isGoogleOauthPublished,
} from "@/lib/google-oauth-publication";
import {
  parseMailboxAddress,
  resolveContact,
  speakContactCandidates,
} from "@/lib/contacts";

export type AttachmentAction = "read" | "summary" | "skip";

export type ParsedAttachmentRequest = {
  action: AttachmentAction;
  /** Zero-based attachment index, or null for all/default. */
  index: number | null;
  all: boolean;
  filename: string | null;
};

export const VAPI_CALL_IN_TOOL_NAMES = [
  "get_briefing",
  "read_emails",
  "get_needs_attention",
  "get_drafts",
  "get_approvals",
  "get_follow_ups",
  "get_connection_status",
  "ask_inbox",
  "route_attachment",
  "provision_signup",
  "check_provision_status",
  "compose_email",
  "confirm_email_send",
  "get_calendar",
  "save_contact_nickname",
  "set_speech_speed",
] as const;

export type VapiCallInToolName = (typeof VAPI_CALL_IN_TOOL_NAMES)[number];

/** Tool names that must never be executed on the call-in path */
const FORBIDDEN_SEND_TOOLS = [
  "send_mail",
  "send_message",
  "approve_and_send",
  "dispatch_email",
];

const TOOL_TO_QUESTION: Record<
  Exclude<
    VapiCallInToolName,
    | "ask_inbox"
    | "read_emails"
    | "route_attachment"
    | "provision_signup"
    | "check_provision_status"
    | "compose_email"
    | "confirm_email_send"
    | "get_calendar"
    | "save_contact_nickname"
    | "set_speech_speed"
  >,
  string
> = {
  get_briefing: "Give me a briefing",
  get_needs_attention: "What needs attention?",
  get_drafts: "Any drafts waiting?",
  get_approvals: "Any approvals waiting?",
  get_follow_ups: "Any follow-ups due?",
  get_connection_status: "Is my email connected?",
};

export function isForbiddenSendTool(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (n === "compose_email" || n === "confirm_email_send") return false;
  return (
    FORBIDDEN_SEND_TOOLS.includes(n) ||
    /\bsend[_ ]?(email|mail|message)\b/.test(n) ||
    n.includes("auto_send") ||
    n.includes("autosend")
  );
}

export function neverSendSpoken(): string {
  return `${product.name} never sends without first reading back the exact recipient, subject, and message and then receiving your explicit confirmation. Please compose the draft first.`;
}

export type VapiToolHandlerResult = {
  spoken: string;
  intent:
    | CallInIntent
    | "attachment_delivery"
    | "forbidden_send"
    | "provision_signup"
    | "provision_status"
    | "compose_email"
    | "send_email"
    | "calendar"
    | "contact"
    | "speech_rate"
    | "minute_cap";
  toolName: string;
  emailSent: boolean;
};

/**
 * Hard minute cap: when the org has used all included minutes for the period,
 * productive/billable call-in tools are denied. Only cheap account/setup tools
 * that don't read mail content stay available so a caller can still understand
 * their state or finish signing up. The assistant speaks the cap message
 * verbatim (see buildSpokenCapReached) and does not invent a workaround.
 */
const CAP_EXEMPT_TOOLS = new Set<string>([
  "provision_signup",
  "check_provision_status",
  "get_connection_status",
  // Changing reading speed is cheap and must work even at the minute cap.
  "set_speech_speed",
]);

/** Passed down from the webhook once org usage is loaded. */
export type CallInHardCap = { reached: boolean; spoken: string } | null;

/** Explicit index from the model, or null when it only said next/first. */
export function parseStartIndexArg(
  args?: Record<string, unknown>,
): number | null {
  const raw = args?.startIndex ?? args?.start_index ?? args?.offset;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw);
  }
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    return Number(raw.trim());
  }
  const emailNumber = args?.emailNumber ?? args?.email_number;
  if (typeof emailNumber === "number" && emailNumber >= 1) {
    return Math.floor(emailNumber) - 1;
  }
  if (typeof emailNumber === "string" && /^\d+$/.test(emailNumber.trim())) {
    return Math.max(0, Number(emailNumber.trim()) - 1);
  }
  return null;
}

type CallInToolInput = {
  name: string;
  args?: Record<string, unknown>;
  snapshot: CallInMailboxSnapshot;
  requestedById?: string | null;
  callerPhone?: string | null;
  callInIdentityId?: string | null;
  callId?: string | null;
};

export function currentReplyTarget(
  snapshot: CallInMailboxSnapshot,
  nextCursorIndex: number | null | undefined,
) {
  const currentIndex = Math.max(0, (nextCursorIndex ?? 1) - 1);
  return snapshot.readableEmails[currentIndex] ?? null;
}

function withNewPrimaryAnnouncement(
  snapshot: CallInMailboxSnapshot,
  spoken: string,
): string {
  const announcement = snapshot.newPrimaryAnnouncement?.trim();
  if (!announcement || spoken.startsWith(announcement)) return spoken;
  return `${announcement} ${spoken}`;
}

function inboxScopeFromArgs(input: CallInToolInput) {
  const explicit =
    typeof input.args?.inboxScope === "string"
      ? input.args.inboxScope
      : typeof input.args?.inbox_scope === "string"
        ? input.args.inbox_scope
        : typeof input.args?.scope === "string" &&
            ["primary", "promotions", "everything"].includes(input.args.scope)
          ? input.args.scope
          : "";
  if (
    explicit === "primary" ||
    explicit === "promotions" ||
    explicit === "everything"
  ) {
    return explicit;
  }
  return parseCallInInboxScope(
    typeof input.args?.question === "string"
      ? input.args.question
      : "read my emails",
  );
}

function hasNewSelectionArgs(args: Record<string, unknown> | undefined): boolean {
  return (
    parseSelectionScope(args) !== null ||
    parseSelectionCount(args) !== null ||
    parseSelectionIndex(args) !== null
  );
}

function resolveAttachmentIndex(
  email: CallInMailboxSnapshot["readableEmails"][number],
  request: ParsedAttachmentRequest,
): number | null {
  const attachments = email.attachments ?? [];
  if (request.filename) {
    const needle = request.filename.toLowerCase();
    const exact = attachments.findIndex(
      (attachment) => attachment.filename.toLowerCase() === needle,
    );
    if (exact >= 0) return exact;
    const partial = attachments
      .map((attachment, index) => ({ attachment, index }))
      .filter(({ attachment }) =>
        attachment.filename.toLowerCase().includes(needle),
      );
    return partial.length === 1 ? partial[0]!.index : null;
  }
  if (request.index !== null) {
    return attachments[request.index] ? request.index : null;
  }
  return attachments.length === 1 || request.all ? 0 : null;
}

function speakAttachmentChoiceError(
  email: CallInMailboxSnapshot["readableEmails"][number],
): string {
  const attachments = email.attachments ?? [];
  const choices = attachments
    .map(
      (attachment, index) =>
        `${index + 1}, ${attachment.filename || `attachment ${index + 1}`}`,
    )
    .join("; ");
  return `Please choose an attachment by filename or number: ${choices}. You can also say all, skip attachments, or next email.`;
}

/**
 * Spoken read of one message. New selections persist as message keys so later
 * "next" calls stay inside the requested subset even if the inbox changes.
 */
async function readEmailsAloud(
  input: CallInToolInput,
  toolName: string,
): Promise<VapiToolHandlerResult> {
  const stored = await loadReadCursor(input.callInIdentityId);
  const storedUsable = isCursorUsable(stored, input.callId);
  const storedSelection = storedUsable
    ? decodeStoredReadSelection(stored?.scope)
    : null;
  const position = parseReadPosition(input.args);
  const legacyStartIndex = parseStartIndexArg(input.args);
  const requestedCount = parseSelectionCount(input.args);
  const requestedIndex = parseSelectionIndex(input.args);
  const requestedSelectionScope = parseSelectionScope(input.args);
  const attachmentRequest = parseAttachmentRequest(input.args);
  const continuationRequest = position === "continue";
  const skipRequest = position === "skip";
  const startsSelection =
    (hasNewSelectionArgs(input.args) &&
      !continuationRequest &&
      !skipRequest &&
      !attachmentRequest) ||
    position === "first" ||
    (!storedSelection &&
      position === null &&
      legacyStartIndex === null &&
      !continuationRequest &&
      !skipRequest &&
      !attachmentRequest);

  const scope = startsSelection
    ? inboxScopeFromArgs(input)
    : storedSelection?.inboxScope ?? inboxScopeFromArgs(input);
  let availableEmails = emailsForCallInScope(input.snapshot, scope);
  const sender =
    typeof input.args?.sender === "string"
      ? input.args.sender
      : typeof input.args?.from === "string"
        ? input.args.from
        : "";
  if (sender.trim() && input.requestedById) {
    const prisma = getNodePrisma();
    const contacts = await prisma.contact.findMany({
      where: {
        organizationId: input.snapshot.organizationId,
        workspaceId: input.snapshot.workspaceId,
        mailboxId: input.snapshot.mailboxId,
      },
      select: { id: true, email: true, displayName: true, nickname: true },
    });
    const resolution = resolveContact(sender, contacts);
    if (resolution.kind === "ambiguous") {
      return {
        spoken: `I found more than one match. Which one: ${speakContactCandidates(resolution.candidates)}?`,
        intent: "read_emails",
        toolName,
        emailSent: false,
      };
    }
    const senderEmail =
      resolution.kind === "resolved"
        ? resolution.contact.email
        : parseMailboxAddress(sender)?.email;
    if (!senderEmail) {
      return {
        spoken: "I could not find that sender in your mail contacts. Please say their full email address.",
        intent: "read_emails",
        toolName,
        emailSent: false,
      };
    }
    availableEmails = availableEmails.filter(
      (email) => parseMailboxAddress(email.fromAddress)?.email === senderEmail,
    );
  }

  let emails = availableEmails;
  let startIndex = 0;
  let confirmation: string | undefined;
  let selectionToSave = storedSelection;

  if (startsSelection) {
    let selectionScope: CallInReadSelectionScope =
      requestedSelectionScope ?? "all";
    if (requestedCount !== null && requestedSelectionScope === null) {
      selectionScope = "newest";
    }

    let startAfterIndex: number | undefined;
    if (position === "next" && requestedCount !== null && storedSelection) {
      const previousKey =
        storedSelection.messageKeys[Math.max(0, (stored?.index ?? 1) - 1)];
      const previousIndex = availableEmails.findIndex(
        (email) => readableEmailKey(email) === previousKey,
      );
      if (previousIndex >= 0) startAfterIndex = previousIndex;
    }

    const selected = createReadSelection({
      emails: availableEmails,
      snapshot: input.snapshot,
      inboxScope: scope,
      selectionScope,
      count: requestedCount,
      index: requestedIndex,
      startAfterIndex,
    });
    emails = selected.emails;
    confirmation = selected.confirmation || undefined;
    selectionToSave = selected.stored;

    if (selected.emptySpoken) {
      await saveReadCursor({
        callInIdentityId: input.callInIdentityId,
        index: 0,
        callId: input.callId,
        scope: encodeStoredReadSelection(selected.stored),
      });
      return {
        spoken: withNewPrimaryAnnouncement(input.snapshot, selected.emptySpoken),
        intent: "read_emails",
        toolName,
        emailSent: false,
      };
    }
  } else if (storedSelection) {
    emails = emailsFromStoredSelection(
      availableEmails,
      storedSelection.messageKeys,
    );
    startIndex = computeReadStartIndex({
      position,
      explicitStartIndex: null,
      stored,
      callId: input.callId,
    });

    if (
      position === "next" &&
      startIndex >= emails.length &&
      storedSelection.selectionScope === "index" &&
      storedSelection.continuationKeys?.length
    ) {
      emails = emailsFromStoredSelection(
        availableEmails,
        storedSelection.continuationKeys,
      );
      startIndex = 0;
      confirmation = `Continuing after number ${storedSelection.requestedIndex ?? 1}.`;
      selectionToSave = {
        version: 1,
        inboxScope: scope,
        selectionScope: "all",
        messageKeys: emails.map(readableEmailKey),
      };
    }
  } else {
    // Backward compatibility for pre-selection cursors and position-only calls.
    startIndex = computeReadStartIndex({
      position,
      explicitStartIndex: legacyStartIndex,
      stored,
      callId: input.callId,
    });
    confirmation =
      startIndex === 0
        ? `Reading ${availableEmails.length} email${availableEmails.length === 1 ? "" : "s"}, most recent first.`
        : undefined;
  }

  // Attachment choices refer to the email that was just read, not the next
  // email in the message cursor.
  if (attachmentRequest && storedUsable) {
    startIndex = Math.max(0, (stored?.index ?? 1) - 1);
  }

  // Continuation only resumes the message the caller is actually hearing.
  const currentKey = emails[startIndex]
    ? readableEmailKey(emails[startIndex]!)
    : null;
  let bodyOffset = continuationRequest
    ? resumeBodyOffset(storedUsable ? stored : null, currentKey)
    : 0;
  let attachmentCursor = continuationRequest
    ? resumeAttachmentCursor(storedUsable ? stored : null, currentKey)
    : null;

  if (attachmentRequest) {
    const email = emails[startIndex];
    if (!email?.attachments?.length) {
      return {
        spoken:
          "The current email has no attachments. Say next email to move on.",
        intent: "read_emails",
        toolName,
        emailSent: false,
      };
    }
    const key = readableEmailKey(email);
    if (attachmentRequest.action === "skip") {
      await saveReadCursor({
        callInIdentityId: input.callInIdentityId,
        index: startIndex + 1,
        callId: input.callId,
        scope: selectionToSave
          ? encodeStoredReadSelection(selectionToSave)
          : scope,
      });
      return {
        spoken:
          "Skipping the attachments. Say next email to move on, or reply to this email.",
        intent: "read_emails",
        toolName,
        emailSent: false,
      };
    }

    await enrichReadableEmailOnDemand({
      email,
      organizationId: input.snapshot.organizationId,
      workspaceId: input.snapshot.workspaceId,
      mailboxId: input.snapshot.mailboxId,
      userId: input.requestedById ?? "",
    });
    const selectedIndex = resolveAttachmentIndex(email, attachmentRequest);
    if (selectedIndex === null) {
      return {
        spoken: speakAttachmentChoiceError(email),
        intent: "read_emails",
        toolName,
        emailSent: false,
      };
    }
    const attachment = email.attachments[selectedIndex]!;
    if (attachmentRequest.action === "summary") {
      await saveReadCursor({
        callInIdentityId: input.callInIdentityId,
        index: startIndex + 1,
        callId: input.callId,
        scope: selectionToSave
          ? encodeStoredReadSelection(selectionToSave)
          : scope,
      });
      return {
        spoken: summarizeAttachmentForSpeech(attachment),
        intent: "read_emails",
        toolName,
        emailSent: false,
      };
    }

    const spokenAttachment = speakSelectedAttachment(attachment, {
      maxAttachmentTextChars: speechBudgetsForTier(
        input.snapshot.voiceTier ?? "standard",
      ).maxAttachmentTextChars,
    });
    const all = attachmentRequest.all;
    const nextIndex =
      spokenAttachment.nextOffset === 0 && all
        ? selectedIndex + 1
        : selectedIndex;
    const hasNextInAll =
      spokenAttachment.nextOffset === 0 &&
      all &&
      nextIndex < email.attachments.length;
    const nextOffset = hasNextInAll ? 0 : spokenAttachment.nextOffset;
    const nextKey =
      nextOffset > 0 || hasNextInAll
        ? attachmentCursorKey(key, nextIndex, all)
        : null;
    await saveReadCursor({
      callInIdentityId: input.callInIdentityId,
      index: startIndex + 1,
      callId: input.callId,
      scope: selectionToSave
        ? encodeStoredReadSelection(selectionToSave)
        : scope,
      attachmentOffset: nextOffset,
      attachmentKey: nextKey,
    });
    return {
      spoken: hasNextInAll
        ? `${spokenAttachment.spoken} Say continue for attachment ${nextIndex + 1}, ${email.attachments[nextIndex]?.filename}.`
        : spokenAttachment.spoken,
      intent: "read_emails",
      toolName,
      emailSent: false,
    };
  }

  if (continuationRequest && attachmentCursor) {
    const email = emails[startIndex];
    const attachment = email?.attachments?.[attachmentCursor.index];
    if (!email || !attachment) {
      attachmentCursor = null;
    } else {
      await enrichReadableEmailOnDemand({
        email,
        organizationId: input.snapshot.organizationId,
        workspaceId: input.snapshot.workspaceId,
        mailboxId: input.snapshot.mailboxId,
        userId: input.requestedById ?? "",
      });
      const enriched = email.attachments?.[attachmentCursor.index];
      if (!enriched) {
        attachmentCursor = null;
      } else {
        const spokenAttachment = speakSelectedAttachment(enriched, {
          offset: attachmentCursor.offset,
          maxAttachmentTextChars: speechBudgetsForTier(
            input.snapshot.voiceTier ?? "standard",
          ).maxAttachmentTextChars,
        });
        const nextIndex =
          spokenAttachment.nextOffset === 0 && attachmentCursor.all
            ? attachmentCursor.index + 1
            : attachmentCursor.index;
        const hasNextInAll =
          spokenAttachment.nextOffset === 0 &&
          attachmentCursor.all &&
          nextIndex < (email.attachments?.length ?? 0);
        const nextOffset = hasNextInAll ? 0 : spokenAttachment.nextOffset;
        await saveReadCursor({
          callInIdentityId: input.callInIdentityId,
          index: startIndex + 1,
          callId: input.callId,
          scope: selectionToSave
            ? encodeStoredReadSelection(selectionToSave)
            : scope,
          attachmentOffset: nextOffset,
          attachmentKey:
            nextOffset > 0 || hasNextInAll
              ? attachmentCursorKey(
                  readableEmailKey(email),
                  nextIndex,
                  attachmentCursor.all,
                )
              : null,
        });
        return {
          spoken: hasNextInAll
            ? `${spokenAttachment.spoken} Say continue for attachment ${nextIndex + 1}, ${email.attachments?.[nextIndex]?.filename}.`
            : spokenAttachment.spoken,
          intent: "read_emails",
          toolName,
          emailSent: false,
        };
      }
    }
  }

  // "Continue" with nothing left on this message simply moves forward.
  if (continuationRequest && bodyOffset === 0 && !attachmentCursor) {
    const forward = Math.min(startIndex + 1, Math.max(0, emails.length));
    if (forward !== startIndex) {
      startIndex = forward;
      bodyOffset = 0;
      attachmentCursor = null;
    }
  }

  const email = emails[startIndex];
  if (email && input.snapshot.connectionStatus === "connected") {
    // The full body is only fetched for the email being read right now.
    await ensureFullBodyForSpeech({
      email,
      organizationId: input.snapshot.organizationId,
      workspaceId: input.snapshot.workspaceId,
      mailboxId: input.snapshot.mailboxId,
      userId: input.requestedById ?? "",
    });
  }

  const read = speakReadableEmailsDetailed(emails, {
    startIndex,
    intro: bodyOffset > 0 ? undefined : confirmation,
    skippedNonPrimaryCount: input.snapshot.skippedNonPrimaryCount,
    scope,
    voiceTier: input.snapshot.voiceTier,
    timeZone: input.snapshot.speechTimeZone,
    bodyOffset,
    attachmentIndex: attachmentCursor?.index ?? 0,
    attachmentOffset: attachmentCursor?.offset ?? 0,
  });

  if (email) {
    const key = readableEmailKey(email);
    await saveReadCursor({
      callInIdentityId: input.callInIdentityId,
      index: startIndex + 1,
      callId: input.callId,
      scope: selectionToSave
        ? encodeStoredReadSelection(selectionToSave)
        : scope,
      bodyOffset: read.nextBodyOffset,
      bodyKey: read.nextBodyOffset > 0 ? key : null,
      attachmentOffset: read.nextAttachmentOffset,
      attachmentKey:
        read.nextAttachmentIndex === null
          ? null
          : attachmentCursorKey(key, read.nextAttachmentIndex),
    });
  } else if (skipRequest || position === "next") {
    // Even at the end of the list, an interrupt permanently abandons any
    // body/attachment remainder from the message that was just skipped.
    await saveReadCursor({
      callInIdentityId: input.callInIdentityId,
      index: startIndex,
      callId: input.callId,
      scope: selectionToSave
        ? encodeStoredReadSelection(selectionToSave)
        : scope,
    });
  }

  return {
    spoken:
      startIndex === 0 && bodyOffset === 0
        ? withNewPrimaryAnnouncement(input.snapshot, read.spoken)
        : read.spoken,
    intent: "read_emails",
    toolName,
    emailSent: false,
  };
}

/**
 * Interrupt phrases: abandon whatever is left of the current message and move
 * on. A patron must never be stuck listening to a long email.
 */
export function isSkipCurrentEmailPhrase(normalizedQuestion: string): boolean {
  const q = normalizedQuestion;
  if (/\b(skip|move on|moving on)\b/.test(q)) return true;
  if (
    /\b(do not|don t|dont|do nt)\b.{0,24}\b(want|need|care)\b.{0,40}\b(hear|listen|read)\b/.test(
      q,
    )
  ) {
    return true;
  }
  if (/\b(stop|enough)\b.{0,24}\b(reading|this (email|message|one)|it)\b/.test(q)) {
    return true;
  }
  if (/\b(that s enough|thats enough|i get it|i ve heard enough)\b/.test(q)) {
    return true;
  }
  return false;
}

/** Phrases that mean "read me the rest of what you were reading". */
export function isContinueReadingPhrase(normalizedQuestion: string): boolean {
  const q = normalizedQuestion;
  if (/\bnext (email|message|one)\b/.test(q)) return false;
  return (
    /\b(continue|keep reading|keep going|read the rest|rest of it|rest of the (email|message|attachment)|finish (reading|it|the email|the message)|the whole (thing|email|message)|read it all|all of it|say more|tell me more|more of (it|this|the email|the message|the attachment))\b/.test(
      q,
    ) || /^more$/.test(q)
  );
}

/** Parse an explicit attachment choice from tool args or natural speech. */
export function parseAttachmentRequest(
  args: Record<string, unknown> | undefined,
): ParsedAttachmentRequest | null {
  const rawAction =
    typeof args?.attachmentAction === "string"
      ? args.attachmentAction
      : typeof args?.attachment_action === "string"
        ? args.attachment_action
        : "";
  const question =
    typeof args?.question === "string" ? args.question.toLowerCase() : "";
  const phrase = `${rawAction} ${question}`.toLowerCase().replace(/\s+/g, " ").trim();
  const mentionsAttachment =
    Boolean(rawAction) ||
    /\b(attachments?|files?|documents?|pdf|docx|pptx|xlsx|csv)\b/.test(phrase);
  if (
    !mentionsAttachment &&
    !/^(read it|read in full|summarize it|summarize instead|give me a summary|all|first|second|third)$/.test(
      phrase,
    )
  ) {
    return null;
  }

  let action: AttachmentAction | null = null;
  if (/\b(summary|summarize|summarise)\b/.test(phrase)) action = "summary";
  else if (/\b(skip|none|no attachment|next email|move on)\b/.test(phrase)) {
    action = "skip";
  } else if (/\b(read|full|open|first|second|third|all)\b/.test(phrase)) {
    action = "read";
  }
  if (!action) return null;

  const rawIndex =
    args?.attachmentIndex ??
    args?.attachment_index ??
    args?.attachmentNumber ??
    args?.attachment_number;
  let index: number | null = null;
  if (typeof rawIndex === "number" && Number.isFinite(rawIndex) && rawIndex >= 1) {
    index = Math.floor(rawIndex) - 1;
  } else if (typeof rawIndex === "string" && /^\d+$/.test(rawIndex.trim())) {
    index = Math.max(0, Number(rawIndex.trim()) - 1);
  } else if (/\b(first|1st)\b/.test(phrase)) index = 0;
  else if (/\b(second|2nd)\b/.test(phrase)) index = 1;
  else if (/\b(third|3rd)\b/.test(phrase)) index = 2;

  const filename =
    typeof args?.attachmentName === "string"
      ? args.attachmentName.trim()
      : typeof args?.attachment_name === "string"
        ? args.attachment_name.trim()
        : null;
  return {
    action,
    index,
    all: args?.allAttachments === true || /\ball\b/.test(phrase),
    filename: filename || null,
  };
}

/**
 * Reading requests phrased as free-form questions ("next one", "read my mail").
 * Returns read_emails arguments, or null when it is a different question.
 */
export function readIntentFromQuestion(
  question: string,
): {
  position?: string;
  selection?: CallInReadSelectionScope;
  count?: number;
  index?: number;
  attachmentAction?: AttachmentAction;
  attachmentIndex?: number;
  allAttachments?: boolean;
  attachmentName?: string;
  question: string;
} | null {
  const q = question.toLowerCase().replace(/[^\w\s']/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return null;
  if (/\b(draft|approval|follow|deadline|connect|sign up)\b/.test(q)) {
    return null;
  }

  const attachment = parseAttachmentRequest({ question });
  if (attachment) {
    return {
      attachmentAction: attachment.action,
      ...(attachment.index === null
        ? {}
        : { attachmentIndex: attachment.index + 1 }),
      ...(attachment.all ? { allAttachments: true } : {}),
      ...(attachment.filename ? { attachmentName: attachment.filename } : {}),
      question,
    };
  }
  // Skip wins over continue: the caller is interrupting a message in progress.
  if (isSkipCurrentEmailPhrase(q)) {
    return { position: "skip", question };
  }
  // Continuation covers both a half-read body and a half-read attachment.
  if (isContinueReadingPhrase(q)) {
    return { position: "continue", question };
  }
  if (/\battachment\b/.test(q)) {
    return null;
  }

  const numbered = q.match(
    /\b(?:email|message|number|just number)\s*(\d+)\b/,
  );
  if (numbered?.[1]) {
    return { index: Math.max(1, Number(numbered[1])), question };
  }

  if (
    /\bnew\b/.test(q) &&
    /\b(read|just|only)\b/.test(q) &&
    !/\bnewest\b/.test(q)
  ) {
    const countMatch =
      q.match(/\bnew\s+(\d+)\b/) ??
      q.match(/\bnew\s+(?:emails?|messages?)\s+(\d+)\b/);
    const count = Number(countMatch?.[1]);
    return {
      selection: "new",
      ...(Number.isFinite(count) && count > 0 ? { count } : {}),
      question,
    };
  }

  const oldest = q.match(
    /\b(?:read\s+(?:the\s+)?|the\s+)?(?:last|oldest)\s+(\d+)\b/,
  );
  if (oldest?.[1]) {
    return { selection: "oldest", count: Number(oldest[1]), question };
  }

  const first = q.match(/\b(?:read\s+(?:the\s+)?|the\s+)?first\s+(\d+)\b/);
  if (first?.[1]) {
    return {
      position: "first",
      selection: "newest",
      count: Number(first[1]),
      question,
    };
  }

  const nextCount = q.match(/\b(?:read\s+(?:the\s+)?)?next\s+(\d+)\b/);
  if (nextCount?.[1]) {
    return {
      position: "next",
      selection: "newest",
      count: Number(nextCount[1]),
      question,
    };
  }
  if (/\b(next|another one|another email|go on)\b/.test(q)) {
    return { position: "next", question };
  }
  if (/\b(start over|from the beginning|first email|read them again)\b/.test(q)) {
    return { position: "first", question };
  }
  if (
    /\b(read (my |the )?(emails?|mail|inbox|messages?)|go through (my )?(emails?|inbox)|read (them|it)( (to|for) me)?)\b/.test(
      q,
    )
  ) {
    return { position: "first", question };
  }
  return null;
}

/**
 * Change the reading speed for a call and remember it for next time.
 * Works in any mailbox state so a patron is never stuck listening too fast or
 * too slow. Persists the new rate and attempts a best-effort live update.
 */
async function handleSetSpeechSpeed(
  input: CallInToolInput,
  command: SpeechRateCommand,
  toolName: string,
): Promise<VapiToolHandlerResult> {
  const current = await getCallInSpeechRateForUser(input.requestedById);
  const next = adjustSpeechRate(current, command);
  await setCallInSpeechRateForUser({ userId: input.requestedById, rate: next });
  await patchLiveCallSpeechRate({
    callId: input.callId,
    tier: input.snapshot.voiceTier ?? "standard",
    rate: next,
  });
  return {
    spoken: speakSpeechRateChange(current, next, command),
    intent: "speech_rate",
    toolName,
    emailSent: false,
  };
}

/** Read a speech-speed command from explicit tool args (command/speed/direction). */
function speechCommandFromArgs(
  args: Record<string, unknown> | undefined,
): SpeechRateCommand | null {
  return (
    parseSpeechRateCommandArg(args?.command) ??
    parseSpeechRateCommandArg(args?.speed) ??
    parseSpeechRateCommandArg(args?.direction) ??
    parseSpeechRateCommandArg(args?.rate) ??
    (typeof args?.question === "string"
      ? detectSpeechRateCommand(args.question)
      : null)
  );
}

export async function handleCallInTool(input: {
  name: string;
  args?: Record<string, unknown>;
  snapshot: CallInMailboxSnapshot;
  requestedById?: string | null;
  callerPhone?: string | null;
  /** Matched identity — carries the read cursor so "next" advances. */
  callInIdentityId?: string | null;
  /** Provider call id — a new call restarts at the newest message. */
  callId?: string | null;
  /** Hard minute cap for the org this period; denies billable tools at 100%. */
  hardCap?: CallInHardCap;
}): Promise<VapiToolHandlerResult> {
  const name = input.name.trim();

  if (isForbiddenSendTool(name)) {
    return {
      spoken: neverSendSpoken(),
      intent: "forbidden_send",
      toolName: name,
      emailSent: false,
    };
  }

  // Hard cap: deny reading/composing/new billable work once minutes are used up.
  if (input.hardCap?.reached && !CAP_EXEMPT_TOOLS.has(name)) {
    return {
      spoken: input.hardCap.spoken,
      intent: "minute_cap",
      toolName: name,
      emailSent: false,
    };
  }

  // Reading speed can change in any state (works even at the minute cap).
  if (name === "set_speech_speed") {
    const command = speechCommandFromArgs(input.args) ?? "normal";
    return handleSetSpeechSpeed(input, command, name);
  }

  if (name === "provision_signup") {
    const gmail =
      typeof input.args?.gmail === "string"
        ? input.args.gmail
        : typeof input.args?.email === "string"
          ? input.args.email
          : "";
    const preferredName =
      typeof input.args?.preferredName === "string"
        ? input.args.preferredName
        : typeof input.args?.preferred_name === "string"
          ? input.args.preferred_name
          : undefined;
    const spokenPhone =
      typeof input.args?.phoneE164 === "string"
        ? input.args.phoneE164
        : typeof input.args?.phone === "string"
          ? input.args.phone
          : "";
    try {
      const provision = await provisionSignup({
        gmail,
        preferredName,
        phoneE164: input.callerPhone || spokenPhone,
      });
      const sms = await sendProvisioningSms({
        to: provision.phoneE164,
        magicLink: provision.magicLink,
      });
      const operatorNote =
        provision.status === "needs_google_test_user"
          ? "Inbox Chief support must enable this Gmail address once. You do not need to change any Google settings. Your account and phone are already saved."
          : "Google will ask you to approve mailbox read access in your browser.";
      const handoff =
        sms.sent
          ? "I sent the private connection link to this phone. Open that text on this phone."
          : `I could not send a text. On any device, open ${speakUrlForVoice(provision.provisionEntryUrl)} and enter code ${provision.shortCode.split("").join(" ")}.`;
      return {
        spoken: `I created your account. ${operatorNote} ${handoff} The link expires in 24 hours. Inbox Chief never sends email automatically.`,
        intent: "provision_signup",
        toolName: name,
        emailSent: false,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown";
      const spoken =
        reason === "invalid_gmail"
          ? "That must be a Gmail address ending in gmail dot com. Please say it again, then confirm the spelling before I create anything."
          : reason === "invalid_phone"
            ? "I cannot see a valid caller number. Please say or enter your cell number with area code."
            : reason === "email_in_use" || reason === "phone_in_use"
              ? "That email or phone is already attached to an account. Your account was not changed. Sign in to Inbox Chief or contact support."
              : "I could not finish account setup right now. Nothing was changed or sent. Please try again or contact Inbox Chief support.";
      return {
        spoken,
        intent: "provision_signup",
        toolName: name,
        emailSent: false,
      };
    }
  }

  if (name === "check_provision_status") {
    const spokenPhone =
      typeof input.args?.phoneE164 === "string"
        ? input.args.phoneE164
        : typeof input.args?.phone === "string"
          ? input.args.phone
          : "";
    const provision = await getProvisioningStatusForPhone(
      input.callerPhone || spokenPhone,
    );
    let spoken =
      "I do not have a setup request for this phone yet. Say sign up to create one.";
    if (provision?.status === "needs_google_test_user") {
      spoken =
        "Your account and phone are saved. Inbox Chief support still needs to enable this Gmail address once. You do not need to change any Google settings. Then open the link we sent or use your short code.";
    } else if (provision?.status === "needs_google_consent") {
      const testingGuidance = googleConsentGuidanceSpoken(
        isGoogleOauthPublished(),
      );
      spoken = `Your account and phone are saved, but your mailbox is not connected yet. Open the link we sent, or use your short code on the provision page.${testingGuidance ? ` ${testingGuidance}` : ""}`;
    } else if (provision?.status === "connected") {
      spoken = "You are connected. Say read my emails.";
    }
    return {
      spoken,
      intent: "provision_status",
      toolName: name,
      emailSent: false,
    };
  }

  if (isUnrecognizedCaller(input.snapshot)) {
    const answer = unrecognizedCallerAnswer();
    return {
      spoken: answer.spoken,
      intent: answer.intent,
      toolName: name,
      emailSent: false,
    };
  }

  if (input.snapshot.identityStatus === "syncing") {
    return {
      spoken:
        "I'm syncing your inbox now. Ask me to read your emails again in a moment.",
      intent: "briefing",
      toolName: name,
      emailSent: false,
    };
  }

  // Real mailboxes: never read stale sync after disconnect/error.
  // Demo snapshots use disconnected + identityStatus "demo" and must still read sample mail.
  const needsMailboxReconnect =
    input.snapshot.connectionStatus === "error" ||
    (input.snapshot.connectionStatus === "disconnected" &&
      input.snapshot.identityStatus !== "demo");
  if (needsMailboxReconnect) {
    return {
      spoken: input.snapshot.securityNote,
      intent: "connection",
      toolName: name,
      emailSent: false,
    };
  }

  const tenantReady =
    input.requestedById &&
    input.snapshot.organizationId &&
    input.snapshot.workspaceId &&
    input.snapshot.mailboxId;

  if (name === "compose_email") {
    if (!tenantReady) {
      return {
        spoken: "I cannot safely identify your mailbox. Nothing was sent.",
        intent: "compose_email",
        toolName: name,
        emailSent: false,
      };
    }
    const body =
      typeof input.args?.body === "string"
        ? input.args.body
        : typeof input.args?.bodyText === "string"
          ? input.args.bodyText
          : "";
    const replyToCurrent =
      input.args?.replyToCurrent === true || input.args?.reply_to_current === true;
    let recipient =
      typeof input.args?.recipient === "string"
        ? input.args.recipient
        : typeof input.args?.to === "string"
          ? input.args.to
          : "";
    let replyMessageId: string | null = null;
    let subject =
      typeof input.args?.subject === "string" ? input.args.subject.trim() : "";
    if (replyToCurrent) {
      const cursor = await loadReadCursor(input.callInIdentityId);
      const current = currentReplyTarget(input.snapshot, cursor?.index);
      if (!current) {
        return {
          spoken:
            "I lost the current email. Please read it again, then say reply to this one. Nothing was sent.",
          intent: "compose_email",
          toolName: name,
          emailSent: false,
        };
      }
      recipient = current.fromAddress;
      replyMessageId = current.messageId ?? null;
      subject = subject || (/^re:/i.test(current.subject) ? current.subject : `Re: ${current.subject}`);
    }
    if (!recipient.trim() || !body.trim()) {
      return {
        spoken:
          "I need both a recipient and a message before I can read back a draft. Nothing was sent.",
        intent: "compose_email",
        toolName: name,
        emailSent: false,
      };
    }
    const created = await createApprovedVoiceDraft({
      organizationId: input.snapshot.organizationId,
      workspaceId: input.snapshot.workspaceId,
      mailboxId: input.snapshot.mailboxId,
      userId: input.requestedById!,
      recipient,
      subject: subject || "(no subject)",
      bodyText: body,
      replyMessageId,
    });
    return {
      spoken: created.spoken,
      intent: "compose_email",
      toolName: name,
      emailSent: false,
    };
  }

  if (name === "confirm_email_send") {
    if (!tenantReady || input.args?.confirmed !== true) {
      return {
        spoken:
          "I did not receive an explicit send confirmation. Nothing was sent. Ask me to read the draft back again.",
        intent: "send_email",
        toolName: name,
        emailSent: false,
      };
    }
    const draftId =
      typeof input.args?.draftId === "string"
        ? input.args.draftId
        : typeof input.args?.draft_id === "string"
          ? input.args.draft_id
          : "";
    if (!draftId) {
      return {
        spoken: "I lost the approved draft. Nothing was sent. Please compose it again.",
        intent: "send_email",
        toolName: name,
        emailSent: false,
      };
    }
    try {
      const sent = await sendApprovedDraft({
        organizationId: input.snapshot.organizationId,
        workspaceId: input.snapshot.workspaceId,
        mailboxId: input.snapshot.mailboxId,
        userId: input.requestedById!,
        draftId,
        confirmed: true,
        approveNow: true,
      });
      return {
        spoken: `Sent to ${sent.recipient}.`,
        intent: "send_email",
        toolName: name,
        emailSent: true,
      };
    } catch {
      return {
        spoken:
          "I could not send that approved draft. Nothing new was sent. Open Approvals in the app or try again.",
        intent: "send_email",
        toolName: name,
        emailSent: false,
      };
    }
  }

  if (name === "get_calendar") {
    if (!tenantReady) {
      return {
        spoken: "Calendar isn't connected yet. You can connect it in Settings.",
        intent: "calendar",
        toolName: name,
        emailSent: false,
      };
    }
    const rawRange = input.args?.range;
    const range: CalendarRange =
      rawRange === "tomorrow" || rawRange === "next" ? rawRange : "today";
    return {
      spoken: await getCalendarSpeech({
        organizationId: input.snapshot.organizationId,
        workspaceId: input.snapshot.workspaceId,
        userId: input.requestedById!,
        range,
      }),
      intent: "calendar",
      toolName: name,
      emailSent: false,
    };
  }

  if (name === "save_contact_nickname") {
    if (!tenantReady) {
      return {
        spoken: "I cannot access Contacts until your mailbox is connected.",
        intent: "contact",
        toolName: name,
        emailSent: false,
      };
    }
    const contactName =
      typeof input.args?.contact === "string" ? input.args.contact : "";
    const nickname =
      typeof input.args?.nickname === "string" ? input.args.nickname.trim() : "";
    const prisma = getNodePrisma();
    const contacts = await prisma.contact.findMany({
      where: {
        organizationId: input.snapshot.organizationId,
        workspaceId: input.snapshot.workspaceId,
        mailboxId: input.snapshot.mailboxId,
      },
      select: { id: true, email: true, displayName: true, nickname: true },
    });
    const resolution = resolveContact(contactName, contacts);
    if (resolution.kind === "ambiguous") {
      return {
        spoken: `Which one: ${speakContactCandidates(resolution.candidates)}? I did not change any nickname.`,
        intent: "contact",
        toolName: name,
        emailSent: false,
      };
    }
    if (resolution.kind === "not_found" || !nickname) {
      return {
        spoken: "I could not find that sender or nickname. Nothing was changed.",
        intent: "contact",
        toolName: name,
        emailSent: false,
      };
    }
    await prisma.contact.updateMany({
      where: {
        id: resolution.contact.id,
        organizationId: input.snapshot.organizationId,
        workspaceId: input.snapshot.workspaceId,
        mailboxId: input.snapshot.mailboxId,
      },
      data: { nickname },
    });
    return {
      spoken: `Saved ${resolution.contact.displayName || resolution.contact.email} as ${nickname}.`,
      intent: "contact",
      toolName: name,
      emailSent: false,
    };
  }

  if (name === "read_emails") {
    return readEmailsAloud(input, name);
  }

  if (name === "route_attachment") {
    const emailNumber = parsePositiveNumber(
      input.args?.emailNumber ?? input.args?.email_number,
      1,
    );
    const attachmentNumber = parsePositiveNumber(
      input.args?.attachmentNumber ?? input.args?.attachment_number,
      1,
    );
    const queued = await queueAttachmentDelivery({
      snapshot: input.snapshot,
      requestedById: input.requestedById ?? "",
      emailNumber,
      attachmentNumber,
    });
    return {
      spoken: queued.spoken,
      intent: "attachment_delivery",
      toolName: name,
      emailSent: false,
    };
  }

  if (name === "ask_inbox") {
    const question =
      typeof input.args?.question === "string"
        ? input.args.question
        : typeof input.args?.query === "string"
          ? input.args.query
          : "";
    if (!question.trim()) {
      const help = answerCallInQuestion("help", input.snapshot);
      return {
        spoken: help.spoken,
        intent: help.intent,
        toolName: name,
        emailSent: false,
      };
    }
    // "faster" / "slower" / "normal speed" spoken mid-read change the pace.
    const speedCommand = detectSpeechRateCommand(question);
    if (speedCommand) {
      return handleSetSpeechSpeed(input, speedCommand, name);
    }
    // Reading requests routed here still use the cursor, so "next" advances.
    const asRead = readIntentFromQuestion(question);
    if (asRead) {
      return readEmailsAloud(
        { ...input, args: { ...(input.args ?? {}), ...asRead } },
        name,
      );
    }
    const answer = await answerCallInQuestionWithLlm({
      question,
      snapshot: input.snapshot,
    });
    return {
      spoken: answer.spoken,
      intent: answer.intent,
      toolName: name,
      emailSent: false,
    };
  }

  const mapped = TOOL_TO_QUESTION[name as keyof typeof TOOL_TO_QUESTION];
  if (mapped) {
    const answer = answerCallInQuestion(mapped, input.snapshot);
    if (answer.intent === "attention" || answer.intent === "read_emails") {
      // These start at the first message, so "next" should land on the second.
      await saveReadCursor({
        callInIdentityId: input.callInIdentityId,
        index: 1,
        callId: input.callId,
      });
    }
    return {
      spoken:
        name === "get_briefing" || name === "get_needs_attention"
          ? withNewPrimaryAnnouncement(input.snapshot, answer.spoken)
          : answer.spoken,
      intent: answer.intent,
      toolName: name,
      emailSent: false,
    };
  }

  // Unknown tool → free-form ask path (still never sends)
  const fallbackQ =
    typeof input.args?.question === "string"
      ? input.args.question
      : `Tell me about ${name.replaceAll("_", " ")}`;
  const answer = await answerCallInQuestionWithLlm({
    question: fallbackQ,
    snapshot: input.snapshot,
  });
  return {
    spoken: answer.spoken,
    intent: answer.intent,
    toolName: name,
    emailSent: false,
  };
}

export function buildCallInVapiTools(serverUrl: string) {
  const toolServer = { url: `${serverUrl.replace(/\/$/, "")}/api/call-in/vapi/webhook` };

  const defs: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
    server: { url: string };
  }> = [
    {
      type: "function",
      function: {
        name: "provision_signup",
        description:
          "Create an Inbox Chief account for an unrecognized caller or any caller who explicitly says sign up, create account, or get started. Before calling: collect a Gmail address, spell it back character by character, get explicit confirmation, and optionally ask for a preferred name. Caller ID is used as the phone; ask for phoneE164 only when caller ID is unavailable.",
        parameters: {
          type: "object",
          properties: {
            gmail: {
              type: "string",
              description: "Confirmed Gmail address after spelling it back.",
            },
            preferredName: {
              type: "string",
              description: "Optional caller-provided preferred name. Never guess one.",
            },
            phoneE164: {
              type: "string",
              description:
                "Caller-spoken cell number only when caller ID is unavailable.",
            },
          },
          required: ["gmail"],
        },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "check_provision_status",
        description:
          "Check whether this caller is waiting for operator Gmail enablement, waiting for Google browser consent, or connected. Use when they ask about setup or when their saved phone has no connected mailbox.",
        parameters: {
          type: "object",
          properties: {
            phoneE164: {
              type: "string",
              description:
                "Caller-spoken cell number only when caller ID is unavailable.",
            },
          },
          required: [],
        },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "route_attachment",
        description:
          "Queue one attachment for the signed-in patron's secure Downloads page. Use when the caller says send this attachment to my computer, download on my laptop, or route attachment 1. This never emails the file.",
        parameters: {
          type: "object",
          properties: {
            emailNumber: {
              type: "number",
              description: "One-based email number from the spoken Primary inbox list.",
            },
            attachmentNumber: {
              type: "number",
              description: "One-based attachment number. Defaults to 1.",
            },
          },
          required: [],
        },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "compose_email",
        description:
          "Create a draft and return its exact recipient, subject, and body for spoken read-back. This NEVER sends. Use for 'email Jordan...', 'send a message to address...', or 'reply to this one'. For reply, set replyToCurrent=true and omit recipient. After speaking the result verbatim, wait for explicit approval before any confirmation tool.",
        parameters: {
          type: "object",
          properties: {
            recipient: {
              type: "string",
              description: "Spoken contact name/nickname or fully spelled email address. Omit for reply to current.",
            },
            subject: { type: "string" },
            body: { type: "string" },
            replyToCurrent: {
              type: "boolean",
              description: "True only for reply to this/current email.",
            },
          },
          required: ["body"],
        },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "confirm_email_send",
        description:
          "Send one already-read-back draft. Call ONLY after the immediately preceding compose_email result was spoken verbatim and the caller explicitly said approve, send it, yes send, or equivalent. Never call after hesitation, no, change it, silence, or a new request.",
        parameters: {
          type: "object",
          properties: {
            draftId: {
              type: "string",
              description: "Exact confirmation code returned by compose_email.",
            },
            confirmed: {
              type: "boolean",
              description: "Must be true only after explicit spoken send approval.",
            },
          },
          required: ["draftId", "confirmed"],
        },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "get_calendar",
        description:
          "Read real Google Calendar events. Map 'what is on my calendar today' to today, 'tomorrow' to tomorrow, and 'what is next' to next. Never invent events.",
        parameters: {
          type: "object",
          properties: {
            range: { type: "string", enum: ["today", "tomorrow", "next"] },
          },
          required: ["range"],
        },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "save_contact_nickname",
        description:
          "Save a voice nickname for a sender/contact already derived from synced mail. Use for 'save this sender as Mom' or 'call Jordan Lee Jordan'. If ambiguous, speak candidates and ask; never guess.",
        parameters: {
          type: "object",
          properties: {
            contact: { type: "string" },
            nickname: { type: "string" },
          },
          required: ["contact", "nickname"],
        },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "set_speech_speed",
        description:
          "Change how fast Inbox Chief reads. Call this whenever the caller asks about pace: 'faster', 'speed up', 'read faster', 'too slow' → command=faster; 'slower', 'slow down', 'too fast', 'not so fast' → command=slower; 'normal speed', 'regular speed', 'reset the speed' → command=normal. It steps one level per faster/slower and saves the choice for future calls. Speak the tool result verbatim.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              enum: ["faster", "slower", "normal"],
              description:
                "faster = one step quicker; slower = one step slower; normal = reset to normal speed.",
            },
          },
          required: ["command"],
        },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "get_briefing",
        description:
          "Accessibility briefing: read Primary-inbox emails needing attention aloud one at a time (from, subject, then message/preview). Skips promotions/social/updates/forums/spam unless the caller asked for those. Do not only give a count.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "read_emails",
        description:
          "Read a caller-selected subset aloud one message at a time (From, Subject, received time, the FULL body, then attachments). Long bodies come back one turn at a time and the result text says how much remains — speak that verbatim. Use position=continue when the caller says continue, more, keep reading, or rest of it. Use position=skip when they say skip this, move on, next mail, or that they do not want to hear the whole email. Map first N to selection=newest,count=N; last N or oldest N to selection=oldest,count=N; new N or just the new ones to selection=new,count=N or no count; number K to index=K; next N to position=next,selection=newest,count=N. Never stop after one email unless the result says it was last. Primary is default; use inboxScope for opt-in tabs.",
        parameters: {
          type: "object",
          properties: {
            position: {
              type: "string",
              description:
                "first = start at the newest message (read my emails, start over). next = the following message. continue = read the rest of the message or attachment already in progress (continue, more, keep reading, rest of it). skip = abandon the rest of the current message and go to the next one (skip this, move on, next mail, I do not want to hear the full email). repeat = read the same message again. previous = go back one.",
              enum: [
                "first",
                "next",
                "continue",
                "skip",
                "previous",
                "repeat",
              ],
            },
            startIndex: {
              type: "number",
              description:
                "Legacy zero-based specific index. Prefer index, which is one-based.",
            },
            scope: {
              type: "string",
              description:
                "Selection scope: new, all, oldest, or newest. Legacy inbox values primary, promotions, and everything are also accepted.",
              enum: [
                "new",
                "all",
                "oldest",
                "newest",
                "primary",
                "promotions",
                "everything",
              ],
            },
            selection: {
              type: "string",
              description:
                "Preferred subset selector. new means received after the last successful call; newest means the first/most recent items; oldest means the last/oldest items; all means the readable window.",
              enum: ["new", "all", "oldest", "newest"],
            },
            count: {
              type: "integer",
              minimum: 1,
              maximum: 20,
              description:
                "Requested subset size, capped at 20. Omit for all matching messages.",
            },
            index: {
              type: "integer",
              minimum: 1,
              maximum: 20,
              description:
                "One-based message number for 'read number K'. Do not combine with count.",
            },
            inboxScope: {
              type: "string",
              description:
                "primary by default; promotions for other tabs; everything for all non-spam inbox tabs. Set a non-primary value only when explicitly requested.",
              enum: ["primary", "promotions", "everything"],
            },
            sender: {
              type: "string",
              description:
                "Optional sender name, nickname, company label, or email for 'read mail from Mom' and 'any new mail from COARE'. The server disambiguates and never guesses.",
            },
            attachmentAction: {
              type: "string",
              enum: ["read", "summary", "skip"],
              description:
                "Use only after attachments were announced. read = fetch and read the selected file in full across turns. summary = fetch and give a clearly labeled extractive summary. skip = do not fetch and skip attachments.",
            },
            attachmentIndex: {
              type: "integer",
              minimum: 1,
              maximum: 5,
              description:
                "One-based attachment number for first, second, or a numbered choice.",
            },
            attachmentName: {
              type: "string",
              description:
                "Filename spoken by the caller. Use instead of attachmentIndex when they name a file.",
            },
            allAttachments: {
              type: "boolean",
              description:
                "True when the caller explicitly asks for all attachments. They are read one at a time.",
            },
          },
          required: [],
        },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "get_needs_attention",
        description:
          "Read Primary messages that need attention aloud (from, subject, message text) — not promotions or junk unless asked.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "get_drafts",
        description: "Report drafts awaiting the owner's review. Never sends mail.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "get_approvals",
        description: "Report approvals pending before any mail can be sent.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "get_follow_ups",
        description: "Report follow-ups that are due.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "get_connection_status",
        description: "Report whether the owner's mailbox is connected.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      server: toolServer,
    },
    {
      type: "function",
      function: {
        name: "ask_inbox",
        description:
          "Answer any other mailbox question in plain language. Prefer reading email content when asked. Never sends email.",
        parameters: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "The caller's question about their mail",
            },
          },
          required: ["question"],
        },
      },
      server: toolServer,
    },
  ];

  return defs;
}

export function buildCallInSystemPrompt(): string {
  return [
    `You are ${product.name}, a secure personal inbox assistant on an inbound phone call.`,
    "Accessibility-first: blind patrons rely on exact speech — READ tool results VERBATIM. Do not paraphrase, embroider, or invent details.",
    "The opening and first briefing/read tool result may contain the exact new-Primary-mail count since the caller's last completed call. Speak that count exactly; never estimate it or substitute unread/promotional counts.",
    "Default inbox scope is Gmail Primary only. Do not invent promotions, social, updates, forums, or spam. Follow tool results: if they say skipping promotional messages, speak that.",
    "Only include other tabs when the caller explicitly says read promotions, read junk, read everything, or similar. Then pass inboxScope=promotions or inboxScope=everything to read_emails. This composes with selection and count.",
    "Only use a subjects-first overview when the caller explicitly asks for an overview, a list, or what's in my inbox. Anything like read my emails, read my mail, or go through my inbox means a full read, one message at a time.",
    "When the caller asks for a briefing, what's in their inbox, read my emails, or what needs attention: call get_briefing, read_emails, or get_needs_attention.",
    // Reading pace is patron-controlled and must not be ignored or improvised.
    "SPEED CONTROL: if the caller says anything about pace — faster, speed up, read faster, too slow, slower, slow down, too fast, not so fast, normal speed, regular speed, or reset the speed — call set_speech_speed with command=faster, slower, or normal. Do not treat these as a new reading request and do not restart the inbox. Speak the tool's confirmation verbatim, then continue from where you were if you were mid-read.",
    "Never change the reading speed on your own and never claim you sped up or slowed down without calling set_speech_speed. The saved speed carries to the caller's next call.",
    // Root cause of an earlier complaint: the assistant stopped after the newest message.
    "The inbox has many messages. Start with read_emails position=first. Use position=skip for next, next email, move on, or skip while content is in progress; otherwise use position=next for another email. Continue, more, and keep reading mean position=continue for the current body or attachment.",
    "Subset mapping is exact: 'first 10' means selection=newest,count=10; say the tool's confirmation '10 most recent'. 'last 10' or 'oldest 10' means selection=oldest,count=10. 'new 3' means selection=new,count=3. 'just the new ones' means selection=new with no count. 'number 4' means index=4. 'next 3' means position=next,selection=newest,count=3.",
    "For read mail from Mom or any new mail from COARE, call read_emails with sender set to the spoken name and selection=new when they said new. Speak ambiguity results and ask which one; never silently choose.",
    "After starting a subset, position=next stays inside it and the tool reports Email N of M relative to that subset. Do not switch back to the whole inbox, fabricate extra messages, or stop after the first item.",
    "Always speak the tool's short selection confirmation before its first email. If fewer messages exist than requested, speak the real available count from the tool and read only those. If there are no new messages, speak that exact result.",
    "Never end the reading after one email. Only say the list is finished when a tool result itself says it was the last message. Never summarize the inbox instead of reading it, and never claim there is nothing else to read unless the tool said so.",
    "The tool result already contains 'Email N of M' — speak that count so the caller knows how many remain.",
    // Root cause of Eddie's complaint: bodies were cut off mid-message.
    "READ THE WHOLE EMAIL. The tool returns the full body, split across turns when it is long. Speak every word of the body text it gives you. NEVER summarize, shorten, paraphrase, or skip ahead in a body you were given, and never decide a message is too long to read.",
    "When a result ends with a continuation offer (there is more of this message / the rest is the earlier thread / there is more of a file), speak that offer word for word. Never end a message mid-sentence without speaking the offer that came with it.",
    "When the caller says continue, more, keep reading, rest of it, or read the rest, call read_emails with position=continue. The server resumes at the exact character where speech stopped — never guess an offset or re-read from the top.",
    "The caller may interrupt at ANY time. When they say next, next email, move on, move on to the next mail, skip this, stop reading this one, or that they do not want to hear the full email, call read_emails with position=skip immediately. Stop speaking the current message, do not finish the sentence, and do not offer its remainder again.",
    "After the first part of a long message, and in help, remind them briefly: say continue for the rest, or next to move on.",
    "Speak tool results faithfully. Each full email should be heard as: Email N of M. From …. Subject: …. Received {weekday, month day, year, time}. then Message/Preview text. After the body, announce attachment count, filename, and type only. Never invent a received date.",
    "ATTACHMENT CONSENT: never read, summarize, download, or extract attachment contents merely because an email has attachments. First speak the metadata-only choices returned by the tool and wait for the caller.",
    "Attachment choices map exactly: read it/read in full/filename/first/second means attachmentAction=read with attachmentIndex or attachmentName; summarize it/give me a summary/summarize instead means attachmentAction=summary; skip attachments means attachmentAction=skip; all means attachmentAction=read and allAttachments=true.",
    "For multiple attachments, require a filename, ordinal, number, or all. Never guess which file. When all is requested, read them one at a time and wait for continue between files.",
    "A tool result labeled Summary is an extractive summary, not full content. Speak that label and limitation verbatim. Never represent a summary or preview as the full attachment.",
    "If extraction is unsupported, failed, oversized, encrypted, corrupt, or lacks OCR, speak the tool's plain explanation and never hallucinate content.",
    "If a result says more of a file remains, offer it. Continue means position=continue. During a full attachment read, next/skip abandons it and moves to the next email; summarize instead calls attachmentAction=summary and replaces the remaining full-read state.",
    "After each email (or short batch), pause and offer: next email, attachment choices, the rest of this one, or reply to this one.",
    "When the caller says send this attachment to my computer, download on my laptop, or route attachment N, call route_attachment. Use the current email number and requested attachment number; default each to 1 only when unambiguous.",
    "Attachment routing means the secure signed-in Downloads page only. Never ask for or email the file to an address.",
    "EMAIL SAFETY IS ABSOLUTE. compose_email only drafts. Speak its entire read-back verbatim: recipient, email address, subject, body, and that nothing was sent. Then stop and wait.",
    "NEVER send without that complete read-back followed by explicit confirmation in a separate caller turn.",
    "Call confirm_email_send ONLY when the caller explicitly approves that exact read-back with approve, send it, yes send, or equivalent. Pass its exact draftId and confirmed=true. Silence, hesitation, no, cancel, change it, or any revision means DO NOT call confirmation; revise with compose_email and read back again.",
    "Never infer confirmation from the original request to email someone. The original request authorizes drafting only. Confirmation must happen after read-back in a separate caller turn.",
    "For reply to this one, call compose_email with replyToCurrent=true. For a name or nickname, let the tool resolve it. If the tool reports ambiguity, speak every candidate and ask which one; never guess.",
    "For calendar today, tomorrow, or next, call get_calendar and speak its result verbatim. If disconnected, tell them to use the optional Connect Calendar action in Settings. Never invent an event.",
    "For save this sender as Mom or call Jordan Lee Jordan, call save_contact_nickname. Never use a guessed contact.",
    "MINUTES EXHAUSTED: if a tool result says the caller has no call minutes left (included and purchased both used up), speak that result VERBATIM and stop. Do not read mail, compose, or start any new request. Do not invent a workaround, an emergency buffer, or a way to keep going. Valid choices are: buy more minutes in the Inbox Chief dashboard, upgrade the plan, or wait for the next period.",
    "Keep language plain. If only subject/from is available, say so and still read that metadata.",
    "When an unrecognized caller says sign up, create account, or get started: ask for their Gmail address, spell it back character by character, obtain explicit confirmation, then ask for an optional preferred name. Call provision_signup only after confirmation.",
    "Caller ID is the phone by default. If caller ID is unavailable, ask them to say or enter their cell number, including area code. Never ask for a phone when the tool already has caller ID.",
    "When a saved caller has not connected Gmail, call check_provision_status. Tell them their phone is saved and to open the link or ask their operator. Do not read any email or attachment content during provisioning.",
    // Hard rule: unmatched / CNAM — never invent names or demo mail (blind patrons)
    "NEVER invent or speak a person's name from caller ID, CNAM, or guesswork. Ignore customer.name and any carrier name fields.",
    "Only greet by first name AFTER a tool result confirms a matched mailbox (our app's known display name).",
    "For an unrecognized phone, offer account setup: say sign up or get started. Never claim the mailbox is connected until check_provision_status confirms it.",
    "Never invent demo or fixture emails for an unrecognized caller.",
  ].join("\n");
}

function parsePositiveNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Math.max(1, Number(value.trim()));
  }
  return fallback;
}

export function buildCallInAssistantPayload(
  serverUrl: string,
  options?: {
    voiceTier?: CallInVoiceTierId;
    speechRate?: CallInSpeechRate;
    firstMessage?: string;
  },
): Record<string, unknown> {
  const base = serverUrl.replace(/\/$/, "");
  const webhookUrl = `${base}/api/call-in/vapi/webhook`;
  const webhookHeaders: Record<string, string> = {};
  if (process.env.VAPI_WEBHOOK_SECRET) {
    webhookHeaders["x-vapi-secret"] = process.env.VAPI_WEBHOOK_SECRET;
  }

  const tier = options?.voiceTier ?? "standard";
  const rate = options?.speechRate ?? DEFAULT_CALL_IN_SPEECH_RATE;
  const voiceInfo = applySpeechRateToVoice(voiceTierInfo(tier).vapi, rate);
  const voice: Record<string, unknown> = {
    provider: voiceInfo.provider,
    voiceId: voiceInfo.voiceId,
  };
  if (voiceInfo.model) {
    voice.model = voiceInfo.model;
  }
  if (voiceInfo.language) {
    voice.language = voiceInfo.language;
  }
  if (voiceInfo.experimentalControls) {
    voice.experimentalControls = voiceInfo.experimentalControls;
  }
  if (typeof voiceInfo.speed === "number") {
    voice.speed = voiceInfo.speed;
  }

  return {
    name: `${product.name} — Anytime Call-in`,
    firstMessage:
      options?.firstMessage ??
      `Hello. This is ${product.name}. Ask me to read your emails, check your calendar, or compose a message. Email only sends after I read it back and you explicitly confirm.`,
    model: {
      provider: "openai",
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [{ role: "system", content: buildCallInSystemPrompt() }],
      tools: buildCallInVapiTools(base),
    },
    voice,
    server: {
      url: webhookUrl,
      ...(Object.keys(webhookHeaders).length ? { headers: webhookHeaders } : {}),
    },
    serverUrl: webhookUrl,
    serverMessages: ["tool-calls", "end-of-call-report", "status-update"],
    endCallFunctionEnabled: true,
    silenceTimeoutSeconds: 45,
    maxDurationSeconds: 1800,
    backgroundSound: "off",
  };
}
