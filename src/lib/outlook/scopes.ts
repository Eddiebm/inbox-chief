/**
 * Microsoft Graph mail scopes — least privilege.
 * Mail.Send is for human-approved sends only. NEVER auto-send.
 */

import { assertNeverAutoSend, mailClientMayAutoSend } from "@/lib/mail/never-send";

export const OUTLOOK_MAIL_READ_SCOPE = "Mail.Read" as const;
export const OUTLOOK_MAIL_SEND_SCOPE = "Mail.Send" as const;
export const OUTLOOK_OFFLINE_ACCESS = "offline_access" as const;
export const OUTLOOK_OPENID = "openid" as const;
export const OUTLOOK_PROFILE = "profile" as const;
export const OUTLOOK_EMAIL = "email" as const;

export const OUTLOOK_OAUTH_SCOPES = [
  OUTLOOK_OPENID,
  OUTLOOK_PROFILE,
  OUTLOOK_EMAIL,
  OUTLOOK_OFFLINE_ACCESS,
  OUTLOOK_MAIL_READ_SCOPE,
  OUTLOOK_MAIL_SEND_SCOPE,
] as const;

export type OutlookOAuthScope = (typeof OUTLOOK_OAUTH_SCOPES)[number];

export const OUTLOOK_AUTO_SEND_ENABLED = false as const;

/** Graph operations allowed during mailbox sync. SendMail is intentionally absent. */
export const OUTLOOK_SYNC_ALLOWED_OPERATIONS = [
  "GET /me",
  "GET /me/messages",
] as const;

export function outlookClientMayAutoSend(): false {
  return OUTLOOK_AUTO_SEND_ENABLED;
}

export function assertOutlookSyncOperationsSafe(
  operations: readonly string[] = OUTLOOK_SYNC_ALLOWED_OPERATIONS,
): void {
  assertNeverAutoSend(operations);
  if (mailClientMayAutoSend()) {
    throw new Error("Never auto-send: MAIL_AUTO_SEND_ENABLED must stay false");
  }
  for (const op of operations) {
    const lower = op.toLowerCase();
    if (lower.includes("sendmail") || lower.includes("mail.send")) {
      throw new Error(`Never auto-send: sync operation not allowed: ${op}`);
    }
  }
}
