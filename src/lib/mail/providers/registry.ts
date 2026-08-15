import { gmailProvider } from "@/lib/mail/providers/gmail";
import {
  icloudProvider,
  imapProvider,
  yahooProvider,
} from "@/lib/mail/providers/imap";
import { outlookProvider } from "@/lib/mail/providers/outlook";
import type {
  MailProvider,
  ProviderCapability,
  ProviderId,
} from "@/lib/mail/providers/types";
import { isProviderId } from "@/lib/mail/providers/types";

const PROVIDERS: Record<ProviderId, MailProvider> = {
  gmail: gmailProvider,
  outlook: outlookProvider,
  yahoo: yahooProvider,
  icloud: icloudProvider,
  imap: imapProvider,
};

export function listMailProviders(): MailProvider[] {
  return Object.values(PROVIDERS);
}

export function listProviderCapabilities(): ProviderCapability[] {
  return listMailProviders().map((p) => p.capability);
}

export function getMailProvider(id: ProviderId | string): MailProvider | null {
  if (!isProviderId(id)) return null;
  return PROVIDERS[id];
}

export function requireMailProvider(id: ProviderId | string): MailProvider {
  const provider = getMailProvider(id);
  if (!provider) {
    throw new Error(`Unknown mail provider: ${id}`);
  }
  return provider;
}
