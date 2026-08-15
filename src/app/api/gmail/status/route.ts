import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import { resolveUserGmailScope } from "@/lib/gmail/tenant-context";
import { GMAIL_OAUTH_SCOPES, gmailClientMayAutoSend } from "@/lib/gmail/scopes";

/**
 * Connection status for Settings Gmail panel (tenant-scoped).
 */
export async function GET() {
  const config = getGmailOAuthConfig();
  const user = await getCurrentUser();

  if (!user || user.id === "mock_user") {
    return NextResponse.json({
      ok: true,
      connected: false,
      connectionStatus: "disconnected",
      scopes: [...GMAIL_OAUTH_SCOPES],
      autoSendEnabled: gmailClientMayAutoSend(),
      oauthConfigured: config.ok,
      reason: user ? "mock_session" : "authentication_required",
      message: user
        ? "Sign in with a persisted account to manage Gmail."
        : "Sign in to view Gmail connection status.",
    });
  }

  if (!config.ok) {
    return NextResponse.json({
      ok: true,
      connected: false,
      connectionStatus: "disconnected",
      scopes: [...GMAIL_OAUTH_SCOPES],
      autoSendEnabled: gmailClientMayAutoSend(),
      oauthConfigured: false,
      reason: config.reason,
      message: config.message,
    });
  }

  const scope = await resolveUserGmailScope(user.id);
  if (!scope) {
    return NextResponse.json({
      ok: true,
      connected: false,
      connectionStatus: "disconnected",
      scopes: [...GMAIL_OAUTH_SCOPES],
      autoSendEnabled: gmailClientMayAutoSend(),
      oauthConfigured: true,
      reason: "mailbox_scope_unavailable",
      message: "No workspace with mailbox access was found for your account.",
    });
  }

  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();
  const mailbox = await prisma.mailbox.findFirst({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      ownerId: user.id,
      provider: "gmail",
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      emailAddress: true,
      connectionStatus: true,
      lastSyncedAt: true,
      oauthToken: {
        select: {
          id: true,
          organizationId: true,
          workspaceId: true,
          mailboxId: true,
          scopes: true,
        },
      },
    },
  });

  const connected =
    mailbox?.connectionStatus === "connected" && Boolean(mailbox.oauthToken);

  return NextResponse.json({
    ok: true,
    connected,
    connectionStatus: mailbox?.connectionStatus ?? "disconnected",
    emailAddress: mailbox?.emailAddress ?? null,
    mailboxId: mailbox?.id ?? null,
    lastSyncedAt: mailbox?.lastSyncedAt?.toISOString() ?? null,
    scopes: mailbox?.oauthToken?.scopes?.length
      ? mailbox.oauthToken.scopes
      : [...GMAIL_OAUTH_SCOPES],
    autoSendEnabled: gmailClientMayAutoSend(),
    oauthConfigured: true,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
  });
}
