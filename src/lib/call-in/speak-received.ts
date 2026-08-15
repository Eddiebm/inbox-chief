/**
 * Speak a message received-at timestamp for call-in / Ask by voice.
 * Never invents a date — returns "" when receivedAt is missing or invalid.
 * Timezone: caller/user zone if valid, else US Central (America/Chicago).
 */

export const FALLBACK_SPEECH_TIME_ZONE = "America/Chicago";

export function resolveSpeechTimeZone(timeZone?: string | null): string {
  const tz = timeZone?.trim();
  if (!tz) return FALLBACK_SPEECH_TIME_ZONE;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return FALLBACK_SPEECH_TIME_ZONE;
  }
}

export function parseReceivedAt(
  receivedAt: Date | string | number | null | undefined,
): Date | null {
  if (receivedAt == null || receivedAt === "") return null;
  const date =
    receivedAt instanceof Date
      ? receivedAt
      : typeof receivedAt === "number"
        ? new Date(receivedAt)
        : new Date(receivedAt);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function calendarKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function relativeDayLabel(
  date: Date,
  now: Date,
  timeZone: string,
): "today" | "yesterday" | null {
  const receivedKey = calendarKey(date, timeZone);
  const todayKey = calendarKey(now, timeZone);
  if (receivedKey === todayKey) return "today";
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (receivedKey === calendarKey(yesterday, timeZone)) return "yesterday";
  return null;
}

/**
 * e.g. "Received Tuesday, August 12, 2026, at 3:41 PM"
 * Adds today/yesterday when it helps, always includes a real clock time.
 */
export function speakReceivedAt(
  receivedAt: Date | string | number | null | undefined,
  timeZone?: string | null,
  now = new Date(),
): string {
  const date = parseReceivedAt(receivedAt);
  if (!date) return "";

  const tz = resolveSpeechTimeZone(timeZone);
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: tz,
  }).format(date);
  const month = new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: tz,
  }).format(date);
  const day = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    timeZone: tz,
  }).format(date);
  const year = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    timeZone: tz,
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz,
  }).format(date);

  const relative = relativeDayLabel(date, now, tz);
  const relativeBit = relative ? `${relative}, ` : "";
  return `Received ${relativeBit}${weekday}, ${month} ${day}, ${year}, at ${time}`;
}
