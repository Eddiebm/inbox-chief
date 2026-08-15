import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";
import { listProviderCapabilities } from "@/lib/mail/providers/registry";
import { IMAP_PRESETS } from "@/lib/mail/providers/presets";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import { getOutlookOAuthConfig } from "@/lib/outlook/config";
import { mailClientMayAutoSend } from "@/lib/mail/never-send";

/**
 * Multi-provider mailbox status for the Settings connect panel.
 * Tenant-scoped; never exposes decrypted tokens/passwords.
 */
export async function GET() {
  const user = await getCurrentUser();
  const gmailConfig = getGmailOAuthConfig();
  const outlookConfig = getOutlookOAuthConfig();
  const providers = listProviderCapabilities();

  const base = {
    ok: true,
    autoSendEnabled: mailClientMayAutoSend(),
    providers,
    presets: IMAP_PRESETS,
    oauth: {
      gmail: gmailConfig.ok,
      outlook: outlookConfig.ok,
      gmailMessage: gmailConfig.ok
        ? null
        : "Inbox Chief isn’t ready to connect Gmail yet. Please contact support.",
      outlookMessage: outlookConfig.ok
        ? null
        : "Inbox Chief isn’t ready to connect Outlook yet. Please contact support.",
      gmailReason: gmailConfig.ok ? null : gmailConfig.reason,
      outlookReason: outlookConfig.ok ? null : outlookConfig.reason,
    },
  };

  if (!user || user.id === "mock_user") {
    return NextResponse.json({
      ...base,
      connected: false,
      mailboxes: [],
      reason: user ? "mock_session" : "authentication_required",
      message: user
        ? "Sign in with a persisted account to manage mailboxes."
        : "Sign in to view mailbox connection status.",
    });
  }

  const scope = await resolveUserMailboxScope(user.id);
  if (!scope) {
    return NextResponse.json({
      ...base,
      connected: false,
      mailboxes: [],
      reason: "mailbox_scope_unavailable",
      message: "No workspace with mailbox access was found for your account.",
    });
  }

  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();
  const mailboxes = await prisma.mailbox.findMany({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      ownerId: user.id,
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      emailAddress: true,
      provider: true,
      connectionStatus: true,
      lastSyncedAt: true,
      oauthToken: { select: { id: true } },
      imapCredentials: { select: { id: true, imapHost: true } },
    },
  });

  const connectedMailboxes = mailboxes
    .filter((m) => m.connectionStatus === "connected")
    .map((m) => ({
      id: m.id,
      emailAddress: m.emailAddress,
      provider: m.provider,
      connectionStatus: m.connectionStatus,
      lastSyncedAt: m.lastSyncedAt?.toISOString() ?? null,
      hasOAuth: Boolean(m.oauthToken),
      hasImap: Boolean(m.imapCredentials),
    }));

  return NextResponse.json({
    ...base,
    connected: connectedMailboxes.length > 0,
    mailboxes: connectedMailboxes,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
  });
}
