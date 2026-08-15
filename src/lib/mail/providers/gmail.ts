/**
 * Gmail as a MailProvider adapter — delegates to existing src/lib/gmail/* modules.
 * Existing /api/gmail/* routes remain the canonical OAuth entry points.
 */

import {
  buildGmailConsentUrl,
  connectMailbox as connectGmailMailbox,
  syncMailbox as syncGmailMailbox,
} from "@/lib/gmail/client";
import { GMAIL_OAUTH_SCOPES } from "@/lib/gmail/scopes";
import type {
  MailboxConnectInput,
  MailboxConnectResult,
  MailboxSyncInput,
  MailboxSyncResult,
  MailProvider,
} from "@/lib/mail/providers/types";

export const gmailProvider: MailProvider = {
  id: "gmail",
  capability: {
    id: "gmail",
    label: "Gmail",
    description:
      "Google Workspace or personal Gmail via OAuth. Read mail; send only after you approve.",
    authMode: "oauth",
    live: true,
    oauthCallbackPath: "/api/gmail/callback",
  },
  buildConsentUrl(state: string) {
    return buildGmailConsentUrl(state);
  },
  async connect(input: MailboxConnectInput): Promise<MailboxConnectResult> {
    if (!input.authorizationCode) {
      return {
        ok: false,
        connectionStatus: "error",
        scopes: [...GMAIL_OAUTH_SCOPES],
        provider: "gmail",
        reason: "authorization_code_required",
      };
    }
    const result = await connectGmailMailbox({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      mailboxId: input.mailboxId,
      authorizationCode: input.authorizationCode,
    });
    return {
      ...result,
      provider: "gmail",
      scopes: result.scopes?.length ? result.scopes : [...GMAIL_OAUTH_SCOPES],
    };
  },
  async sync(input: MailboxSyncInput): Promise<MailboxSyncResult> {
    const result = await syncGmailMailbox(input);
    return { ...result, provider: "gmail" };
  },
};
