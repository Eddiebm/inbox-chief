import { isPrimaryInboxMessage } from "@/lib/call-in/primary-inbox";
import { getNodePrisma } from "@/lib/db-node";
import { createApprovedVoiceDraft, sendApprovedDraft } from "@/lib/email-send";
import { isGmailAuthFailure, GMAIL_NEEDS_RECONNECT_SPOKEN } from "@/lib/gmail/auth-errors";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import { GMAIL_SEND_SCOPE } from "@/lib/gmail/scopes";
import { getDecryptedMailboxTokensForTenant } from "@/lib/gmail/tokens";
import { searchEuropePmc } from "@/lib/research/publications";
import { completeWithProvider, configuredProviders } from "@/lib/research/providers";
import { PrismaResearchStore } from "@/lib/research/store-prisma";
import type { DeliveryResult, TurnDeps } from "@/lib/research/turn-types";
import type { ResearchScope } from "@/lib/research/types";
import { google } from "googleapis";

const store = new PrismaResearchStore();

export function researchStore(): PrismaResearchStore {
  return store;
}

export function createResearchDeps(scope: ResearchScope): TurnDeps {
  return {
    now: new Date(),
    store,
    configured: configuredProviders(),
    complete: completeWithProvider,
    searchPublications: (query) => searchEuropePmc(query),
    deliverEmail: (input) => deliverOwnerEmail(scope, input),
    readRecentMail: () => readRecentPrimary(scope),
    prepareDraft: (input) => prepareOwnerDraft(scope, input),
    reviseDraft: (input) => reviseOwnerDraft(scope, input),
    sendDraft: (input) => sendOwnerDraft(scope, input),
    appOrigin: process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://inboxchief.email",
    timeZone: process.env.RESEARCH_TIMEZONE || "America/Chicago",
  };
}

async function deliverOwnerEmail(scope: ResearchScope, input: { to: string; subject: string; body: string }): Promise<DeliveryResult> {
  if (!scope.mailboxId) return { outcome: "not_connected", code: "mailbox_missing" };
  try {
    const prisma = getNodePrisma();
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: scope.mailboxId, organizationId: scope.organizationId, workspaceId: scope.workspaceId, ownerId: scope.userId },
      select: { emailAddress: true, connectionStatus: true },
    });
    if (!mailbox || mailbox.connectionStatus === "error" || mailbox.connectionStatus === "disconnected") {
      return { outcome: "not_connected", code: "gmail_reconnect" };
    }
    const tokens = await getDecryptedMailboxTokensForTenant({
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: scope.mailboxId,
      userId: scope.userId,
    });
    if (!tokens || !tokens.scopes.includes(GMAIL_SEND_SCOPE)) {
      return { outcome: "not_connected", code: "gmail_reconnect" };
    }
    const config = getGmailOAuthConfig();
    if (!config.ok) return { outcome: "not_connected", code: "gmail_reconnect" };
    const auth = new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
    auth.setCredentials({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken, expiry_date: tokens.expiresAt?.getTime() });
    const gmail = google.gmail({ version: "v1", auth });
    const sent = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encodeMime({ from: mailbox.emailAddress, to: input.to, subject: input.subject, bodyText: input.body }) },
    });
    if (!sent.data.id) return { outcome: "unknown", code: "email_unknown" };
    return { outcome: "provider_accepted", providerMessageId: sent.data.id };
  } catch (error) {
    if (isGmailAuthFailure(error)) return { outcome: "not_connected", code: "gmail_reconnect" };
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("timeout") || message.includes("network") || message.includes("fetch")) {
      return { outcome: "unknown", code: "email_unknown" };
    }
    return { outcome: "failed", code: "provider_down" };
  }
}

function encodeMime(input: { from: string; to: string; subject: string; bodyText: string }): string {
  const mime = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject.replace(/[\r\n]+/g, " ")}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.bodyText,
  ].join("\r\n");
  return Buffer.from(mime).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function readRecentPrimary(scope: ResearchScope): Promise<{ messages: Array<{ id: string; from: string; subject: string; snippet: string; receivedAt: string }>; reconnect: boolean }> {
  if (!scope.mailboxId) return { messages: [], reconnect: true };
  const prisma = getNodePrisma();
  const mailbox = await prisma.mailbox.findFirst({
    where: { id: scope.mailboxId, organizationId: scope.organizationId, workspaceId: scope.workspaceId, ownerId: scope.userId },
    select: { connectionStatus: true },
  });
  const reconnect = !mailbox || mailbox.connectionStatus !== "connected";
  const rows = await prisma.message.findMany({
    where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, mailboxId: scope.mailboxId },
    orderBy: { receivedAt: "desc" },
    take: 20,
  });
  const messages = rows.filter((row) => isPrimaryInboxMessage(row)).slice(0, 5).map((row) => ({
    id: row.id,
    from: row.fromAddress,
    subject: row.subject,
    snippet: row.snippet || row.bodyText?.slice(0, 280) || "No preview is stored.",
    receivedAt: row.receivedAt.toISOString(),
  }));
  return { messages, reconnect };
}

async function prepareOwnerDraft(scope: ResearchScope, input: { recipient: string; subject: string; body: string }) {
  if (!scope.mailboxId) return { ok: false as const, spoken: GMAIL_NEEDS_RECONNECT_SPOKEN, code: "mailbox_missing" };
  const prepared = await createApprovedVoiceDraft({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    mailboxId: scope.mailboxId,
    userId: scope.userId,
    recipient: input.recipient,
    subject: input.subject,
    bodyText: input.body,
  });
  if (!prepared.ok) return { ok: false as const, spoken: prepared.spoken };
  return { ok: true as const, draftId: prepared.draftId, spoken: prepared.spoken };
}

async function reviseOwnerDraft(scope: ResearchScope, input: { draftId: string; body: string }) {
  if (!scope.mailboxId) return { ok: false as const, spoken: "No mailbox is connected. Nothing was sent." };
  const updated = await getNodePrisma().draft.updateMany({
    where: {
      id: input.draftId,
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: scope.mailboxId,
      status: "AWAITING_APPROVAL",
    },
    data: { bodyText: input.body },
  });
  if (updated.count !== 1) return { ok: false as const, spoken: "I could not change that draft. Nothing was sent." };
  return { ok: true as const };
}

async function sendOwnerDraft(scope: ResearchScope, input: { draftId: string; confirmed: boolean }) {
  if (!input.confirmed) return { ok: false as const, spoken: "Send confirmation is required. Nothing was sent.", code: "needs_confirmation" };
  if (!scope.mailboxId) return { ok: false as const, spoken: GMAIL_NEEDS_RECONNECT_SPOKEN, code: "gmail_reconnect" };
  try {
    const sent = await sendApprovedDraft({
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: scope.mailboxId,
      userId: scope.userId,
      draftId: input.draftId,
      confirmed: true,
      approveNow: true,
    });
    return { ok: true as const, providerMessageId: sent.gmailMessageId, spoken: `Sent to ${sent.recipient}. Subject ${sent.subject}.` };
  } catch (error) {
    if (isGmailAuthFailure(error) || (error instanceof Error && error.message === "gmail_send_scope_required")) {
      return { ok: false as const, spoken: GMAIL_NEEDS_RECONNECT_SPOKEN, code: "gmail_reconnect" };
    }
    return { ok: false as const, spoken: "The send did not complete. Nothing new was confirmed. Check the draft before trying again.", code: "provider_down" };
  }
}
