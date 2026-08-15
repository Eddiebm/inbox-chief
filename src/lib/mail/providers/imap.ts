import { connectImapMailbox, syncImapMailbox } from "@/lib/imap/client";
import { IMAP_PRESETS } from "@/lib/mail/providers/presets";
import type {
  ImapConnectInput,
  MailboxConnectResult,
  MailboxSyncInput,
  MailboxSyncResult,
  MailProvider,
  ProviderId,
} from "@/lib/mail/providers/types";

function makeImapFamilyProvider(
  id: Extract<ProviderId, "yahoo" | "icloud" | "imap">,
): MailProvider {
  const preset = IMAP_PRESETS[id];
  return {
    id,
    capability: {
      id,
      label: preset.label,
      description: preset.notes,
      authMode: "imap_app_password",
      // Connect + credential storage is live; header sync is Node+imapflow gated.
      live: true,
    },
    async connectImap(input: ImapConnectInput): Promise<MailboxConnectResult> {
      return connectImapMailbox({ ...input, provider: id });
    },
    async sync(input: MailboxSyncInput): Promise<MailboxSyncResult> {
      return syncImapMailbox({ ...input, provider: id });
    },
  };
}

export const yahooProvider = makeImapFamilyProvider("yahoo");
export const icloudProvider = makeImapFamilyProvider("icloud");
export const imapProvider = makeImapFamilyProvider("imap");
