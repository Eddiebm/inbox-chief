const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function zonedParts(date: Date, timeZone: string): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const bag = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    weekday: WEEKDAY_INDEX[bag.weekday ?? "Sun"] ?? 0,
  };
}

function zonedStartUtc(year: number, month: number, day: number, timeZone: string): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const utcLabel = new Date(utcGuess.toLocaleString("en-US", { timeZone: "UTC" }));
  const zoneLabel = new Date(utcGuess.toLocaleString("en-US", { timeZone }));
  const offset = utcLabel.getTime() - zoneLabel.getTime();
  return new Date(utcGuess.getTime() + offset);
}

function shiftCalendar(year: number, month: number, day: number, deltaDays: number): { year: number; month: number; day: number } {
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + deltaDays);
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

export function dateWindow(input: {
  when: "yesterday" | "last_weekday";
  weekday: number | null;
  now: Date;
  timeZone?: string;
}): { from: string; to: string } {
  const timeZone = input.timeZone ?? "America/Chicago";
  const today = zonedParts(input.now, timeZone);
  let delta = -1;
  if (input.when === "last_weekday") {
    const target = input.weekday ?? 0;
    delta = -((today.weekday - target + 7) % 7);
    if (delta === 0) delta = -7;
  }
  const day = shiftCalendar(today.year, today.month, today.day, delta);
  const start = zonedStartUtc(day.year, day.month, day.day, timeZone);
  const next = shiftCalendar(day.year, day.month, day.day, 1);
  const end = zonedStartUtc(next.year, next.month, next.day, timeZone);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function formatWhen(iso: string, timeZone = "America/Chicago"): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(iso));
}
