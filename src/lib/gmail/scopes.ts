/**
 * Gmail OAuth scopes — least privilege.
 * gmail.send is for human-approved sends only. NEVER auto-send.
 */

import {
  assertNeverAutoSend as assertNeverAutoSendShared,
  MAIL_AUTO_SEND_ENABLED,
  mailClientMayAutoSend,
} from "@/lib/mail/never-send";

export const GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly" as const;
export const GMAIL_SEND_SCOPE =
  "https://www.googleapis.com/auth/gmail.send" as const;

export const GMAIL_OAUTH_SCOPES = [
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
] as const;

export type GmailOAuthScope = (typeof GMAIL_OAUTH_SCOPES)[number];

/** Hard product invariant — connect/sync/draft paths must never send mail. */
export const GMAIL_AUTO_SEND_ENABLED = MAIL_AUTO_SEND_ENABLED;

/** Operations allowed during mailbox sync. Send APIs are intentionally absent. */
export const GMAIL_SYNC_ALLOWED_OPERATIONS = [
  "users.getProfile",
  "users.messages.list",
  "users.messages.get",
] as const;

/**
 * On-demand attachment download for call-in TTS (readonly).
 * Never includes send. Sync path does not call these — only voice read enrichment.
 */
export const GMAIL_ATTACHMENT_ALLOWED_OPERATIONS = [
  "users.messages.get",
  "users.messages.attachments.get",
] as const;

export function gmailClientMayAutoSend(): false {
  return mailClientMayAutoSend();
}

/**
 * Guard used by sync + tests: reject any operation that would send mail.
 */
export function assertNeverAutoSend(operations: readonly string[]): void {
  assertNeverAutoSendShared(operations);
}

export function assertSyncOperationsSafe(
  operations: readonly string[] = GMAIL_SYNC_ALLOWED_OPERATIONS,
): void {
  assertNeverAutoSend(operations);
  for (const op of operations) {
    if (
      !(GMAIL_SYNC_ALLOWED_OPERATIONS as readonly string[]).includes(op) &&
      op.toLowerCase().includes("send")
    ) {
      throw new Error(`Never auto-send: sync operation not allowed: ${op}`);
    }
  }
}
