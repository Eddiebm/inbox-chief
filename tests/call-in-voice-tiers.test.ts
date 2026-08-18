import { describe, expect, it } from "vitest";
import {
  defaultVoiceTierForPlan,
  planAllowsPremiumVoice,
  resolveEffectiveVoiceTier,
  speechBudgetsForTier,
  STANDARD_VOICE,
  PREMIUM_VOICE,
  speakCostGuardVoiceTip,
  speakStandardVoiceTip,
  speakHighTtsCostTip,
  voiceTierInfo,
} from "@/lib/call-in/voice-tiers";
import { buildCallInAssistantPayload } from "@/lib/call-in/vapi-tools";

describe("call-in voice tiers", () => {
  it("Patron defaults to standard; Pro to premium", () => {
    expect(defaultVoiceTierForPlan("patron")).toBe("standard");
    expect(defaultVoiceTierForPlan("pro")).toBe("premium");
    expect(planAllowsPremiumVoice("patron")).toBe(false);
    expect(planAllowsPremiumVoice("pro")).toBe(true);
  });

  it("never serves Premium to Patron even if preferred", () => {
    expect(
      resolveEffectiveVoiceTier({ planId: "patron", preferred: "premium" }),
    ).toBe("standard");
    expect(
      resolveEffectiveVoiceTier({ planId: "pro", preferred: "premium" }),
    ).toBe("premium");
    expect(
      resolveEffectiveVoiceTier({ planId: "pro", preferred: "standard" }),
    ).toBe("standard");
  });

  it("cost guard forces Standard when minutes are high", () => {
    expect(
      resolveEffectiveVoiceTier({
        planId: "pro",
        preferred: "premium",
        costGuardPreferStandard: true,
      }),
    ).toBe("standard");
    expect(
      resolveEffectiveVoiceTier({
        planId: "pro",
        preferred: "standard",
        costGuardPreferStandard: true,
      }),
    ).toBe("standard");
    expect(speakCostGuardVoiceTip()).toMatch(/standard voice/i);
    expect(speakCostGuardVoiceTip()).toMatch(/included minutes/i);
  });

  it("Standard uses Cartesia; Premium uses ElevenLabs", () => {
    expect(STANDARD_VOICE.vapi.provider).toBe("cartesia");
    expect(STANDARD_VOICE.vapi.model).toBe("sonic-english");
    // Speed is applied per call from the saved rate, not hardcoded on the tier.
    expect(STANDARD_VOICE.vapi.experimentalControls).toBeUndefined();
    expect(PREMIUM_VOICE.vapi.provider).toBe("11labs");
    expect(voiceTierInfo("standard").label).toMatch(/Standard/i);
    expect(voiceTierInfo("premium").label).toMatch(/Premium/i);
  });

  it("Standard speech budgets are tighter than Premium", () => {
    const std = speechBudgetsForTier("standard");
    const prem = speechBudgetsForTier("premium");
    expect(std.maxAttachmentTextChars).toBeLessThan(
      prem.maxAttachmentTextChars,
    );
    expect(std.maxEmailTextChars).toBeLessThan(prem.maxEmailTextChars);
  });

  it("spoken tip mentions standard and Pro", () => {
    expect(speakStandardVoiceTip()).toMatch(/standard voice/i);
    expect(speakStandardVoiceTip()).toMatch(/Pro/i);
    expect(speakHighTtsCostTip()).toMatch(/Standard/i);
  });

  it("assistant payload switches voice by tier and applies the default brisk rate", () => {
    const std = buildCallInAssistantPayload("https://example.com", {
      voiceTier: "standard",
    });
    const prem = buildCallInAssistantPayload("https://example.com", {
      voiceTier: "premium",
    });
    expect(std.serverMessages).toContain("tool-calls");
    expect(std.serverMessages).toContain("assistant-request");
    expect((std.voice as { provider: string }).provider).toBe("cartesia");
    expect((std.voice as { language?: string }).language).toBe("en");
    // Default rate (brisk) → Cartesia numeric speed applied.
    expect(
      (std.voice as { experimentalControls?: { speed?: number } })
        .experimentalControls?.speed,
    ).toBe(0.2);
    expect((prem.voice as { provider: string }).provider).toBe("11labs");
    // Premium (ElevenLabs) gets a numeric speed multiplier around 1.15x.
    expect((prem.voice as { speed?: number }).speed).toBe(1.15);
  });

  it("applies a slower rate to both providers when requested", () => {
    const std = buildCallInAssistantPayload("https://example.com", {
      voiceTier: "standard",
      speechRate: "slow",
    });
    const prem = buildCallInAssistantPayload("https://example.com", {
      voiceTier: "premium",
      speechRate: "slow",
    });
    expect(
      (std.voice as { experimentalControls?: { speed?: number } })
        .experimentalControls?.speed,
    ).toBeLessThan(0);
    expect((prem.voice as { speed?: number }).speed).toBeLessThan(1);
  });
});
