import { describe, expect, it } from "vitest";
import {
  CALL_IN_SPEECH_RATES,
  DEFAULT_CALL_IN_SPEECH_RATE,
  adjustSpeechRate,
  applySpeechRateToVoice,
  cartesiaSpeedForRate,
  dbSpeechRate,
  detectSpeechRateCommand,
  elevenLabsSpeedForRate,
  fromDbSpeechRate,
  parseSpeechRateCommandArg,
  speakSpeechRateChange,
} from "@/lib/call-in/speech-rate";
import { STANDARD_VOICE, PREMIUM_VOICE } from "@/lib/call-in/voice-tiers";
import { handleCallInTool } from "@/lib/call-in/vapi-tools";
import { demoMailboxSnapshot } from "@/lib/call-in/assistant";

describe("call-in speech rate", () => {
  it("defaults to a modestly-faster brisk rate", () => {
    expect(DEFAULT_CALL_IN_SPEECH_RATE).toBe("brisk");
    // Brisk is faster than normal on both providers.
    expect(cartesiaSpeedForRate("brisk")).toBeGreaterThan(
      cartesiaSpeedForRate("normal"),
    );
    expect(elevenLabsSpeedForRate("brisk")).toBeGreaterThan(1);
    expect(elevenLabsSpeedForRate("brisk")).toBeGreaterThanOrEqual(1.15);
  });

  it("keeps ElevenLabs speed inside the VAPI 0.7–1.2 range", () => {
    for (const rate of CALL_IN_SPEECH_RATES) {
      const s = elevenLabsSpeedForRate(rate);
      expect(s).toBeGreaterThanOrEqual(0.7);
      expect(s).toBeLessThanOrEqual(1.2);
    }
  });

  it("keeps Cartesia speed inside the -1..1 range and ordered", () => {
    const order = CALL_IN_SPEECH_RATES.map(cartesiaSpeedForRate);
    for (const s of order) {
      expect(s).toBeGreaterThanOrEqual(-1);
      expect(s).toBeLessThanOrEqual(1);
    }
    // slow < normal < brisk < fast
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("parses explicit command args", () => {
    expect(parseSpeechRateCommandArg("faster")).toBe("faster");
    expect(parseSpeechRateCommandArg("speed up")).toBe("faster");
    expect(parseSpeechRateCommandArg("slower")).toBe("slower");
    expect(parseSpeechRateCommandArg("slow down")).toBe("slower");
    expect(parseSpeechRateCommandArg("normal")).toBe("normal");
    expect(parseSpeechRateCommandArg("reset")).toBe("normal");
    expect(parseSpeechRateCommandArg("banana")).toBeNull();
  });

  it("detects natural speed phrases and ignores unrelated speech", () => {
    expect(detectSpeechRateCommand("can you read faster please")).toBe(
      "faster",
    );
    expect(detectSpeechRateCommand("that's too slow")).toBe("faster");
    expect(detectSpeechRateCommand("slow down a bit")).toBe("slower");
    expect(detectSpeechRateCommand("you're going too fast")).toBe("slower");
    expect(detectSpeechRateCommand("go back to normal speed")).toBe("normal");
    expect(detectSpeechRateCommand("reset the speed")).toBe("normal");
    // Unrelated requests must not be treated as speed commands.
    expect(detectSpeechRateCommand("read my emails")).toBeNull();
    expect(detectSpeechRateCommand("what needs attention")).toBeNull();
    expect(detectSpeechRateCommand("normal")).toBeNull();
  });

  it("steps one level and clamps at the ends", () => {
    expect(adjustSpeechRate("brisk", "faster")).toBe("fast");
    expect(adjustSpeechRate("fast", "faster")).toBe("fast"); // clamp
    expect(adjustSpeechRate("brisk", "slower")).toBe("normal");
    expect(adjustSpeechRate("normal", "slower")).toBe("slow");
    expect(adjustSpeechRate("slow", "slower")).toBe("slow"); // clamp
    expect(adjustSpeechRate("fast", "normal")).toBe("normal");
  });

  it("applies rate to Cartesia and ElevenLabs voices only", () => {
    const std = applySpeechRateToVoice(STANDARD_VOICE.vapi, "fast");
    expect(std.experimentalControls?.speed).toBe(cartesiaSpeedForRate("fast"));
    expect(std.speed).toBeUndefined();

    const prem = applySpeechRateToVoice(PREMIUM_VOICE.vapi, "brisk");
    expect(prem.speed).toBe(elevenLabsSpeedForRate("brisk"));
  });

  it("maps rates to/from the DB enum", () => {
    expect(dbSpeechRate("brisk")).toBe("BRISK");
    expect(fromDbSpeechRate("FAST")).toBe("fast");
    expect(fromDbSpeechRate(null)).toBe(DEFAULT_CALL_IN_SPEECH_RATE);
    expect(fromDbSpeechRate("nonsense")).toBe(DEFAULT_CALL_IN_SPEECH_RATE);
  });

  it("confirmations are honest about persistence and clamping", () => {
    expect(speakSpeechRateChange("brisk", "fast", "faster")).toMatch(/saved/i);
    expect(speakSpeechRateChange("fast", "fast", "faster")).toMatch(
      /already/i,
    );
    expect(speakSpeechRateChange("slow", "slow", "slower")).toMatch(/already/i);
    expect(speakSpeechRateChange("fast", "normal", "normal")).toMatch(
      /normal/i,
    );
  });

  it("set_speech_speed tool responds without sending mail (no-DB safe)", async () => {
    const res = await handleCallInTool({
      name: "set_speech_speed",
      args: { command: "faster" },
      snapshot: demoMailboxSnapshot("Jordan"),
      requestedById: null,
      callId: null,
    });
    expect(res.intent).toBe("speech_rate");
    expect(res.emailSent).toBe(false);
    expect(res.spoken.toLowerCase()).toContain("faster");
  });

  it("routes a spoken 'read faster' through ask_inbox to speed control", async () => {
    const res = await handleCallInTool({
      name: "ask_inbox",
      args: { question: "please read a little faster" },
      snapshot: demoMailboxSnapshot("Jordan"),
      requestedById: null,
      callId: null,
    });
    expect(res.intent).toBe("speech_rate");
    expect(res.emailSent).toBe(false);
  });
});
