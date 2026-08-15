import { describe, expect, it } from "vitest";
import {
  describeSpeechSupport,
  SPEECH_SUPPORT_SERVER,
} from "@/lib/voice/speech";

describe("describeSpeechSupport snapshots", () => {
  it("returns a stable server snapshot reference", () => {
    expect(SPEECH_SUPPORT_SERVER).toEqual({
      synthesis: false,
      recognition: false,
    });
    expect(SPEECH_SUPPORT_SERVER).toBe(SPEECH_SUPPORT_SERVER);
  });

  it("returns referentially stable client snapshots for the same support flags", () => {
    const a = describeSpeechSupport();
    const b = describeSpeechSupport();
    expect(a).toBe(b);
    expect(a).toEqual({
      synthesis: false,
      recognition: false,
    });
  });
});
