/**
 * Call-in TTS voice tiers — Standard (cheap, clear) vs Premium (ElevenLabs).
 *
 * Plan gating:
 * - Patron → Standard only (Premium shows “Included on Pro” in Settings)
 * - Pro / Business → Premium default; can choose Standard to save cost
 * - Minutes ≥80% used → auto-prefer Standard for next calls (announce once)
 *
 * VAPI applies the voice via assistant-request override (single webhook assistant,
 * voice swapped per call). No second phone number required.
 */

import { getDefaultPlan, getPlan, resolvePlanId } from "@/lib/plans";

export type CallInVoiceTierId = "standard" | "premium";

export type VapiVoiceConfig = {
  provider: string;
  voiceId: string;
  model?: string;
  language?: string;
  /** Cartesia clarity: slightly slower reads better for blind patrons */
  experimentalControls?: {
    speed?: "slowest" | "slow" | "normal" | "fast" | "fastest";
  };
};

export type CallInVoiceTierInfo = {
  id: CallInVoiceTierId;
  /** Accessible UI label */
  label: string;
  /** Short helper under the radio */
  description: string;
  vapi: VapiVoiceConfig;
};

export type SpeechBudgets = {
  maxEmailTextChars: number;
  maxSpokenChars: number;
  maxAttachmentTextChars: number;
};

/**
 * Standard — Cartesia Sonic (clear American English, much cheaper than ElevenLabs).
 * Tuned for max clarity at min cost: sonic-english + slight slow for intelligibility.
 * Voice: "Katie" — bright, screen-reader-friendly.
 */
export const STANDARD_VOICE: CallInVoiceTierInfo = {
  id: "standard",
  label: "Standard voice",
  description:
    "Clear speech at lower cost. Default on Patron. Premium uses more of your included minutes.",
  vapi: {
    provider: "cartesia",
    voiceId: "a0e99841-438c-4a64-b679-ae501e7d6091",
    model: "sonic-english",
    language: "en",
    experimentalControls: { speed: "slow" },
  },
};

/**
 * Premium — ElevenLabs Rachel (richer sound; higher TTS cost per minute of speech).
 * Default on Pro. Overage $/min unchanged — Premium uses more of included minutes’ dollar value.
 */
export const PREMIUM_VOICE: CallInVoiceTierInfo = {
  id: "premium",
  label: "Premium voice",
  description:
    "Richer sound. Included on Pro. Premium uses more of your included minutes.",
  vapi: {
    provider: "11labs",
    voiceId: "21m00Tcm4TlvDq8ikWAM",
  },
};

export const CALL_IN_VOICE_TIERS: CallInVoiceTierInfo[] = [
  STANDARD_VOICE,
  PREMIUM_VOICE,
];

/** TTS share of last-call cost above this → soft “switch to Standard” tip. */
export const TTS_COST_SHARE_TIP_RATIO = 0.45;

/**
 * Per-turn speech budgets. These size ONE spoken turn — they are not content
 * limits. Anything longer continues on the next turn ("say continue"), so no
 * tier ever truncates an email body. Standard stays slightly tighter for TTS
 * cost, but never tight enough to cut a message short.
 */
export function speechBudgetsForTier(tier: CallInVoiceTierId): SpeechBudgets {
  if (tier === "premium") {
    return {
      maxEmailTextChars: 1900,
      maxSpokenChars: 2800,
      maxAttachmentTextChars: 1500,
    };
  }
  return {
    maxEmailTextChars: 1600,
    maxSpokenChars: 2400,
    maxAttachmentTextChars: 1200,
  };
}

export function voiceTierInfo(id: CallInVoiceTierId): CallInVoiceTierInfo {
  return id === "premium" ? PREMIUM_VOICE : STANDARD_VOICE;
}

export function parseVoiceTier(
  raw: string | null | undefined,
): CallInVoiceTierId {
  const n = (raw ?? "").trim().toLowerCase();
  if (n === "premium" || n === "PREMIUM".toLowerCase()) return "premium";
  return "standard";
}

export function dbVoiceTier(
  id: CallInVoiceTierId,
): "STANDARD" | "PREMIUM" {
  return id === "premium" ? "PREMIUM" : "STANDARD";
}

export function fromDbVoiceTier(
  raw: string | null | undefined,
): CallInVoiceTierId {
  if ((raw ?? "").toUpperCase() === "PREMIUM") return "premium";
  return "standard";
}

/** Plans that may use Premium as default / selectable. */
export function planAllowsPremiumVoice(planId: string): boolean {
  const id = resolvePlanId(planId);
  return id === "pro" || id === "business";
}

/** Default preference when user has never chosen. */
export function defaultVoiceTierForPlan(planId: string): CallInVoiceTierId {
  return planAllowsPremiumVoice(planId) ? "premium" : "standard";
}

/**
 * Effective voice for a live call — never serves Premium to Patron.
 * When minutes ≥80% used (costGuard), force Standard even if preferred Premium.
 */
export function resolveEffectiveVoiceTier(input: {
  planId: string;
  preferred: CallInVoiceTierId | null | undefined;
  /** Soft-cap approaching / at_limit → prefer Standard */
  costGuardPreferStandard?: boolean;
}): CallInVoiceTierId {
  const planId = resolvePlanId(input.planId || getDefaultPlan().id);
  const preferred =
    input.preferred ?? defaultVoiceTierForPlan(planId);
  if (preferred === "premium" && !planAllowsPremiumVoice(planId)) {
    return "standard";
  }
  if (input.costGuardPreferStandard && preferred === "premium") {
    return "standard";
  }
  return preferred;
}

/** Optional first-call tip (spoken once) for Patron on Standard. */
export function speakStandardVoiceTip(): string {
  return "Using standard voice to keep costs down. Premium voice is included on Pro.";
}

/** Spoken once when minutes force Standard over Premium preference. */
export function speakCostGuardVoiceTip(): string {
  return "You've used most of your included minutes. Using standard voice for this call to stretch your plan. Premium uses more of your included minutes.";
}

export function voiceTierUpgradeHint(): string {
  return "Premium voice is included on Pro. Stay on Standard voice to keep call costs lower. Premium uses more of your included minutes.";
}

/** UI copy: projected impact of Premium vs Standard. */
export function premiumVsStandardCostCopy(): string {
  return "Premium uses more of your included minutes than Standard (richer TTS costs more per minute of speech). Overage rate stays the same per minute after your included minutes.";
}

/** Soft tip after a call when TTS dominated cost. */
export function speakHighTtsCostTip(): string {
  return "Switch to Standard voice to lower cost.";
}

/** Plan display name for UI. */
export function planNameForVoice(planId: string): string {
  return getPlan(planId)?.name ?? getDefaultPlan().name;
}
