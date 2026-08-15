import {
  connectOutlookMailbox,
  syncOutlookMailbox,
  buildOutlookConsentUrl,
} from "@/lib/outlook/client";
import { OUTLOOK_OAUTH_SCOPES } from "@/lib/outlook/scopes";
import type {
  MailboxConnectInput,
  MailboxConnectResult,
  MailboxSyncInput,
  MailboxSyncResult,
  MailProvider,
} from "@/lib/mail/providers/types";

export const outlookProvider: MailProvider = {
  id: "outlook",
  capability: {
    id: "outlook",
    label: "Outlook / Microsoft 365",
    description:
      "Work or personal Microsoft accounts via OAuth + Graph. Read mail; send only after you approve.",
    authMode: "oauth",
    live: true,
    oauthCallbackPath: "/api/outlook/callback",
  },
  buildConsentUrl(state: string) {
    return buildOutlookConsentUrl(state);
  },
  async connect(input: MailboxConnectInput): Promise<MailboxConnectResult> {
    if (!input.authorizationCode) {
      return {
        ok: false,
        connectionStatus: "error",
        scopes: [...OUTLOOK_OAUTH_SCOPES],
        provider: "outlook",
        reason: "authorization_code_required",
      };
    }
    const result = await connectOutlookMailbox({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      mailboxId: input.mailboxId,
      authorizationCode: input.authorizationCode,
    });
    return {
      ...result,
      provider: "outlook",
      scopes: result.scopes?.length
        ? result.scopes
        : [...OUTLOOK_OAUTH_SCOPES],
    };
  },
  async sync(input: MailboxSyncInput): Promise<MailboxSyncResult> {
    const result = await syncOutlookMailbox(input);
    return { ...result, provider: "outlook" };
  },
};
