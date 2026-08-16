/**
 * Enrich call-in readable emails with on-demand attachment text (Gmail).
 * Never invents content. Skips silently when tokens/mailbox missing.
 *
 * Latency: only the first few messages with attachments are fetched in parallel;
 * the rest announce filename only until a later sync/read path refreshes.
 */

import type { CallInReadableEmail } from "@/lib/call-in/assistant";
import { toReadableEmail } from "@/lib/call-in/assistant";
import { resolveInboxTab } from "@/lib/call-in/primary-inbox";
import {
  attachmentsFromMessageMetadata,
  enrichAttachmentsForSpeech,
  type CallInAttachmentSpeech,
  type GmailAttachmentMeta,
} from "@/lib/gmail/attachments";
import { speakableAttachmentType } from "@/lib/mail/attachment-text";

/** Cap Gmail attachment downloads per call-in snapshot (TTS reads one-by-one). */
const MAX_EMAILS_TO_FETCH_ATTACHMENTS = 3;

export type MessageRowForCallIn = {
  id: string;
  gmailId: string;
  fromAddress: string;
  subject: string;
  snippet: string | null;
  bodyText: string | null;
  metadata: unknown;
  categoryName?: string | null;
  receivedAt?: Date | string | null;
};

/**
 * Build readableEmails and, when Gmail attachment metadata exists,
 * fetch + extract text for voice. Caps apply inside enrichAttachmentsForSpeech.
 */
export async function buildReadableEmailsWithAttachments(input: {
  messages: MessageRowForCallIn[];
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  userId: string;
  /** When false, only metadata filenames are announced (no Gmail fetch). */
  fetchAttachmentBodies?: boolean;
}): Promise<CallInReadableEmail[]> {
  const fetchBodies = input.fetchAttachmentBodies !== false;
  const canFetch =
    fetchBodies &&
    Boolean(input.mailboxId) &&
    input.mailboxId !== "unknown_mb";

  // Decide which message indexes get a live attachment download
  const fetchIndexes = new Set<number>();
  if (canFetch) {
    for (let i = 0; i < input.messages.length; i++) {
      const meta = attachmentsFromMessageMetadata(input.messages[i]?.metadata);
      if (meta.length === 0) continue;
      fetchIndexes.add(i);
      if (fetchIndexes.size >= MAX_EMAILS_TO_FETCH_ATTACHMENTS) break;
    }
  }

  const enrichedByIndex = new Map<number, CallInAttachmentSpeech[]>();

  await Promise.all(
    [...fetchIndexes].map(async (index) => {
      const m = input.messages[index];
      if (!m?.gmailId) return;
      const metaList = attachmentsFromMessageMetadata(m.metadata);
      if (metaList.length === 0) return;
      try {
        const attachments = await enrichAttachmentsForSpeech({
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          mailboxId: input.mailboxId,
          userId: input.userId,
          gmailMessageId: m.gmailId,
          attachments: metaList,
        });
        enrichedByIndex.set(index, attachments);
      } catch (err) {
        console.warn("[call-in] attachment enrich failed", err);
        enrichedByIndex.set(index, metaListAsUnfetched(metaList));
      }
    }),
  );

  return input.messages.map((m, index) => {
    const metaList = attachmentsFromMessageMetadata(m.metadata);
    let attachments: CallInAttachmentSpeech[] | undefined;
    if (metaList.length > 0) {
      attachments =
        enrichedByIndex.get(index) ?? metaListAsUnfetched(metaList);
    }
    const inboxTab = resolveInboxTab({
      fromAddress: m.fromAddress,
      subject: m.subject,
      snippet: m.snippet,
      bodyText: m.bodyText,
      categoryName: m.categoryName,
      metadata: m.metadata,
    });
    return toReadableEmail({
      messageId: m.id,
      gmailMessageId: m.gmailId,
      fromAddress: m.fromAddress,
      subject: m.subject,
      snippet: m.snippet,
      bodyText: m.bodyText,
      attachments,
      inboxTab,
      receivedAt: m.receivedAt ?? null,
    });
  });
}

/**
 * Fetch attachment bytes for the single email about to be spoken.
 *
 * Snapshots are built without attachment bodies so a caller who never asks for
 * email 7 never pays to download its files. Enrichment is cached on the email
 * object for the lifetime of the snapshot.
 */
export async function enrichReadableEmailOnDemand(input: {
  email: CallInReadableEmail;
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  userId: string;
}): Promise<CallInReadableEmail> {
  const { email } = input;
  const pending = email.attachments ?? [];
  if (pending.length === 0) return email;
  if (!email.gmailMessageId) return email;
  if (!input.mailboxId || input.mailboxId === "unknown_mb") return email;
  // Already fetched (or definitively unreadable) — do not pay twice.
  if (pending.some((a) => a.status !== "unsupported" || a.readableText)) {
    return email;
  }

  const metaList: GmailAttachmentMeta[] = pending.map((a) => ({
    filename: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    attachmentId: a.attachmentId ?? null,
  }));

  try {
    const attachments = await enrichAttachmentsForSpeech({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      mailboxId: input.mailboxId,
      userId: input.userId,
      gmailMessageId: email.gmailMessageId,
      attachments: metaList,
    });
    email.attachments = attachments;
  } catch (err) {
    console.warn("[call-in] on-demand attachment enrich failed", err);
  }
  return email;
}

function metaListAsUnfetched(
  metaList: GmailAttachmentMeta[],
): CallInAttachmentSpeech[] {
  return metaList.map((meta) => {
    const speakableType = speakableAttachmentType(meta.mimeType, meta.filename);
    return {
      attachmentId: meta.attachmentId,
      filename: meta.filename,
      mimeType: meta.mimeType,
      size: meta.size,
      speakableType,
      status: "unsupported" as const,
      readableText: "",
      remainingText: "",
      reason: `I can note the filename: ${meta.filename}. Full attachment text was not loaded yet.`,
    };
  });
}
