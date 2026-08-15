/**
 * Outlook / Microsoft 365 mailbox integration via Microsoft Graph.
 *
 * OAuth scopes (request only when the user connects a mailbox):
 * - Mail.Read — sync & categorize
 * - Mail.Send — send ONLY after human approval
 *
 * NEVER auto-send. Draft generation and sync must not call sendMail.
 */

import { writeAuditLog } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto/token-encryption";
import { getDecryptedMailboxTokensForTenant } from "@/lib/gmail/tokens";
import { mailClientMayAutoSend } from "@/lib/mail/never-send";
import {
  getOutlookOAuthConfig,
  microsoftAuthorizeUrl,
  microsoftTokenUrl,
} from "@/lib/outlook/config";
import {
  assertOutlookSyncOperationsSafe,
  OUTLOOK_OAUTH_SCOPES,
  OUTLOOK_SYNC_ALLOWED_OPERATIONS,
} from "@/lib/outlook/scopes";

export type OutlookConnectInput = {
  organizationId: string;
  workspaceId: string;
  userId: string;
  mailboxId?: string;
  authorizationCode: string;
};

export type OutlookSyncInput = {
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  userId: string;
  maxResults?: number;
};

export type OutlookConnectResult = {
  ok: boolean;
  connectionStatus: "connected" | "disconnected" | "error";
  scopes: string[];
  mailboxId?: string;
  emailAddress?: string;
  reason?: string;
};

export type OutlookSyncResult = {
  ok: boolean;
  fetched: number;
  reason?: string;
};

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export function buildOutlookConsentUrl(state: string): string {
  const config = getOutlookOAuthConfig();
  if (!config.ok) {
    throw new Error(config.reason);
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    response_mode: "query",
    scope: OUTLOOK_OAUTH_SCOPES.join(" "),
    state,
    prompt: "consent",
  });

  return `${microsoftAuthorizeUrl(config.tenantId)}?${params.toString()}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function exchangeCodeForTokens(
  authorizationCode: string,
): Promise<TokenResponse> {
  const config = getOutlookOAuthConfig();
  if (!config.ok) {
    throw new Error(config.reason);
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code: authorizationCode,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
    scope: OUTLOOK_OAUTH_SCOPES.join(" "),
  });

  const res = await fetch(microsoftTokenUrl(config.tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  return (await res.json()) as TokenResponse;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const config = getOutlookOAuthConfig();
  if (!config.ok) {
    throw new Error(config.reason);
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: OUTLOOK_OAUTH_SCOPES.join(" "),
  });

  const res = await fetch(microsoftTokenUrl(config.tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  return (await res.json()) as TokenResponse;
}

async function graphGet<T>(
  path: string,
  accessToken: string,
): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

type GraphUser = {
  mail?: string | null;
  userPrincipalName?: string | null;
  displayName?: string | null;
};

type GraphMessage = {
  id?: string;
  conversationId?: string | null;
  subject?: string | null;
  bodyPreview?: string | null;
  receivedDateTime?: string | null;
  isRead?: boolean;
  from?: { emailAddress?: { address?: string | null; name?: string | null } };
  toRecipients?: Array<{
    emailAddress?: { address?: string | null };
  }>;
};

type GraphMessageList = {
  value?: GraphMessage[];
  "@odata.nextLink"?: string;
};

/**
 * Exchange OAuth code and store encrypted tokens for the mailbox.
 * Tokens must be scoped to organizationId + workspaceId + mailboxId.
 */
export async function connectOutlookMailbox(
  input: OutlookConnectInput,
): Promise<OutlookConnectResult> {
  const config = getOutlookOAuthConfig();
  if (!config.ok) {
    return {
      ok: false,
      connectionStatus: "disconnected",
      scopes: [...OUTLOOK_OAUTH_SCOPES],
      reason: config.reason,
    };
  }

  if (!input.organizationId || !input.workspaceId || !input.userId) {
    return {
      ok: false,
      connectionStatus: "error",
      scopes: [...OUTLOOK_OAUTH_SCOPES],
      reason: "tenant_scope_required",
    };
  }

  if (mailClientMayAutoSend()) {
    throw new Error("Never auto-send: MAIL_AUTO_SEND_ENABLED must stay false");
  }

  const tokens = await exchangeCodeForTokens(input.authorizationCode);
  const accessToken = tokens.access_token;
  if (!accessToken) {
    return {
      ok: false,
      connectionStatus: "error",
      scopes: [...OUTLOOK_OAUTH_SCOPES],
      reason: tokens.error ?? "token_exchange_failed",
    };
  }

  const me = await graphGet<GraphUser>("/me", accessToken);
  const emailAddress = (
    me.mail ||
    me.userPrincipalName ||
    ""
  )
    .toLowerCase()
    .trim();
  if (!emailAddress) {
    return {
      ok: false,
      connectionStatus: "error",
      scopes: [...OUTLOOK_OAUTH_SCOPES],
      reason: "profile_email_missing",
    };
  }

  const grantedScopes = (tokens.scope ?? OUTLOOK_OAUTH_SCOPES.join(" "))
    .split(/\s+/)
    .filter(Boolean);

  const refreshToken = tokens.refresh_token;
  const expiresAt =
    typeof tokens.expires_in === "number"
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

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
          displayName: me.displayName ?? emailAddress,
          provider: "outlook",
          connectionStatus: "connected",
        },
      }));

    if (existing) {
      await tx.mailbox.update({
        where: { id: existing.id },
        data: {
          connectionStatus: "connected",
          provider: "outlook",
          emailAddress,
          displayName: existing.displayName ?? me.displayName ?? emailAddress,
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
        "Microsoft did not return a refresh token. Ensure offline_access is requested and reconnect with prompt=consent.",
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
        expiresAt,
        scopes: grantedScopes,
      },
      update: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        accessTokenEnc: encryptSecret(accessToken),
        refreshTokenEnc,
        expiresAt,
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
    summary: `Connected Outlook mailbox ${emailAddress}`,
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
 * Light metadata sync via Graph into tenant-scoped Message rows.
 * Does not send mail. Does not mark messages read in Outlook.
 * Message.gmailId stores the provider external id (Graph message id).
 */
export async function syncOutlookMailbox(
  input: OutlookSyncInput,
): Promise<OutlookSyncResult> {
  assertOutlookSyncOperationsSafe(OUTLOOK_SYNC_ALLOWED_OPERATIONS);

  if (!input.organizationId || !input.workspaceId || !input.mailboxId) {
    return {
      ok: false,
      fetched: 0,
      reason: "tenant_scope_required",
    };
  }

  const config = getOutlookOAuthConfig();
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

  let accessToken = decrypted.accessToken;
  const needsRefresh =
    !accessToken ||
    (decrypted.expiresAt && decrypted.expiresAt.getTime() < Date.now() + 60_000);

  if (needsRefresh && decrypted.refreshToken) {
    const refreshed = await refreshAccessToken(decrypted.refreshToken);
    if (!refreshed.access_token) {
      return {
        ok: false,
        fetched: 0,
        reason: refreshed.error ?? "token_refresh_failed",
      };
    }
    accessToken = refreshed.access_token;
    const { getNodePrisma } = await import("@/lib/db-node");
    const prisma = getNodePrisma();
    await prisma.mailboxOAuthToken.updateMany({
      where: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        mailboxId: input.mailboxId,
      },
      data: {
        accessTokenEnc: encryptSecret(refreshed.access_token),
        ...(typeof refreshed.expires_in === "number"
          ? {
              expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
            }
          : {}),
        ...(refreshed.refresh_token
          ? { refreshTokenEnc: encryptSecret(refreshed.refresh_token) }
          : {}),
      },
    });
  }

  const maxResults = Math.min(Math.max(input.maxResults ?? 25, 1), 50);
  const listed = await graphGet<GraphMessageList>(
    `/me/messages?$top=${maxResults}&$select=id,conversationId,subject,bodyPreview,receivedDateTime,isRead,from,toRecipients&$orderby=receivedDateTime desc`,
    accessToken,
  );

  const messages = listed.value ?? [];
  let fetched = 0;

  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();

  for (const msg of messages) {
    if (!msg.id) continue;

    const fromAddress =
      msg.from?.emailAddress?.address?.trim() ||
      msg.from?.emailAddress?.name?.trim() ||
      "unknown";
    const toAddresses = (msg.toRecipients ?? [])
      .map((r) => r.emailAddress?.address?.trim())
      .filter((a): a is string => Boolean(a));
    const subject = msg.subject?.trim() || "(no subject)";
    const receivedAt = msg.receivedDateTime
      ? new Date(msg.receivedDateTime)
      : new Date();
    const externalId = `outlook:${msg.id}`;

    await prisma.message.upsert({
      where: {
        mailboxId_gmailId: {
          mailboxId: input.mailboxId,
          gmailId: externalId,
        },
      },
      create: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        mailboxId: input.mailboxId,
        gmailId: externalId,
        threadId: msg.conversationId ?? null,
        fromAddress,
        toAddresses,
        subject,
        snippet: msg.bodyPreview ?? null,
        receivedAt,
        isRead: Boolean(msg.isRead),
        metadata: {
          provider: "outlook",
          graphMessageId: msg.id,
        },
      },
      update: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        threadId: msg.conversationId ?? null,
        fromAddress,
        toAddresses,
        subject,
        snippet: msg.bodyPreview ?? null,
        receivedAt,
        isRead: Boolean(msg.isRead),
        metadata: {
          provider: "outlook",
          graphMessageId: msg.id,
        },
      },
    });
    fetched += 1;
  }

  await prisma.mailbox.updateMany({
    where: {
      id: input.mailboxId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
    },
    data: {
      lastSyncedAt: new Date(),
      connectionStatus: "connected",
      syncCursor: messages[0]?.id ?? undefined,
    },
  });

  await writeAuditLog({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    mailboxId: input.mailboxId,
    actorId: input.userId,
    action: "SYSTEM",
    summary: `Synced ${fetched} Outlook message(s) (metadata only; never auto-send)`,
    resourceType: "mailbox",
    resourceId: input.mailboxId,
    metadata: { fetched, operations: [...OUTLOOK_SYNC_ALLOWED_OPERATIONS] },
  });

  return { ok: true, fetched };
}
