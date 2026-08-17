/**
 * Twilio request validation for the fallback TwiML voice webhook.
 *
 * Twilio signs `HMAC-SHA1(authToken, url + sortedParamKeysAndValues)` and sends
 * it as `X-Twilio-Signature`. Without this check anyone can POST a `From`
 * number and have Inbox Chief read that patron's inbox back to them.
 *
 * https://www.twilio.com/docs/usage/security#validating-requests
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { isProductionRuntime } from "@/lib/security/secrets";

export type TwilioValidation =
  | { ok: true }
  | { ok: false; status: number; error: string };

export function isTwilioConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.TWILIO_AUTH_TOKEN?.trim());
}

/** Recreate the string Twilio signed and compare in constant time. */
export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(payload, "utf8").digest("base64");
}

function signatureMatches(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Candidate URLs to validate against. Behind Vercel's proxy `request.url` can
 * differ from the public URL Twilio actually called, so the configured public
 * base URL is checked too.
 */
function candidateUrls(requestUrl: string): string[] {
  const urls = new Set<string>([requestUrl]);
  const base =
    process.env.CALL_IN_PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (base) {
    try {
      const parsed = new URL(requestUrl);
      urls.add(
        new URL(
          `${parsed.pathname}${parsed.search}`,
          base.replace(/\/$/, ""),
        ).toString(),
      );
    } catch {
      /* requestUrl is always absolute in practice; ignore malformed input */
    }
  }
  return [...urls];
}

/**
 * Validate an inbound Twilio voice webhook.
 *
 * With no auth token configured the endpoint is locked in production rather
 * than left open: this path is a fallback behind VAPI, so refusing it is
 * strictly safer than serving unauthenticated mailbox reads.
 */
export function verifyTwilioRequest(input: {
  url: string;
  signature: string | null;
  params: Record<string, string>;
}): TwilioValidation {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();

  if (!authToken) {
    if (isProductionRuntime()) {
      return {
        ok: false,
        status: 403,
        error:
          "Twilio voice webhook is disabled — TWILIO_AUTH_TOKEN is not configured.",
      };
    }
    return { ok: true };
  }

  const provided = input.signature?.trim();
  if (!provided) {
    return { ok: false, status: 403, error: "Missing X-Twilio-Signature." };
  }

  for (const url of candidateUrls(input.url)) {
    const expected = computeTwilioSignature(authToken, url, input.params);
    if (signatureMatches(expected, provided)) return { ok: true };
  }

  return { ok: false, status: 403, error: "Invalid X-Twilio-Signature." };
}
