/**
 * Gmail attachment metadata + on-demand fetch for call-in TTS.
 * Uses gmail.readonly only. NEVER sends mail.
 */

import { google } from "googleapis";
import { encryptSecret } from "@/lib/crypto/token-encryption";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import {
  assertNeverAutoSend,
  GMAIL_ATTACHMENT_ALLOWED_OPERATIONS,
} from "@/lib/gmail/scopes";
import { getDecryptedMailboxTokensForTenant } from "@/lib/gmail/tokens";
import {
  extractAttachmentText,
  isImageMime,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_EMAIL,
  sliceAttachmentTextForSpeech,
  speakableAttachmentType,
  type AttachmentExtractStatus,
} from "@/lib/mail/attachment-text";

export type GmailAttachmentMeta = {
  filename: string;
  mimeType: string;
  size: number;
  /** Present when Gmail stored the part as an attachment (fetch via attachments.get) */
  attachmentId: string | null;
};

export type CallInAttachmentSpeech = {
  attachmentId?: string | null;
  filename: string;
  mimeType: string;
  size: number;
  speakableType: string;
  status: AttachmentExtractStatus;
  /** First TTS chunk (or empty when unread) */
  readableText: string;
  /** Remaining text for “say more about this attachment” */
  remainingText: string;
  reason?: string;
};

type GmailPayloadPart = {
  mimeType?: string | null;
  filename?: string | null;
  body?: {
    data?: string | null;
    size?: number | null;
    attachmentId?: string | null;
  } | null;
  parts?: GmailPayloadPart[] | null;
};

function decodeGmailBodyData(data: string | null | undefined): Buffer | null {
  if (!data) return null;
  try {
    const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized, "base64");
  } catch {
    return null;
  }
}

/**
 * Walk a full Gmail MIME tree and collect attachment metadata.
 * Skips multipart containers and inline body parts without a filename
 * (those are the email body, already handled by extractGmailPlainText).
 */
export function extractGmailAttachmentMeta(
  payload: GmailPayloadPart | null | undefined,
): GmailAttachmentMeta[] {
  if (!payload) return [];
  const out: GmailAttachmentMeta[] = [];

  const walk = (part: GmailPayloadPart | null | undefined) => {
    if (!part) return;
    const mime = (part.mimeType ?? "").toLowerCase();
    if (mime.startsWith("multipart/")) {
      for (const child of part.parts ?? []) walk(child);
      return;
    }

    const filename = (part.filename ?? "").trim();
    const attachmentId = part.body?.attachmentId?.trim() || null;
    const size = part.body?.size ?? 0;
    const hasInlineData = Boolean(part.body?.data);

    // Treat as attachment when Gmail names a file or assigns attachmentId
    const isAttachment = Boolean(filename) || Boolean(attachmentId);
    if (!isAttachment) {
      for (const child of part.parts ?? []) walk(child);
      return;
    }

    // Skip tiny unnamed inline images that are really body chrome (no filename)
    if (!filename && attachmentId && isImageMime(mime) && size < 8_000) {
      for (const child of part.parts ?? []) walk(child);
      return;
    }

    out.push({
      filename: filename || `attachment.${mime.split("/")[1] || "bin"}`,
      mimeType: mime || "application/octet-stream",
      size: typeof size === "number" ? size : 0,
      attachmentId:
        attachmentId ||
        // Inline-only parts: no attachmentId — mark null; enrich may use re-fetch
        (hasInlineData ? null : null),
    });

    for (const child of part.parts ?? []) walk(child);
  };

  walk(payload);
  return out.slice(0, MAX_ATTACHMENTS_PER_EMAIL);
}

/** Read attachments array from Message.metadata JSON. */
export function attachmentsFromMessageMetadata(
  metadata: unknown,
): GmailAttachmentMeta[] {
  if (!metadata || typeof metadata !== "object") return [];
  const raw = (metadata as { attachments?: unknown }).attachments;
  if (!Array.isArray(raw)) return [];
  const out: GmailAttachmentMeta[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const filename =
      typeof row.filename === "string" && row.filename.trim()
        ? row.filename.trim()
        : null;
    const mimeType =
      typeof row.mimeType === "string" && row.mimeType.trim()
        ? row.mimeType.trim()
        : "application/octet-stream";
    const size = typeof row.size === "number" ? row.size : 0;
    const attachmentId =
      typeof row.attachmentId === "string" && row.attachmentId.trim()
        ? row.attachmentId.trim()
        : null;
    if (!filename && !attachmentId) continue;
    out.push({
      filename: filename || `attachment.${mimeType.split("/")[1] || "bin"}`,
      mimeType,
      size,
      attachmentId,
    });
  }
  return out.slice(0, MAX_ATTACHMENTS_PER_EMAIL);
}

function oauth2Client() {
  const config = getGmailOAuthConfig();
  if (!config.ok) {
    throw new Error(config.reason);
  }
  return new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri,
  );
}

/**
 * Fetch one Gmail attachment body (readonly). Never sends.
 */
export async function fetchGmailAttachmentBytes(input: {
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  userId: string;
  gmailMessageId: string;
  attachmentId: string;
  /** Defaults to the 2 MB phone-reading limit; download queue may allow up to 10 MB. */
  maxBytes?: number;
}): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: string }> {
  assertNeverAutoSend(GMAIL_ATTACHMENT_ALLOWED_OPERATIONS);

  const config = getGmailOAuthConfig();
  if (!config.ok) {
    return { ok: false, reason: config.reason };
  }

  const decrypted = await getDecryptedMailboxTokensForTenant({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    mailboxId: input.mailboxId,
    userId: input.userId,
  });

  if (!decrypted?.refreshToken && !decrypted?.accessToken) {
    return { ok: false, reason: "mailbox_token_missing" };
  }

  const client = oauth2Client();
  client.setCredentials({
    access_token: decrypted.accessToken,
    refresh_token: decrypted.refreshToken,
    expiry_date: decrypted.expiresAt?.getTime(),
  });

  client.on("tokens", async (tokens) => {
    if (!tokens.access_token) return;
    try {
      const { getNodePrisma } = await import("@/lib/db-node");
      const prisma = getNodePrisma();
      await prisma.mailboxOAuthToken.updateMany({
        where: {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          mailboxId: input.mailboxId,
        },
        data: {
          accessTokenEnc: encryptSecret(tokens.access_token),
          ...(tokens.expiry_date
            ? { expiresAt: new Date(tokens.expiry_date) }
            : {}),
          ...(tokens.refresh_token
            ? { refreshTokenEnc: encryptSecret(tokens.refresh_token) }
            : {}),
        },
      });
    } catch (error) {
      console.error("gmail_token_refresh_persist_failed", error);
    }
  });

  const gmail = google.gmail({ version: "v1", auth: client });
  const res = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId: input.gmailMessageId,
    id: input.attachmentId,
  });

  const data = res.data.data;
  if (!data) {
    return { ok: false, reason: "attachment_empty" };
  }
  const bytes = decodeGmailBodyData(data);
  if (!bytes) {
    return { ok: false, reason: "attachment_decode_failed" };
  }
  if (bytes.byteLength > (input.maxBytes ?? MAX_ATTACHMENT_BYTES)) {
    return { ok: false, reason: "too_large" };
  }
  return { ok: true, bytes };
}

/**
 * On-demand: fetch + extract text for each attachment on a message.
 * Used when building call-in readableEmails. Never invents content.
 */
export async function enrichAttachmentsForSpeech(input: {
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  userId: string;
  gmailMessageId: string;
  attachments: GmailAttachmentMeta[];
}): Promise<CallInAttachmentSpeech[]> {
  const list = input.attachments.slice(0, MAX_ATTACHMENTS_PER_EMAIL);
  const results: CallInAttachmentSpeech[] = [];

  for (const meta of list) {
    const speakableType = speakableAttachmentType(meta.mimeType, meta.filename);

    if (meta.size > MAX_ATTACHMENT_BYTES) {
      results.push({
        attachmentId: meta.attachmentId,
        filename: meta.filename,
        mimeType: meta.mimeType,
        size: meta.size,
        speakableType,
        status: "too_large",
        readableText: "",
        remainingText: "",
        reason: `This ${speakableType} is too large to read on the phone (over 2 megabytes). I can note the filename.`,
      });
      continue;
    }

    if (!meta.attachmentId) {
      results.push({
        attachmentId: meta.attachmentId,
        filename: meta.filename,
        mimeType: meta.mimeType,
        size: meta.size,
        speakableType,
        status: "unsupported",
        readableText: "",
        remainingText: "",
        reason: `I have the filename for this ${speakableType}, but I couldn't download the file. I can note the filename.`,
      });
      continue;
    }

    try {
      const fetched = await fetchGmailAttachmentBytes({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        mailboxId: input.mailboxId,
        userId: input.userId,
        gmailMessageId: input.gmailMessageId,
        attachmentId: meta.attachmentId,
      });

      if (!fetched.ok) {
        const status =
          fetched.reason === "too_large" ? "too_large" : "error";
        results.push({
          attachmentId: meta.attachmentId,
          filename: meta.filename,
          mimeType: meta.mimeType,
          size: meta.size,
          speakableType,
          status,
          readableText: "",
          remainingText: "",
          reason:
            fetched.reason === "too_large"
              ? `This ${speakableType} is too large to read on the phone. I can note the filename.`
              : `I couldn't download this ${speakableType}. I can note the filename.`,
        });
        continue;
      }

      const extracted = await extractAttachmentText({
        mimeType: meta.mimeType,
        filename: meta.filename,
        bytes: fetched.bytes,
        byteLength: meta.size || fetched.bytes.byteLength,
      });

      if (
        (extracted.status !== "ok" && extracted.status !== "ocr_ok") ||
        !extracted.text
      ) {
        results.push({
          attachmentId: meta.attachmentId,
          filename: meta.filename,
          mimeType: meta.mimeType,
          size: meta.size,
          speakableType: extracted.speakableType,
          status: extracted.status,
          readableText: "",
          remainingText: "",
          reason: extracted.reason,
        });
        continue;
      }

      const first = sliceAttachmentTextForSpeech(extracted.text, 0);
      results.push({
        attachmentId: meta.attachmentId,
        filename: meta.filename,
        mimeType: meta.mimeType,
        size: meta.size,
        speakableType: extracted.speakableType,
        status: extracted.status === "ocr_ok" ? "ocr_ok" : "ok",
        readableText: first.spoken,
        remainingText: first.hasMore
          ? extracted.text.slice(first.nextOffset).trim()
          : "",
      });
    } catch (err) {
      console.warn("[gmail] attachment enrich failed", err);
      results.push({
        attachmentId: meta.attachmentId,
        filename: meta.filename,
        mimeType: meta.mimeType,
        size: meta.size,
        speakableType,
        status: "error",
        readableText: "",
        remainingText: "",
        reason: `I ran into a problem reading this ${speakableType}. I can note the filename.`,
      });
    }
  }

  return results;
}
