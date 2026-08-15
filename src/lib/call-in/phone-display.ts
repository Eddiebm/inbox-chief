/** Pretty US display for E.164 numbers like +14057169240 → +1 (405) 716-9240 */
export function formatCallInDisplay(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (m) return `+1 (${m[1]}) ${m[2]}-${m[3]}`;
  return e164;
}

export function publicCallInNumber(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_VAPI_CALL_IN_NUMBER ??
    process.env.NEXT_PUBLIC_TWILIO_CALL_IN_NUMBER ??
    null;
  const trimmed = raw?.trim();
  return trimmed || null;
}

/** Spoken last-four confirmation — digits only, never a CNAM name. */
export function speakPhoneLastFour(phoneE164: string): string {
  const digits = phoneE164.replace(/\D/g, "");
  const last4 = digits.slice(-4);
  if (last4.length < 4) return "";
  return `I recognize the phone ending in ${last4.split("").join(" ")}.`;
}
