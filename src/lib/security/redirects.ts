/**
 * Same-origin redirect allowlisting for Stripe return URLs.
 *
 * Stripe will happily send a patron anywhere after checkout, so a
 * client-supplied `successUrl` is an open redirect (and a convincing phishing
 * hop straight off a real Inbox Chief checkout page).
 */

/** Origins we will ever redirect a patron back to. */
export function allowedRedirectOrigins(requestOrigin: string): string[] {
  const origins = new Set<string>();
  const add = (value: string | undefined | null) => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    try {
      origins.add(new URL(trimmed).origin);
    } catch {
      /* ignore malformed configuration */
    }
  };
  add(requestOrigin);
  add(process.env.NEXT_PUBLIC_APP_URL);
  add(process.env.CALL_IN_PUBLIC_BASE_URL);
  return [...origins];
}

/**
 * Return the URL only when it points at one of our own origins, otherwise
 * null. Relative paths are resolved against the request origin.
 */
export function sameOriginRedirect(
  candidate: string | undefined | null,
  requestOrigin: string,
): string | null {
  const raw = candidate?.trim();
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw, requestOrigin);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!allowedRedirectOrigins(requestOrigin).includes(parsed.origin)) {
    return null;
  }
  return parsed.toString();
}
