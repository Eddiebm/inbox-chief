/**
 * Shared secret handling for production hardening.
 *
 * Two rules drive everything here:
 * - A missing secret must never be read as "auth disabled" in production.
 * - Secrets are compared in constant time so a webhook cannot be brute forced
 *   one byte at a time.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** The placeholder shipped for local development. Never valid in production. */
export const DEV_PLACEHOLDER_SECRET = "dev-only-change-me";

/**
 * True when this process is serving real patrons. Mock mode is a local-only
 * escape hatch and deliberately keeps the relaxed development behaviour.
 */
export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" && env.MOCK_INTEGRATIONS !== "true";
}

export function isPlaceholderSecret(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  return !trimmed || trimmed === DEV_PLACEHOLDER_SECRET;
}

/**
 * Constant-time secret comparison. Both sides are hashed first so unequal
 * lengths cannot throw and length itself does not leak.
 */
export function secretsMatch(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Stable pseudonym for correlating log lines about one caller without writing
 * their phone number to the log. Keyed by AUTH_SECRET so the short digest is
 * not reversible from a phone-number dictionary.
 */
export function redactIdentifier(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "none";
  const key =
    process.env.AUTH_SECRET?.trim() ||
    process.env.TOKEN_ENCRYPTION_KEY?.trim() ||
    DEV_PLACEHOLDER_SECRET;
  const digest = createHmac("sha256", key).update(trimmed).digest("hex");
  return `id_${digest.slice(0, 12)}`;
}

/** Last four digits only — enough for a support call, useless for reidentification alone. */
export function redactPhone(value: string | null | undefined): string {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length < 4) return redactIdentifier(value);
  return `***${digits.slice(-4)}`;
}
