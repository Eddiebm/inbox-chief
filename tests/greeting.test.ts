import { describe, expect, it } from "vitest";
import {
  getGreetingPhrase,
  getPersonalizedGreeting,
  getTimeOfDay,
} from "@/lib/greeting";

describe("greeting", () => {
  it("maps hours to time of day", () => {
    expect(getTimeOfDay(new Date("2026-08-10T08:00:00"))).toBe("morning");
    expect(getTimeOfDay(new Date("2026-08-10T14:00:00"))).toBe("afternoon");
    expect(getTimeOfDay(new Date("2026-08-10T20:00:00"))).toBe("evening");
    expect(getTimeOfDay(new Date("2026-08-10T02:00:00"))).toBe("evening");
  });

  it("builds personalized greetings with fallback", () => {
    const morning = new Date("2026-08-10T09:30:00");
    expect(getGreetingPhrase(morning)).toBe("Good morning");
    expect(getPersonalizedGreeting("Alex", morning)).toBe("Good morning, Alex");
    expect(getPersonalizedGreeting("  ", morning)).toBe("Good morning, there");
    expect(getPersonalizedGreeting(null, morning)).toBe("Good morning, there");
  });
});
