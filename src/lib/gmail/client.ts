/**
 * Gmail integration.
 *
 * OAuth scopes (request only when the user connects a mailbox):
 * - gmail.readonly — sync & categorize
 * - gmail.send — send ONLY after human approval
 *
 * NEVER auto-send. Draft generation and sync must not call send APIs.
 */

import { google } from "googleapis";
import { encryptSecret } from "@/lib/crypto/token-encryption";
import { categoryNameFromGmailLabels } from "@/lib/call-in/primary-inbox";
import { extractGmailAttachmentMeta } from "@/lib/gmail/attachments";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import {
  assertSyncOperationsSafe,
  GMAIL_OAUTH_SCOPES,
  GMAIL_SYNC_ALLOWED_OPERATIONS,
  gmailClientMayAutoSend,
} from "@/lib/gmail/scopes";
import { getDecryptedMailboxTokensForTenant } from "@/lib/gmail/tokens";
import { writeAuditLog } from "@/lib/audit";

export type MailboxConnectInput = {
  organizationId: string;
  workspaceId: string;
  userId: string;
  mailboxId?: string;
  /** Authorization code from Google OAuth redirect */
  authorizationCode: string;
};

export type MailboxSyncInput = {
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  userId: string;
  /** Max messages to fetch on a light sync */
  maxResults?: number;
};

export type GmailConnectResult = {
  ok: boolean;
  stub?: boolean;
  connectionStatus: "connected" | "disconnected" | "error";
  scopes: string[];
  mailboxId?: string;
  emailAddress?: string;
  reason?: string;
};

export type GmailSyncResult = {
  ok: boolean;
  stub?: boolean;
  fetched: number;
  reason?: string;
};

export { GMAIL_OAUTH_SCOPES as REQUIRED_SCOPES };

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

export function buildGmailConsentUrl(state: string): string {
  const client = oauth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [...GMAIL_OAUTH_SCOPES],
    state,
    include_granted_scopes: false,
  });
}

function headerValue(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  name: string,
): string {
  const found = headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase(),
  );
  return found?.value?.trim() ?? "";
}

function parseAddressList(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

const MAX_SYNCED_BODY_CHARS = 4000;

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

function decodeGmailBodyData(data: string | null | undefined): string {
  if (!data) return "";
  try {
    const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Prefer text/plain; fall back to stripped HTML. Truncate for DB + TTS. */
export function extractGmailPlainText(
  payload: GmailPayloadPart | null | undefined,
): string | null {
  if (!payload) return null;

  const plainChunks: string[] = [];
  const htmlChunks: string[] = [];

  const walk = (part: GmailPayloadPart | null | undefined) => {
    if (!part) return;
    const mime = (part.mimeType ?? "").toLowerCase();
    const decoded = decodeGmailBodyData(part.body?.data);
    if (decoded) {
      if (mime === "text/plain") plainChunks.push(decoded);
      else if (mime === "text/html") htmlChunks.push(decoded);
      else if (!mime.startsWith("multipart/") && !part.parts?.length) {
        plainChunks.push(decoded);
      }
    }
    for (const child of part.parts ?? []) walk(child);
  };

  walk(payload);

  const plain = plainChunks.join("\n").replace(/\s+/g, " ").trim();
  if (plain) {
    return plain.length > MAX_SYNCED_BODY_CHARS
      ? `${plain.slice(0, MAX_SYNCED_BODY_CHARS)}…`
      : plain;
  }

  const html = stripHtmlToText(htmlChunks.join(" "));
  if (!html) return null;
  return html.length > MAX_SYNCED_BODY_CHARS
    ? `${html.slice(0, MAX_SYNCED_BODY_CHARS)}…`
    : html;
}

/**
 * Exchange OAuth code and store encrypted tokens for the mailbox.
 * Tokens must be scoped to organizationId + workspaceId + mailboxId.
 */
export async function connectMailbox(
  input: MailboxConnectInput,
): Promise<GmailConnectResult> {
  const config = getGmailOAuthConfig();
  if (!config.ok) {
    return {
      ok: false,
      connectionStatus: "disconnected",
      scopes: [...GMAIL_OAUTH_SCOPES],
      reason: config.reason,
    };
  }

  if (!input.organizationId || !input.workspaceId || !input.userId) {
    return {
      ok: false,
      connectionStatus: "error",
      scopes: [...GMAIL_OAUTH_SCOPES],
      reason: "tenant_scope_required",
    };
  }

  // Connect never sends mail.
  if (gmailClientMayAutoSend()) {
    throw new Error("Never auto-send: GMAIL_AUTO_SEND_ENABLED must stay false");
  }

  const client = oauth2Client();
  const { tokens } = await client.getToken(input.authorizationCode);
  const accessToken = tokens.access_token;
  if (!accessToken) {
    return {
      ok: false,
      connectionStatus: "error",
      scopes: [...GMAIL_OAUTH_SCOPES],
      reason: "token_exchange_failed",
    };
  }

  client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const emailAddress = profile.data.emailAddress?.toLowerCase().trim();
  if (!emailAddress) {
    return {
      ok: false,
      connectionStatus: "error",
      scopes: [...GMAIL_OAUTH_SCOPES],
      reason: "profile_email_missing",
    };
  }

  const grantedScopes = (tokens.scope ?? GMAIL_OAUTH_SCOPES.join(" "))
    .split(/\s+/)
    .filter(Boolean);

  const refreshToken = tokens.refresh_token;
  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();

  const mailbox = await prisma.$transaction(async (tx) => {
    const existing = input.mailboxId
      ? await tx.mailbox.findFirst({
          where: {
            id: input.mailboxId,
            organizationId: input.organizationId,
            workspaceId: input.workspaceId,
          },
        })
      : await tx.mailbox.findFirst({
          where: {
            organizationId: input.organizationId,
            workspaceId: input.workspaceId,
            emailAddress,
          },
        });

    const nextMailbox =
      existing ??
      (await tx.mailbox.create({
        data: {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          ownerId: input.userId,
          createdById: input.userId,
          emailAddress,
          displayName: emailAddress,
          provider: "gmail",
          connectionStatus: "connected",
        },
      }));

    if (existing) {
      await tx.mailbox.update({
        where: { id: existing.id },
        data: {
          connectionStatus: "connected",
          emailAddress,
          displayName: existing.displayName ?? emailAddress,
        },
      });
    }

    const priorToken = await tx.mailboxOAuthToken.findFirst({
      where: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        mailboxId: nextMailbox.id,
      },
    });

    const refreshTokenEnc = refreshToken
      ? encryptSecret(refreshToken)
      : priorToken?.refreshTokenEnc;

    if (!refreshTokenEnc) {
      throw new Error(
        "Google did not return a refresh token. Revoke prior access and reconnect with prompt=consent.",
      );
    }

    await tx.mailboxOAuthToken.upsert({
      where: { mailboxId: nextMailbox.id },
      create: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        mailboxId: nextMailbox.id,
        accessTokenEnc: encryptSecret(accessToken),
        refreshTokenEnc,
        expiresAt: tokens.expiry_date
          ? new Date(tokens.expiry_date)
          : null,
        scopes: grantedScopes,
      },
      update: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        accessTokenEnc: encryptSecret(accessToken),
        refreshTokenEnc,
        expiresAt: tokens.expiry_date
          ? new Date(tokens.expiry_date)
          : null,
        scopes: grantedScopes,
      },
    });

    return nextMailbox;
  });

  await writeAuditLog({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    mailboxId: mailbox.id,
    actorId: input.userId,
    action: "MANAGE_INTEGRATION",
    summary: `Connected Gmail mailbox ${emailAddress}`,
    resourceType: "mailbox",
    resourceId: mailbox.id,
  });

  return {
    ok: true,
    connectionStatus: "connected",
    scopes: grantedScopes,
    mailboxId: mailbox.id,
    emailAddress,
  };
}

/**
 * Incremental sync of message metadata into tenant-scoped Message rows.
 * Does not send mail. Does not mark messages read in Gmail.
 */
export async function syncMailbox(
  input: MailboxSyncInput,
): Promise<GmailSyncResult> {
  assertSyncOperationsSafe(GMAIL_SYNC_ALLOWED_OPERATIONS);

  if (!input.organizationId || !input.workspaceId || !input.mailboxId) {
    return {
      ok: false,
      fetched: 0,
      reason: "tenant_scope_required",
    };
  }

  const config = getGmailOAuthConfig();
  if (!config.ok) {
    return {
      ok: false,
      fetched: 0,
      reason: config.reason,
    };
  }

  const decrypted = await getDecryptedMailboxTokensForTenant({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    mailboxId: input.mailboxId,
    userId: input.userId,
  });

  if (!decrypted?.refreshToken && !decrypted?.accessToken) {
    return {
      ok: false,
      fetched: 0,
      reason: "mailbox_token_missing",
    };
  }

  const client = oauth2Client();
  client.setCredentials({
    access_token: decrypted.accessToken,
    refresh_token: decrypted.refreshToken,
    expiry_date: decrypted.expiresAt?.getTime(),
  });

  // Persist refreshed access tokens when Google rotates them.
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
  const maxResults = Math.min(Math.max(input.maxResults ?? 25, 1), 50);

  const listed = await gmail.users.messages.list({
    userId: "me",
    maxResults,
  });

  const messageRefs = listed.data.messages ?? [];
  let fetched = 0;

  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();

  for (const ref of messageRefs) {
    if (!ref.id) continue;

    // Full message for readable body/snippet on call-in — never send.
    const full = await gmail.users.messages.get({
      userId: "me",
      id: ref.id,
      format: "full",
    });

    const headers = full.data.payload?.headers ?? [];
    const fromAddress = headerValue(headers, "From") || "unknown";
    const toAddresses = parseAddressList(headerValue(headers, "To"));
    const subject = headerValue(headers, "Subject") || "(no subject)";
    const receivedAt = full.data.internalDate
      ? new Date(Number(full.data.internalDate))
      : new Date();
    const payload = full.data.payload as GmailPayloadPart | undefined;
    const bodyText = extractGmailPlainText(payload);
    // Metadata only during sync — bytes fetched on demand when reading aloud
    const attachments = extractGmailAttachmentMeta(payload);
    const labelIds = full.data.labelIds ?? [];
    const isRead = !labelIds.includes("UNREAD");
    // Unread → needs attention for call-in / inbox triage defaults
    const needsAttention = !isRead;
    // Gmail tabs: PRIMARY / PROMOTIONS / SOCIAL / UPDATES / FORUMS / SPAM
    const categoryName = categoryNameFromGmailLabels(labelIds);

    const messageMetadata = {
      labelIds,
      historyId: full.data.historyId ?? null,
      attachments,
      categoryName,
    };

    await prisma.message.upsert({
      where: {
        mailboxId_gmailId: {
          mailboxId: input.mailboxId,
          gmailId: ref.id,
        },
      },
      create: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        mailboxId: input.mailboxId,
        gmailId: ref.id,
        threadId: full.data.threadId ?? ref.threadId ?? null,
        fromAddress,
        toAddresses,
        subject,
        snippet: full.data.snippet ?? null,
        bodyText,
        receivedAt,
        categoryName,
        isRead,
        needsAttention,
        metadata: messageMetadata,
      },
      update: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        threadId: full.data.threadId ?? ref.threadId ?? null,
        fromAddress,
        toAddresses,
        subject,
        snippet: full.data.snippet ?? null,
        ...(bodyText ? { bodyText } : {}),
        receivedAt,
        categoryName,
        isRead,
        needsAttention,
        metadata: messageMetadata,
      },
    });
    fetched += 1;
  }

  const profile = await gmail.users.getProfile({ userId: "me" });

  await prisma.mailbox.updateMany({
    where: {
      id: input.mailboxId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
    },
    data: {
      lastSyncedAt: new Date(),
      connectionStatus: "connected",
      ...(profile.data.historyId
        ? { gmailHistoryId: String(profile.data.historyId) }
        : {}),
    },
  });

  await writeAuditLog({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    mailboxId: input.mailboxId,
    actorId: input.userId,
    action: "SYSTEM",
    summary: `Synced ${fetched} Gmail message(s) (headers + body + attachment metadata for voice; never auto-send)`,
    resourceType: "mailbox",
    resourceId: input.mailboxId,
    metadata: { fetched, operations: [...GMAIL_SYNC_ALLOWED_OPERATIONS] },
  });

  return { ok: true, fetched };
}
