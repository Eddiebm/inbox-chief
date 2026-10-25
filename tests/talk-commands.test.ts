import { describe, expect, it } from "vitest";
import { talkCommand, talkInterrupt } from "@/lib/voice/talk-commands";

describe("talkCommand", () => {
  it("recognizes playback controls", () => {
    expect(talkCommand("Stop.")).toBe("stop");
    expect(talkCommand("say that again")).toBe("repeat");
    expect(talkCommand("slow down")).toBe("slower");
    expect(talkCommand("speed up")).toBe("faster");
    expect(talkCommand("normal speed")).toBe("normal");
  });

  it("recognizes mail movement controls", () => {
    expect(talkCommand("next")).toBe("next");
    expect(talkCommand("Next.")).toBe("next");
    expect(talkCommand("next email")).toBe("next");
    expect(talkCommand("skip this")).toBe("next");
    expect(talkCommand("move on")).toBe("next");
    expect(talkCommand("previous")).toBe("previous");
    expect(talkCommand("go back")).toBe("previous");
    expect(talkCommand("repeat")).toBe("repeat");
    expect(talkCommand("continue")).toBe("continue");
    expect(talkCommand("more")).toBe("continue");
  });

  it("leaves mail requests alone", () => {
    expect(talkCommand("Read my emails")).toBeNull();
    expect(talkCommand("What needs attention?")).toBeNull();
    expect(talkCommand("Read the next email")).toBeNull();
    expect(talkCommand("What is next on my calendar")).toBeNull();
  });
});

describe("talkInterrupt", () => {
  const reading =
    "Email 1 of 3. From Jordan. Subject: Thursday. Say next for email 2, or say continue to hear the rest.";

  it("accepts next while an earlier part of the email is playing", () => {
    expect(talkInterrupt("next", reading, 12)).toBe("next");
    expect(talkInterrupt("previous", reading, reading.indexOf("next"))).toBe("previous");
  });

  it("ignores next when that word is what is being spoken", () => {
    const atNext = reading.toLowerCase().indexOf("next");
    expect(talkInterrupt("next", reading, atNext)).toBeNull();
    expect(talkInterrupt("continue", reading, reading.toLowerCase().indexOf("continue"))).toBeNull();
  });

  it("still accepts next before word timing is known", () => {
    expect(talkInterrupt("next", reading, null)).toBe("next");
  });
});
