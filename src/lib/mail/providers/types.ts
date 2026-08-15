/**
 * Provider-agnostic mailbox contract.
 * Gmail and Outlook are first-class OAuth; Yahoo/iCloud/Other use IMAP+SMTP.
 * NEVER auto-send — send only after explicit human approval.
 */

export const PROVIDER_IDS = [
  "gmail",
  "outlook",
  "yahoo",
  "icloud",
  "imap",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

export type MailboxAuthMode = "oauth" | "imap_app_password";

export type ProviderCapability = {
  id: ProviderId;
  label: string;
  description: string;
  authMode: MailboxAuthMode;
  /** True when connect + light sync are implemented end-to-end */
  live: boolean;
  /** OAuth redirect path when authMode is oauth */
  oauthCallbackPath?: string;
};

export type MailboxConnectInput = {
  organizationId: string;
  workspaceId: string;
  userId: string;
  mailboxId?: string;
  /** OAuth authorization code (Gmail / Outlook) */
  authorizationCode?: string;
};

export type MailboxSyncInput = {
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  userId: string;
  maxResults?: number;
};

export type MailboxConnectResult = {
  ok: boolean;
  stub?: boolean;
  connectionStatus: "connected" | "disconnected" | "error";
  scopes: string[];
  mailboxId?: string;
  emailAddress?: string;
  provider: ProviderId;
  reason?: string;
};

export type MailboxSyncResult = {
  ok: boolean;
  stub?: boolean;
  fetched: number;
  provider: ProviderId;
  reason?: string;
};

export type ImapConnectInput = {
  organizationId: string;
  workspaceId: string;
  userId: string;
  mailboxId?: string;
  provider: "yahoo" | "icloud" | "imap";
  emailAddress: string;
  /** App password or account password — encrypted at rest */
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure?: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure?: boolean;
};

/**
 * Provider adapter surface.
 * Implementations must never send mail from connect/sync.
 */
export type MailProvider = {
  id: ProviderId;
  capability: ProviderCapability;
  /** Build OAuth consent URL when authMode is oauth */
  buildConsentUrl?(state: string): string;
  connect?(input: MailboxConnectInput): Promise<MailboxConnectResult>;
  sync?(input: MailboxSyncInput): Promise<MailboxSyncResult>;
  connectImap?(input: ImapConnectInput): Promise<MailboxConnectResult>;
};
