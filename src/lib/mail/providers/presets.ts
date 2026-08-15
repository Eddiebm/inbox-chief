import type { ProviderId } from "@/lib/mail/providers/types";

export type ImapPreset = {
  provider: Extract<ProviderId, "yahoo" | "icloud" | "imap">;
  label: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  /** Guidance shown in Settings (app passwords, etc.) */
  notes: string;
};

export const IMAP_PRESETS: Record<
  Extract<ProviderId, "yahoo" | "icloud" | "imap">,
  ImapPreset
> = {
  yahoo: {
    provider: "yahoo",
    label: "Yahoo Mail",
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 465,
    smtpSecure: true,
    notes:
      "Generate an app password in Yahoo Account Security. Regular account passwords are rejected when 2FA is on.",
  },
  icloud: {
    provider: "icloud",
    label: "iCloud Mail",
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    smtpSecure: true,
    notes:
      "Create an app-specific password at appleid.apple.com (Sign-In and Security → App-Specific Passwords).",
  },
  imap: {
    provider: "imap",
    label: "Other IMAP / SMTP",
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "",
    smtpPort: 465,
    smtpSecure: true,
    notes:
      "Enter your provider’s IMAP and SMTP hosts. Prefer an app password. Custom domains (Fastmail, Zoho, cPanel, etc.) work here.",
  },
};

export function getImapPreset(
  provider: Extract<ProviderId, "yahoo" | "icloud" | "imap">,
): ImapPreset {
  return IMAP_PRESETS[provider];
}
