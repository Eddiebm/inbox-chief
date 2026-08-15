import { afterEach, describe, expect, it } from "vitest";
import {
  applyVoiceLearningAction,
  defaultVoiceLearningState,
  voiceProfileForDraft,
} from "@/lib/voice/learning-consent";

describe("voice learning consent", () => {
  it("starts with learning off and no consent", () => {
    const state = defaultVoiceLearningState({ tone: "warm" });
    expect(state.learningEnabled).toBe(false);
    expect(state.consentGranted).toBe(false);
    expect(state.hasLearnedData).toBe(true);
    expect(voiceProfileForDraft(state).consentGranted).toBe(false);
  });

  it("rejects enable without explicit consent acknowledgement", () => {
    const state = defaultVoiceLearningState();
    const result = applyVoiceLearningAction(state, {
      type: "enable",
      consentAcknowledged: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/consent/i);
  });

  it("enables only after consent acknowledgement", () => {
    const state = defaultVoiceLearningState({ tone: "direct" });
    const result = applyVoiceLearningAction(state, {
      type: "enable",
      consentAcknowledged: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.learningEnabled).toBe(true);
    expect(result.state.consentGranted).toBe(true);
    expect(result.state.consentGrantedAt).toBeTruthy();
    const forDraft = voiceProfileForDraft(result.state);
    expect(forDraft.learningEnabled && forDraft.consentGranted).toBe(true);
  });

  it("disables learning without wiping consent record", () => {
    let state = defaultVoiceLearningState({ signature: "Best" });
    const enabled = applyVoiceLearningAction(state, {
      type: "enable",
      consentAcknowledged: true,
    });
    expect(enabled.ok).toBe(true);
    if (!enabled.ok) return;
    state = enabled.state;
    const disabled = applyVoiceLearningAction(state, { type: "disable" });
    expect(disabled.ok).toBe(true);
    if (!disabled.ok) return;
    expect(disabled.state.learningEnabled).toBe(false);
    expect(disabled.state.consentGranted).toBe(true);
    expect(disabled.state.profile.signature).toBe("Best");
  });

  it("resets profile fields and clears learned-data flag", () => {
    const state = defaultVoiceLearningState({
      greeting: "Hi",
      signature: "Thanks",
      tone: "warm",
    });
    const result = applyVoiceLearningAction(state, { type: "reset_profile" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.profile).toEqual({
      greeting: null,
      signature: null,
      tone: null,
    });
    expect(result.state.hasLearnedData).toBe(false);
  });

  it("deletes learned data and revokes consent", () => {
    let state = defaultVoiceLearningState({ tone: "formal" });
    const enabled = applyVoiceLearningAction(state, {
      type: "enable",
      consentAcknowledged: true,
    });
    expect(enabled.ok).toBe(true);
    if (!enabled.ok) return;
    const deleted = applyVoiceLearningAction(enabled.state, {
      type: "delete_learned_data",
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.state).toMatchObject({
      learningEnabled: false,
      consentGranted: false,
      consentGrantedAt: null,
      hasLearnedData: false,
      profile: { greeting: null, signature: null, tone: null },
    });
  });
});

describe("voice learning never applied without both flags", () => {
  afterEach(() => {
    // no env mutation in this file
  });

  it("voiceProfileForDraft requires both consent and learning", () => {
    const base = defaultVoiceLearningState({ tone: "warm" });
    expect(
      voiceProfileForDraft({
        ...base,
        learningEnabled: true,
        consentGranted: false,
      }).consentGranted,
    ).toBe(false);
  });
});
