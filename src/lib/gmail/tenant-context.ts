/**
 * Re-export shared mailbox tenant resolver for Gmail route compatibility.
 */
export {
  resolveUserMailboxScope,
  resolveUserGmailScope,
} from "@/lib/mail/tenant-context";
