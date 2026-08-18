/** Screen-reader / spoken copy shared by Connect Gmail, onboarding, and settings. */

export function gmailConnectedSpoken(email: string | null | undefined): string {
  const trimmed = email?.trim();
  if (trimmed) {
    return `Gmail connected as ${trimmed}. Nothing sends without your approval.`;
  }
  return "Gmail connected. Nothing sends without your approval.";
}

/**
 * Render a URL so a caller can type it from speech alone.
 * "https://inboxchief.email/provision" -> "inboxchief dot email slash provision"
 */
export function speakUrlForVoice(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname
      .replace(/-/g, " dash ")
      .replace(/\./g, " dot ");
    const path = parsed.pathname.replace(/\/+$/, "").replace(/\//g, " slash ");
    return `${host}${path}`.replace(/\s+/g, " ").trim();
  } catch {
    return url;
  }
}

export function gmailNeedsReconnectSpoken(
  email: string | null | undefined,
): string {
  const trimmed = email?.trim();
  if (trimmed) {
    return `Gmail for ${trimmed} needs reconnecting. Tap Connect Gmail, approve access, then try again. Nothing sends without your approval.`;
  }
  return "Your mailbox needs reconnecting. Tap Connect Gmail, approve access, then try again. Nothing sends without your approval.";
}
