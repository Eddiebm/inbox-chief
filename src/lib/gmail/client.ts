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
import {
  triggerOutboundEmailAlert,
  type NewMailForOutboundAlert,
} from "@/lib/call-in/outbound-email-alert";
import { categoryNameFromGmailLabels } from "@/lib/call-in/primary-inbox";
import { extractGmailAttachmentMeta } from "@/lib/gmail/attachments";
import {
  isGmailAuthFailure,
  markMailboxNeedsReconnect,
} from "@/lib/gmail/auth-errors";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import {
  assertSyncOperationsSafe,
  GMAIL_OAUTH_SCOPES,
  GMAIL_SYNC_ALLOWED_OPERATIONS,
  gmailClientMayAutoSend,
} from "@/lib/gmail/scopes";
import { getDecryptedMailboxTokensForTenant } from "@/lib/gmail/tokens";
import { writeAuditLog } from "@/lib/audit";
import { parseMailboxAddress } from "@/lib/contacts";

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
  /**
   * How deep to keep the mailbox synced (Primary pass + inbox pass).
   * Defaults to GMAIL_SYNC_DEFAULT_DEPTH; already-stored messages are skipped.
   */
  maxResults?: number;
  /** Call-in/web reads may refresh mail without initiating a second phone call. */
  suppressOutboundAlert?: boolean;
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
  /** Messages already stored and skipped (no Gmail body re-download) */
  skippedExisting?: number;
  outboundEmailAlert?: {
    called: boolean;
    newPrimaryCount: number;
    reason?: string;
  };
  reason?: string;
};

/** Default number of recent messages to keep synced per mailbox. */
export const GMAIL_SYNC_DEFAULT_DEPTH = 60;
export const GMAIL_SYNC_MAX_DEPTH = 200;
/** Gmail list page size (API max is 500; keep pages small for latency). */
const GMAIL_LIST_PAGE_SIZE = 50;
/** Parallel `messages.get` calls per batch. */
const GMAIL_FETCH_CONCURRENCY = 5;

/**
 * Gmail search that isolates the Primary tab. Negating the other category
 * labels also works for mailboxes that never enabled tabs, where
 * `category:primary` returns nothing.
 */
export const GMAIL_PRIMARY_QUERY =
  "in:inbox -category:promotions -category:social -category:updates -category:forums";
/** Whole inbox (still excludes sent, drafts, archived, spam and trash). */
export const GMAIL_INBOX_QUERY = "in:inbox";

export type GmailSyncPass = { q: string; target: number };

/**
 * Primary first, then the rest of the inbox.
 *
 * A newsletter-heavy mailbox can push every Primary message out of a plain
 * "newest N" window, which is why Primary gets its own guaranteed pass.
 */
export function buildGmailSyncPasses(depth: number): GmailSyncPass[] {
  const total = Math.min(Math.max(Math.floor(depth) || 0, 1), GMAIL_SYNC_MAX_DEPTH);
  return [
    { q: GMAIL_PRIMARY_QUERY, target: total },
    { q: GMAIL_INBOX_QUERY, target: total },
  ];
}

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

/**
 * Bodies are read aloud in full across several spoken turns, so this only
 * guards pathological messages (huge auto-generated dumps), not normal mail.
 */
export const MAX_SYNCED_BODY_CHARS = 40_000;

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
 * Fetch one message's plain-text body straight from Gmail (readonly).
 *
 * Used when a call-in read needs the whole body and the synced row only has a
 * snippet or a truncated body. Returns null when Gmail or tokens are missing.
 */
export async function fetchGmailMessageBodyText(input: {
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  userId: string;
  gmailMessageId: string;
}): Promise<string | null> {
  assertSyncOperationsSafe(GMAIL_SYNC_ALLOWED_OPERATIONS);

  const config = getGmailOAuthConfig();
  if (!config.ok) return null;

  const decrypted = await getDecryptedMailboxTokensForTenant({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    mailboxId: input.mailboxId,
    userId: input.userId,
  });
  if (!decrypted?.refreshToken && !decrypted?.accessToken) return null;

  const client = oauth2Client();
  client.setCredentials({
    access_token: decrypted.accessToken,
    refresh_token: decrypted.refreshToken,
    expiry_date: decrypted.expiresAt?.getTime(),
  });

  const gmail = google.gmail({ version: "v1", auth: client });
  const full = await gmail.users.messages.get({
    userId: "me",
    id: input.gmailMessageId,
    format: "full",
  });
  return extractGmailPlainText(full.data.payload as GmailPayloadPart | undefined);
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

  try {
    const gmail = google.gmail({ version: "v1", auth: client });
    const depth = Math.min(
      Math.max(input.maxResults ?? GMAIL_SYNC_DEFAULT_DEPTH, 1),
      GMAIL_SYNC_MAX_DEPTH,
    );

    const { getNodePrisma } = await import("@/lib/db-node");
    const prisma = getNodePrisma();

    // Primary tab first, then the rest of the inbox, both paginated.
    const messageIds: string[] = [];
    const seen = new Set<string>();
    for (const pass of buildGmailSyncPasses(depth)) {
      let pageToken: string | undefined;
      let collected = 0;
      do {
        const listed = await gmail.users.messages.list({
          userId: "me",
          q: pass.q,
          maxResults: Math.min(GMAIL_LIST_PAGE_SIZE, pass.target - collected),
          ...(pageToken ? { pageToken } : {}),
        });
        for (const ref of listed.data.messages ?? []) {
          if (!ref.id || seen.has(ref.id)) continue;
          seen.add(ref.id);
          messageIds.push(ref.id);
        }
        collected += (listed.data.messages ?? []).length;
        pageToken = listed.data.nextPageToken ?? undefined;
      } while (pageToken && collected < pass.target);
    }

    // Track truly new rows separately from rows whose body was previously absent.
    const knownMessages = await prisma.message.findMany({
      where: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        mailboxId: input.mailboxId,
        gmailId: { in: messageIds },
      },
      select: { gmailId: true },
    });
    const knownIds = new Set(knownMessages.map((row) => row.gmailId));

    // Bodies never change, so only download messages we have not stored yet.
    const alreadyStored = await prisma.message.findMany({
      where: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        mailboxId: input.mailboxId,
        gmailId: { in: messageIds },
        bodyText: { not: null },
      },
      select: { gmailId: true },
    });
    const storedIds = new Set(alreadyStored.map((row) => row.gmailId));
    const toFetch = messageIds.filter((id) => !storedIds.has(id));

    let fetched = 0;
    const newMessages: NewMailForOutboundAlert[] = [];

    for (let i = 0; i < toFetch.length; i += GMAIL_FETCH_CONCURRENCY) {
      const batch = toFetch.slice(i, i + GMAIL_FETCH_CONCURRENCY);
      const rows = await Promise.all(
        batch.map(async (id) => {
          // Full message for readable body/snippet on call-in — never send.
          const full = await gmail.users.messages.get({
            userId: "me",
            id,
            format: "full",
          });
          return { id, full };
        }),
      );

      for (const { id, full } of rows) {
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
        // Unread → needs attention for inbox triage; reads walk all of Primary.
        const needsAttention = !isRead;
        // Gmail tabs: PRIMARY / PROMOTIONS / SOCIAL / UPDATES / FORUMS / SPAM
        const categoryName = categoryNameFromGmailLabels(labelIds);

        const messageMetadata = {
          labelIds,
          historyId: full.data.historyId ?? null,
          attachments,
          categoryName,
        };
        if (!knownIds.has(id)) {
          newMessages.push({
            fromAddress,
            subject,
            snippet: full.data.snippet ?? null,
            bodyText,
            categoryName,
            metadata: messageMetadata,
            receivedAt,
          });
        }

        await prisma.message.upsert({
          where: {
            mailboxId_gmailId: {
              mailboxId: input.mailboxId,
              gmailId: id,
            },
          },
          create: {
            organizationId: input.organizationId,
            workspaceId: input.workspaceId,
            mailboxId: input.mailboxId,
            gmailId: id,
            threadId: full.data.threadId ?? null,
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
            threadId: full.data.threadId ?? null,
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
        const contact = parseMailboxAddress(fromAddress);
        if (contact) {
          await prisma.contact.upsert({
            where: {
              mailboxId_email: {
                mailboxId: input.mailboxId,
                email: contact.email,
              },
            },
            create: {
              organizationId: input.organizationId,
              workspaceId: input.workspaceId,
              mailboxId: input.mailboxId,
              email: contact.email,
              displayName: contact.displayName,
              lastSeenAt: receivedAt,
            },
            update: {
              organizationId: input.organizationId,
              workspaceId: input.workspaceId,
              ...(contact.displayName ? { displayName: contact.displayName } : {}),
              messageCount: { increment: 1 },
              lastSeenAt: receivedAt,
            },
          });
        }
        fetched += 1;
      }
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

    let outboundEmailAlert: GmailSyncResult["outboundEmailAlert"];
    if (!input.suppressOutboundAlert) {
      try {
        const alert = await triggerOutboundEmailAlert({
          prisma,
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          mailboxId: input.mailboxId,
          userId: input.userId,
          mailboxConnected: true,
          newMessages,
        });
        outboundEmailAlert = {
          called: alert.called,
          newPrimaryCount: alert.newPrimaryCount,
          ...(!alert.called ? { reason: alert.reason } : {}),
        };
      } catch (alertError) {
        console.error("[gmail-sync] outbound email alert failed", alertError);
      }
    }

    await writeAuditLog({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      mailboxId: input.mailboxId,
      actorId: input.userId,
      action: "SYSTEM",
      summary: `Synced ${fetched} new Gmail message(s) of ${messageIds.length} recent Primary/inbox message(s) (headers + body + attachment metadata for voice; never auto-send)`,
      resourceType: "mailbox",
      resourceId: input.mailboxId,
      metadata: {
        fetched,
        listed: messageIds.length,
        skippedExisting: storedIds.size,
        operations: [...GMAIL_SYNC_ALLOWED_OPERATIONS],
      },
    });

    return {
      ok: true,
      fetched,
      skippedExisting: storedIds.size,
      ...(outboundEmailAlert ? { outboundEmailAlert } : {}),
    };
  } catch (error) {
    if (isGmailAuthFailure(error)) {
      await markMailboxNeedsReconnect({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        mailboxId: input.mailboxId,
      });
      return {
        ok: false,
        fetched: 0,
        reason: "needs_reconnect",
      };
    }
    throw error;
  }
}
