/**
 * Call-in speech rate (how fast Inbox Chief reads on the phone).
 *
 * Accessibility rationale: blind and low-vision patrons vary a lot in the
 * pace they can comfortably follow. A modestly brisk default reads email
 * bodies faster than the old deliberately-slow setting (less waiting), while
 * spoken "slower" / "normal speed" always give control back for comprehension.
 *
 * Four ordered steps map to each TTS provider's own speed control:
 * - Cartesia (Standard) uses experimentalControls.speed as a number in
 *   [-1, 1] where 0 is normal and positive is faster.
 * - ElevenLabs (Premium) uses voice.speed as a number in [0.7, 1.2] where
 *   1.0 is normal (the VAPI Agents range).
 *
 * VAPI cannot reliably change a live call's voice mid-call, so the rate is
 * applied when each call's assistant is built and persisted so the next call
 * remembers it. A spoken command still updates the saved rate immediately and
 * attempts a best-effort live update.
 */

import type { VapiVoiceConfig } from "@/lib/call-in/voice-tiers";

/** Ordered slowest → fastest. */
export const CALL_IN_SPEECH_RATES = [
  "slow",
  "normal",
  "brisk",
  "fast",
] as const;

export type CallInSpeechRate = (typeof CALL_IN_SPEECH_RATES)[number];

/**
 * Default reading pace. Brisk is a modest ~1.15x on ElevenLabs and clearly
 * faster than "normal" on Cartesia — quicker than the old slow default without
 * hurting intelligibility. Patrons can always say "slower" or "normal speed".
 */
export const DEFAULT_CALL_IN_SPEECH_RATE: CallInSpeechRate = "brisk";

export type SpeechRateCommand = "faster" | "slower" | "normal";

/** Cartesia experimentalControls.speed numeric value: 0 = normal, + = faster. */
const CARTESIA_SPEED_BY_RATE: Record<CallInSpeechRate, number> = {
  slow: -0.3,
  normal: 0,
  brisk: 0.2,
  fast: 0.35,
};

/** ElevenLabs voice.speed: 1.0 = normal, VAPI clamps to [0.7, 1.2]. */
const ELEVENLABS_SPEED_BY_RATE: Record<CallInSpeechRate, number> = {
  slow: 0.85,
  normal: 1.0,
  brisk: 1.15,
  fast: 1.2,
};

export function cartesiaSpeedForRate(rate: CallInSpeechRate): number {
  return CARTESIA_SPEED_BY_RATE[rate];
}

export function elevenLabsSpeedForRate(rate: CallInSpeechRate): number {
  return ELEVENLABS_SPEED_BY_RATE[rate];
}

/**
 * Apply a rate to a provider voice config, returning a new config. Standard
 * (Cartesia) and Premium (ElevenLabs) both honor speed; other providers pass
 * through unchanged.
 */
export function applySpeechRateToVoice(
  voice: VapiVoiceConfig,
  rate: CallInSpeechRate,
): VapiVoiceConfig {
  if (voice.provider === "cartesia") {
    return {
      ...voice,
      experimentalControls: {
        ...voice.experimentalControls,
        speed: cartesiaSpeedForRate(rate),
      },
    };
  }
  if (voice.provider === "11labs") {
    return { ...voice, speed: elevenLabsSpeedForRate(rate) };
  }
  return voice;
}

/** Parse an explicit tool argument (faster / slower / normal / reset). */
export function parseSpeechRateCommandArg(
  raw: unknown,
): SpeechRateCommand | null {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!v) return null;
  if (["faster", "speed up", "quicker", "up", "increase"].includes(v)) {
    return "faster";
  }
  if (["slower", "slow down", "slow", "down", "decrease"].includes(v)) {
    return "slower";
  }
  if (
    ["normal", "normal speed", "reset", "default", "regular"].includes(v)
  ) {
    return "normal";
  }
  return null;
}

/**
 * Detect a speech-rate command from free-form speech. Conservative: only fires
 * on clearly speed-related phrasing so ordinary questions are unaffected.
 */
export function detectSpeechRateCommand(
  rawQuestion: string,
): SpeechRateCommand | null {
  const q = rawQuestion
    .toLowerCase()
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return null;
  if (
    /\b(normal|regular|default|standard|usual)\s+(speed|pace)\b/.test(q) ||
    /\breset (the )?(speed|pace)\b/.test(q)
  ) {
    return "normal";
  }
  if (
    /\b(faster|speed up|speed it up|quicker|pick up the pace|go faster|read faster|talk faster|speak faster|read quicker|too slow)\b/.test(
      q,
    )
  ) {
    return "faster";
  }
  if (
    /\b(slower|slow down|slow it down|go slower|read slower|talk slower|speak slower|read it slower|too fast|not so fast|ease up)\b/.test(
      q,
    )
  ) {
    return "slower";
  }
  return null;
}

/** Move one step for faster/slower; jump to normal for normal. */
export function adjustSpeechRate(
  current: CallInSpeechRate,
  command: SpeechRateCommand,
): CallInSpeechRate {
  if (command === "normal") return "normal";
  const idxRaw = CALL_IN_SPEECH_RATES.indexOf(current);
  const idx =
    idxRaw < 0
      ? CALL_IN_SPEECH_RATES.indexOf(DEFAULT_CALL_IN_SPEECH_RATE)
      : idxRaw;
  if (command === "faster") {
    return CALL_IN_SPEECH_RATES[
      Math.min(idx + 1, CALL_IN_SPEECH_RATES.length - 1)
    ]!;
  }
  return CALL_IN_SPEECH_RATES[Math.max(idx - 1, 0)]!;
}

/**
 * Spoken confirmation. Honest about persistence and never over-promises an
 * instant mid-sentence change (VAPI can't guarantee that), while staying warm
 * and giving the reverse command.
 */
export function speakSpeechRateChange(
  previous: CallInSpeechRate,
  next: CallInSpeechRate,
  command: SpeechRateCommand,
): string {
  const unchanged = previous === next;
  if (command === "normal") {
    return "Okay, normal reading speed. I've saved that for your calls. Say faster or slower anytime.";
  }
  if (command === "faster") {
    if (unchanged) {
      return "That's already my fastest comfortable reading speed, so I'll keep it here. Say slower or normal speed to change it.";
    }
    return "Okay, a faster reading speed. I've saved it for your calls. Say slower or normal speed anytime.";
  }
  if (unchanged) {
    return "That's already my slowest reading speed, so I'll keep it here. Say faster or normal speed to change it.";
  }
  return "Okay, a slower reading speed. I've saved it for your calls. Say faster or normal speed anytime.";
}

/** DB enum value for a rate (Prisma CallInSpeechRate). */
export function dbSpeechRate(
  rate: CallInSpeechRate,
): "SLOW" | "NORMAL" | "BRISK" | "FAST" {
  return rate.toUpperCase() as "SLOW" | "NORMAL" | "BRISK" | "FAST";
}

/** Coerce a stored/DB value back to a valid rate, defaulting safely. */
export function fromDbSpeechRate(
  raw: string | null | undefined,
): CallInSpeechRate {
  const v = (raw ?? "").toString().trim().toLowerCase();
  return (CALL_IN_SPEECH_RATES as readonly string[]).includes(v)
    ? (v as CallInSpeechRate)
    : DEFAULT_CALL_IN_SPEECH_RATE;
}

/** Parse a spoken/typed rate label ("slow", "normal", "brisk", "fast"). */
export function parseSpeechRate(
  raw: string | null | undefined,
): CallInSpeechRate {
  return fromDbSpeechRate(raw);
}

/** Accessible label for the Settings UI. */
export function speechRateLabel(rate: CallInSpeechRate): string {
  switch (rate) {
    case "slow":
      return "Slow (most time to follow)";
    case "normal":
      return "Normal";
    case "brisk":
      return "Brisk (default — a little faster)";
    case "fast":
      return "Fast (quickest)";
    default: {
      const exhaustive: never = rate;
      return exhaustive;
    }
  }
}
