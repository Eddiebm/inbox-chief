import type { CallInMailboxSnapshot } from "@/lib/call-in/assistant";
import { fetchGmailAttachmentBytes } from "@/lib/gmail/attachments";

export const ATTACHMENT_DELIVERY_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_DELIVERY_TTL_HOURS = 48;

export type QueueAttachmentResult =
  | { ok: true; id: string; filename: string; expiresAt: Date; spoken: string }
  | { ok: false; spoken: string; reason: string };

export function attachmentTargetFromSnapshot(
  snapshot: CallInMailboxSnapshot,
  emailNumber: number,
  attachmentNumber: number,
) {
  const emailIndex = Math.max(0, Math.floor(emailNumber) - 1);
  const attachmentIndex = Math.max(0, Math.floor(attachmentNumber) - 1);
  const email = snapshot.readableEmails[emailIndex];
  const attachment = email?.attachments?.[attachmentIndex];
  if (!email) return { ok: false as const, reason: "email_not_found" };
  if (!attachment) return { ok: false as const, reason: "attachment_not_found" };
  if (!email.messageId || !email.gmailMessageId || !attachment.attachmentId) {
    return { ok: false as const, reason: "attachment_unavailable" };
  }
  return {
    ok: true as const,
    email,
    attachment,
    messageId: email.messageId,
    gmailMessageId: email.gmailMessageId,
    attachmentId: attachment.attachmentId,
    emailIndex,
    attachmentIndex,
  };
}

export async function queueAttachmentDelivery(input: {
  snapshot: CallInMailboxSnapshot;
  requestedById: string;
  emailNumber?: number;
  attachmentNumber?: number;
}): Promise<QueueAttachmentResult> {
  if (
    !input.requestedById ||
    input.snapshot.identityStatus !== "matched" ||
    ["demo_org", "unrecognized", "no_mailbox"].includes(
      input.snapshot.organizationId,
    )
  ) {
    return {
      ok: false,
      reason: "identity_required",
      spoken:
        "I couldn't verify a signed-in mailbox for that download. Open Inbox Chief on your laptop and sign in, then try again.",
    };
  }

  const target = attachmentTargetFromSnapshot(
    input.snapshot,
    input.emailNumber ?? 1,
    input.attachmentNumber ?? 1,
  );
  if (!target.ok) {
    return {
      ok: false,
      reason: target.reason,
      spoken:
        target.reason === "email_not_found"
          ? "I couldn't find that email in your Primary inbox. Say the email number again."
          : target.reason === "attachment_not_found"
            ? "I couldn't find that attachment number. Ask me to read the attachment list, then try again."
            : "That attachment cannot be downloaded right now. I can still tell you its filename.",
    };
  }

  if (target.attachment.size > ATTACHMENT_DELIVERY_MAX_BYTES) {
    return {
      ok: false,
      reason: "too_large",
      spoken: `That file is over the 10 megabyte computer-download limit, so I did not queue it. The filename is ${target.attachment.filename}.`,
    };
  }

  const fetched = await fetchGmailAttachmentBytes({
    organizationId: input.snapshot.organizationId,
    workspaceId: input.snapshot.workspaceId,
    mailboxId: input.snapshot.mailboxId,
    userId: input.requestedById,
    gmailMessageId: target.gmailMessageId,
    attachmentId: target.attachmentId,
    maxBytes: ATTACHMENT_DELIVERY_MAX_BYTES,
  });
  if (!fetched.ok) {
    return {
      ok: false,
      reason: fetched.reason,
      spoken:
        fetched.reason === "too_large"
          ? "That file is over the 10 megabyte computer-download limit, so I did not queue it."
          : "I couldn't prepare that attachment right now. Nothing was emailed. Please try again.",
    };
  }

  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();
  const message = await prisma.message.findFirst({
    where: {
      id: target.messageId,
      gmailId: target.gmailMessageId,
      organizationId: input.snapshot.organizationId,
      workspaceId: input.snapshot.workspaceId,
      mailboxId: input.snapshot.mailboxId,
    },
    select: {
      id: true,
      fromAddress: true,
      subject: true,
      receivedAt: true,
    },
  });
  if (!message) {
    return {
      ok: false,
      reason: "tenant_message_not_found",
      spoken: "I couldn't verify that attachment belongs to your mailbox, so I did not queue it.",
    };
  }

  const expiresAt = new Date(
    Date.now() + ATTACHMENT_DELIVERY_TTL_HOURS * 60 * 60 * 1000,
  );
  const delivery = await prisma.attachmentDelivery.create({
    data: {
      organizationId: input.snapshot.organizationId,
      workspaceId: input.snapshot.workspaceId,
      mailboxId: input.snapshot.mailboxId,
      requestedById: input.requestedById,
      messageId: message.id,
      gmailMessageId: target.gmailMessageId,
      gmailAttachmentId: target.attachmentId,
      filename: target.attachment.filename,
      mimeType: target.attachment.mimeType || "application/octet-stream",
      byteSize: fetched.bytes.byteLength,
      fileBytes: Uint8Array.from(fetched.bytes),
      fromAddress: message.fromAddress,
      emailSubject: message.subject,
      emailReceivedAt: message.receivedAt,
      expiresAt,
    },
    select: { id: true },
  });

  return {
    ok: true,
    id: delivery.id,
    filename: target.attachment.filename,
    expiresAt,
    spoken: `I sent ${target.attachment.filename} to your computer downloads. Open Inbox Chief on your laptop, go to Downloads. It will be available for 48 hours. Nothing was emailed.`,
  };
}

export function safeDownloadFilename(filename: string): string {
  const cleaned = filename
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/[\r\n"\\/]/g, "_")
    .trim();
  return cleaned || "attachment";
}
