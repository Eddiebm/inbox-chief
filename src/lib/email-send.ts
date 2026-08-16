import { google } from "googleapis";
import { getNodePrisma } from "@/lib/db-node";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import { GMAIL_SEND_SCOPE } from "@/lib/gmail/scopes";
import { getDecryptedMailboxTokensForTenant } from "@/lib/gmail/tokens";
import { writeAuditLog } from "@/lib/audit";
import {
  parseMailboxAddress,
  resolveContact,
  speakContactCandidates,
} from "@/lib/contacts";

export type SendTenantScope = {
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  userId: string;
};

export function assertConfirmedSend(input: {
  status: string;
  confirmed: boolean;
}): void {
  if (input.status !== "APPROVED" || input.confirmed !== true) {
    throw new Error("send_confirmation_required");
  }
}

function encodeMime(input: {
  from: string;
  to: string[];
  subject: string;
  bodyText: string;
}): string {
  const mime = [
    `From: ${input.from}`,
    `To: ${input.to.join(", ")}`,
    `Subject: ${input.subject.replace(/[\r\n]+/g, " ")}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.bodyText,
  ].join("\r\n");
  return Buffer.from(mime)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function createApprovedVoiceDraft(input: SendTenantScope & {
  recipient: string;
  subject: string;
  bodyText: string;
  replyMessageId?: string | null;
}): Promise<
  | { ok: true; draftId: string; recipientLabel: string; spoken: string }
  | { ok: false; spoken: string }
> {
  const prisma = getNodePrisma();
  const direct = parseMailboxAddress(input.recipient);
  let email = direct?.email ?? "";
  let recipientLabel = direct?.displayName || direct?.email || input.recipient;

  if (!direct) {
    const contacts = await prisma.contact.findMany({
      where: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        mailboxId: input.mailboxId,
      },
      select: { id: true, email: true, displayName: true, nickname: true },
    });
    const resolution = resolveContact(input.recipient, contacts);
    if (resolution.kind === "ambiguous") {
      return {
        ok: false,
        spoken: `I found more than one match. Which one: ${speakContactCandidates(resolution.candidates)}? Nothing was sent.`,
      };
    }
    if (resolution.kind === "not_found") {
      return {
        ok: false,
        spoken:
          "I could not find that person in your mail contacts. Please say and spell their full email address. Nothing was sent.",
      };
    }
    email = resolution.contact.email;
    recipientLabel =
      resolution.contact.nickname ||
      resolution.contact.displayName ||
      resolution.contact.email;
  }

  const message = input.replyMessageId
    ? await prisma.message.findFirst({
        where: {
          id: input.replyMessageId,
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          mailboxId: input.mailboxId,
        },
        select: { id: true },
      })
    : null;
  if (input.replyMessageId && !message) {
    return { ok: false, spoken: "I lost the current email. Please read it again, then say reply to this one. Nothing was sent." };
  }

  const draft = await prisma.draft.create({
    data: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      mailboxId: input.mailboxId,
      createdById: input.userId,
      messageId: message?.id,
      status: "AWAITING_APPROVAL",
      toAddresses: [email],
      subject: input.subject.trim() || "(no subject)",
      bodyText: input.bodyText.trim(),
    },
  });
  await writeAuditLog({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    mailboxId: input.mailboxId,
    actorId: input.userId,
    action: "REQUEST_APPROVAL",
    resourceType: "draft",
    resourceId: draft.id,
    summary: `Voice read-back prepared for ${email}: ${draft.subject}`,
    metadata: { recipient: email, subject: draft.subject, channel: "phone" },
  });

  return {
    ok: true,
    draftId: draft.id,
    recipientLabel,
    spoken: `Please confirm. To ${recipientLabel}, ${email}. Subject: ${draft.subject}. Message: ${draft.bodyText}. Say approve or send it to send this exact message. Say no or change it to revise. Nothing has been sent yet. Confirmation code ${draft.id}.`,
  };
}

export async function sendApprovedDraft(
  input: SendTenantScope & {
    draftId: string;
    confirmed: boolean;
    approveNow?: boolean;
  },
): Promise<{ recipient: string; subject: string; gmailMessageId: string }> {
  const prisma = getNodePrisma();
  let draft = await prisma.draft.findFirst({
    where: {
      id: input.draftId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      mailboxId: input.mailboxId,
    },
  });
  if (!draft) throw new Error("draft_not_found");
  if (
    input.approveNow === true &&
    input.confirmed === true &&
    draft.status === "AWAITING_APPROVAL"
  ) {
    const approved = await prisma.draft.updateMany({
      where: {
        id: draft.id,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        mailboxId: input.mailboxId,
        status: "AWAITING_APPROVAL",
      },
      data: { status: "APPROVED", approvedById: input.userId },
    });
    if (approved.count !== 1) throw new Error("draft_state_changed");
    draft = { ...draft, status: "APPROVED", approvedById: input.userId };
  }
  assertConfirmedSend({ status: draft.status, confirmed: input.confirmed });

  const mailbox = await prisma.mailbox.findFirst({
    where: {
      id: input.mailboxId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      ownerId: input.userId,
    },
    select: { emailAddress: true },
  });
  if (!mailbox) throw new Error("mailbox_not_found");
  const tokens = await getDecryptedMailboxTokensForTenant(input);
  if (!tokens || !tokens.scopes.includes(GMAIL_SEND_SCOPE)) {
    throw new Error("gmail_send_scope_required");
  }
  const config = getGmailOAuthConfig();
  if (!config.ok) throw new Error(config.reason);
  const auth = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri,
  );
  auth.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expiry_date: tokens.expiresAt?.getTime(),
  });
  const gmail = google.gmail({ version: "v1", auth });
  const reply = draft.messageId
    ? await prisma.message.findFirst({
        where: {
          id: draft.messageId,
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          mailboxId: input.mailboxId,
        },
        select: { threadId: true },
      })
    : null;
  // Claim the approved draft before the network call so concurrent confirmations
  // cannot send it twice. A failed Gmail call restores APPROVED for a safe retry.
  const claimed = await prisma.draft.updateMany({
    where: {
      id: draft.id,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      mailboxId: input.mailboxId,
      status: "APPROVED",
    },
    data: { status: "SENT", sentAt: new Date() },
  });
  if (claimed.count !== 1) throw new Error("draft_already_sent");

  let gmailMessageId: string;
  try {
    const sent = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodeMime({
          from: mailbox.emailAddress,
          to: draft.toAddresses,
          subject: draft.subject,
          bodyText: draft.bodyText,
        }),
        ...(reply?.threadId ? { threadId: reply.threadId } : {}),
      },
    });
    if (!sent.data.id) throw new Error("gmail_send_failed");
    gmailMessageId = sent.data.id;
  } catch (error) {
    await prisma.draft.updateMany({
      where: {
        id: draft.id,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        mailboxId: input.mailboxId,
        status: "SENT",
      },
      data: { status: "APPROVED", sentAt: null },
    });
    throw error;
  }
  await writeAuditLog({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    mailboxId: input.mailboxId,
    actorId: input.userId,
    action: "SEND",
    resourceType: "draft",
    resourceId: draft.id,
    summary: `Sent email to ${draft.toAddresses.join(", ")}: ${draft.subject}`,
    metadata: {
      recipient: draft.toAddresses,
      subject: draft.subject,
      gmailMessageId,
      confirmed: true,
    },
  });
  return {
    recipient: draft.toAddresses[0] ?? "recipient",
    subject: draft.subject,
    gmailMessageId,
  };
}
