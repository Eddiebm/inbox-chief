export type TimeOfDay = "morning" | "afternoon" | "evening";

/**
 * Returns morning / afternoon / evening based on local clock hours.
 * Morning: 5:00–11:59, afternoon: 12:00–16:59, evening: otherwise.
 */
export function getTimeOfDay(date: Date = new Date()): TimeOfDay {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  return "evening";
}

/** e.g. "Good morning" */
export function getGreetingPhrase(date: Date = new Date()): string {
  const period = getTimeOfDay(date);
  switch (period) {
    case "morning":
      return "Good morning";
    case "afternoon":
      return "Good afternoon";
    case "evening":
      return "Good evening";
    default: {
      const _exhaustive: never = period;
      return _exhaustive;
    }
  }
}

/**
 * Personalized greeting: “Good morning, Alex” (fallback name: “there”).
 */
export function getPersonalizedGreeting(
  firstName: string | null | undefined,
  date: Date = new Date(),
): string {
  const name = firstName?.trim() || "there";
  return `${getGreetingPhrase(date)}, ${name}`;
}
