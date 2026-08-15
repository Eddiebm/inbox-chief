/**
 * Patron-facing mailbox / OAuth connect errors.
 * Never expose env var names, Cloud Console paths, or operator jargon.
 */
export function humanizeMailboxConnectReason(reason: string): string {
  const key = reason.trim().toLowerCase();

  switch (key) {
    case "access_denied":
      return (
        "Your Google account isn’t enabled for Inbox Chief yet. Contact support " +
        "and we’ll turn it on — then try Connect Gmail again."
      );
    case "redirect_uri_mismatch":
    case "google_credentials_missing":
    case "gmail_not_configured":
    case "mock_integrations_enabled":
    case "invalid_client":
    case "token_exchange_failed":
      return (
        "Inbox Chief isn’t ready to connect Gmail yet. Please contact support."
      );
    case "authentication_required":
      return "Sign in to Inbox Chief before connecting a mailbox.";
    case "mock_session":
      return (
        "This browser still has a demo session. Sign out, then sign in with your " +
        "real Inbox Chief account before connecting Gmail."
      );
    case "mailbox_scope_unavailable":
      return (
        "We couldn’t find a mailbox workspace for your account. Finish signup, then try again."
      );
    case "missing_code_or_state":
      return "Google returned an incomplete response. Close extra tabs and try Connect Gmail again.";
    case "callback_failed":
    case "connect_failed":
      return (
        "Mailbox connect didn’t finish. Try Connect Gmail again. " +
        "If it still fails, contact support."
      );
    default:
      return "Mailbox connection failed. You can try again.";
  }
}
