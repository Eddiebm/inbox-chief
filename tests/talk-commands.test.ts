import { describe, expect, it } from "vitest";
import {
  preferTalkHearing,
  talkCommand,
  talkInterrupt,
  talkSendDecision,
} from "@/lib/voice/talk-commands";

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
    expect(talkCommand("find papers")).toBeNull();
    expect(talkCommand("find original papers on retinal repair")).toBeNull();
    expect(talkCommand("email this to me")).toBeNull();
  });

  it("accepts short inexact controls", () => {
    expect(talkCommand("next one")).toBe("next");
    expect(talkCommand("go next")).toBe("next");
    expect(talkCommand("the next email")).toBe("next");
    expect(talkCommand("next message")).toBe("next");
    expect(talkCommand("uh next")).toBe("next");
    expect(talkCommand("next please")).toBe("next");
    expect(talkCommand("can you go next")).toBe("next");
    expect(talkCommand("previous one")).toBe("previous");
    expect(talkCommand("the previous email")).toBe("previous");
    expect(talkCommand("read it again")).toBe("repeat");
    expect(talkCommand("say that again")).toBe("repeat");
    expect(talkCommand("say that again please")).toBe("repeat");
    expect(talkCommand("slow down")).toBe("slower");
    expect(talkCommand("please slow down")).toBe("slower");
    expect(talkCommand("speed up")).toBe("faster");
    expect(talkCommand("stop talking")).toBe("stop");
    expect(talkCommand("please stop talking")).toBe("stop");
    expect(talkCommand("stop reading this one")).toBe("next");
  });

  it("does not treat send phrases as playback", () => {
    expect(talkCommand("send it")).toBeNull();
    expect(talkCommand("don't send")).toBeNull();
    expect(talkCommand("yes")).toBeNull();
  });
});

describe("talkSendDecision", () => {
  it("confirms only an explicit send", () => {
    expect(talkSendDecision("send it")).toBe("confirm_send");
    expect(talkSendDecision("Send it.")).toBe("confirm_send");
    expect(talkSendDecision("please send it")).toBe("confirm_send");
    expect(talkSendDecision("yes, send it")).toBe("confirm_send");
    expect(talkSendDecision("yes send")).toBe("confirm_send");
    expect(talkSendDecision("don't send")).toBe("decline_send");
    expect(talkSendDecision("do not send it")).toBe("decline_send");
    expect(talkSendDecision("Yes")).toBeNull();
    expect(talkSendDecision("yeah")).toBeNull();
    expect(talkSendDecision("yes please")).toBeNull();
    expect(talkSendDecision("next")).toBeNull();
    expect(talkSendDecision("go next")).toBeNull();
    expect(talkSendDecision("the next email")).toBeNull();
    expect(talkSendDecision("Send a message to Jordan saying I will be late")).toBeNull();
  });
});

describe("preferTalkHearing", () => {
  it("keeps a low-confidence final when the words are one control", () => {
    expect(preferTalkHearing([{ transcript: "next", confidence: 0.12 }])).toBe("next");
    expect(preferTalkHearing([{ transcript: "the next email", confidence: 0 }])).toBe(
      "the next email",
    );
    expect(preferTalkHearing([{ transcript: "send it", confidence: 0.05 }])).toBe("send it");
    expect(preferTalkHearing([{ transcript: "don't send", confidence: 0.1 }])).toBe(
      "don't send",
    );
  });

  it("prefers one clear command when the top mishear is weak", () => {
    expect(
      preferTalkHearing([
        { transcript: "neck", confidence: 0.22 },
        { transcript: "next", confidence: 0.4 },
      ]),
    ).toBe("next");
  });

  it("does not promote send, research, or a second command from a guess", () => {
    expect(
      preferTalkHearing([
        { transcript: "yes", confidence: 0.2 },
        { transcript: "send it", confidence: 0.9 },
      ]),
    ).toBe("yes");
    expect(
      preferTalkHearing([
        { transcript: "find papers", confidence: 0.3 },
        { transcript: "next", confidence: 0.45 },
      ]),
    ).toBe("find papers");
    expect(
      preferTalkHearing([
        { transcript: "email this to me", confidence: 0.25 },
        { transcript: "send it", confidence: 0.8 },
      ]),
    ).toBe("email this to me");
    expect(
      preferTalkHearing([
        { transcript: "neck", confidence: 0.2 },
        { transcript: "next", confidence: 0.3 },
        { transcript: "previous", confidence: 0.3 },
      ]),
    ).toBe("neck");
    expect(
      preferTalkHearing([
        { transcript: "neck", confidence: 0 },
        { transcript: "next", confidence: 0.9 },
      ]),
    ).toBe("neck");
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

  it("accepts a slightly inexact control over the spoken email", () => {
    expect(talkInterrupt("go next", reading, 12)).toBe("next");
    expect(talkInterrupt("the next email", reading, 12)).toBe("next");
    expect(talkInterrupt("stop talking", reading, 12)).toBe("stop");
    expect(talkInterrupt("say that again", reading, 12)).toBe("repeat");
  });
});
