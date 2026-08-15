/**
 * Edge-safe session cookie helpers (no Prisma).
 * Full session validation against DB happens in server routes via auth.ts.
 */

export const SESSION_COOKIE = "inbox_chief_session";
export const MOCK_SESSION_PREFIX = "mock.";

export function hasSessionCookie(value: string | undefined | null): boolean {
  return Boolean(value && value.length >= 16);
}

export function isMockSessionToken(value: string): boolean {
  return value.startsWith(MOCK_SESSION_PREFIX);
}

/**
 * Mock cookies are only valid while MOCK_INTEGRATIONS=true.
 * After Neon/OAuth go live, stale `mock.*` cookies must not unlock the dashboard.
 */
export function isAcceptableSessionCookie(
  value: string | undefined | null,
): boolean {
  if (!hasSessionCookie(value) || !value) return false;
  if (isMockSessionToken(value) && process.env.MOCK_INTEGRATIONS !== "true") {
    return false;
  }
  return true;
}
