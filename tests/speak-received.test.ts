import { describe, expect, it } from "vitest";
import {
  formatReadableEmailForSpeech,
  speakReadableEmails,
  EMPTY_PRIMARY_SPOKEN,
  demoMailboxSnapshot,
} from "@/lib/call-in/assistant";
import {
  FALLBACK_SPEECH_TIME_ZONE,
  resolveSpeechTimeZone,
  speakReceivedAt,
} from "@/lib/call-in/speak-received";

describe("speakReceivedAt", () => {
  const received = "2026-08-12T15:41:00-05:00";
  const nowSameDay = new Date("2026-08-12T18:00:00-05:00");
  const nowNextDay = new Date("2026-08-13T09:00:00-05:00");

  it("speaks weekday, month, day, year, and clock time in US Central", () => {
    const spoken = speakReceivedAt(received, "America/Chicago", nowNextDay);
    expect(spoken).toMatch(/Received/i);
    expect(spoken).toMatch(/Wednesday/i);
    expect(spoken).toMatch(/August 12/i);
    expect(spoken).toMatch(/2026/);
    expect(spoken).toMatch(/3:41/i);
    expect(spoken).toMatch(/\bPM\b/i);
    expect(spoken).not.toMatch(/today/i);
  });

  it("adds today when the calendar day matches", () => {
    const spoken = speakReceivedAt(received, "America/Chicago", nowSameDay);
    expect(spoken).toMatch(/Received today, Wednesday, August 12, 2026, at 3:41/i);
  });

  it("adds yesterday when the previous calendar day matches", () => {
    const spoken = speakReceivedAt(received, "America/Chicago", nowNextDay);
    expect(spoken).toMatch(/Received yesterday, Wednesday, August 12, 2026, at 3:41/i);
  });

  it("never invents a date when receivedAt is missing or invalid", () => {
    expect(speakReceivedAt(null)).toBe("");
    expect(speakReceivedAt(undefined)).toBe("");
    expect(speakReceivedAt("not-a-date")).toBe("");
  });

  it("falls back to US Central for unknown time zones", () => {
    expect(resolveSpeechTimeZone(null)).toBe(FALLBACK_SPEECH_TIME_ZONE);
    expect(resolveSpeechTimeZone("Not/AZone")).toBe(FALLBACK_SPEECH_TIME_ZONE);
    const spoken = speakReceivedAt(received, "Not/AZone", nowNextDay);
    expect(spoken).toMatch(/3:41/i);
  });
});

describe("email speech includes received timestamp", () => {
  it("formatReadableEmailForSpeech includes From, Subject, Received, then body", () => {
    const snap = demoMailboxSnapshot("Alex");
    const line = formatReadableEmailForSpeech(snap.readableEmails[0]!, 1, 3, {
      timeZone: "America/Chicago",
    });
    expect(line).toMatch(/From Jordan Lee/i);
    expect(line).toMatch(/Subject: Schedule confirmation/i);
    expect(line).toMatch(/Received/i);
    expect(line).toMatch(/Wednesday, August 12, 2026/i);
    expect(line).toMatch(/3:41/i);
    expect(line).toMatch(/Message:/i);
    const receivedIdx = line.indexOf("Received");
    const messageIdx = line.indexOf("Message:");
    expect(receivedIdx).toBeGreaterThan(0);
    expect(messageIdx).toBeGreaterThan(receivedIdx);
  });

  it("omits Received when the message has no timestamp", () => {
    const line = formatReadableEmailForSpeech(
      {
        fromAddress: "a@b.com",
        subject: "Hi",
        readableText: "Hello",
        contentSource: "body",
      },
      1,
      1,
    );
    expect(line).toMatch(/From a@b.com/i);
    expect(line).not.toMatch(/Received/i);
    expect(line).toMatch(/Message: Hello/i);
  });

  it("read-my-emails speech includes received time for demo mail", () => {
    const snap = demoMailboxSnapshot("Alex");
    const spoken = speakReadableEmails(snap.readableEmails, {
      timeZone: "America/Chicago",
    });
    expect(spoken).toMatch(/Received/i);
    expect(spoken).toMatch(/August 12, 2026/i);
    expect(spoken).toMatch(/3:41/i);
  });

  it("empty primary mailbox uses the empty speech, never demo dates", () => {
    const spoken = speakReadableEmails([]);
    expect(spoken).toContain(EMPTY_PRIMARY_SPOKEN);
    expect(spoken).not.toMatch(/Jordan Lee|August 12|Schedule confirmation/i);
  });
});
