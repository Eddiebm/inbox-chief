/**
 * Best-effort live-call voice update.
 *
 * VAPI does not officially support swapping a single assistant's voice
 * mid-call, so the reading speed is really applied when the next call's
 * assistant is built. Still, when a patron says "faster" / "slower" we attempt
 * a runtime PATCH /call/{id} with the new voice so the change can take effect
 * on the current call where the provider allows it. Any failure is swallowed —
 * the saved preference guarantees the next call is correct regardless.
 */

import { applySpeechRateToVoice, type CallInSpeechRate } from "@/lib/call-in/speech-rate";
import { voiceTierInfo, type CallInVoiceTierId } from "@/lib/call-in/voice-tiers";

const VAPI_BASE = "https://api.vapi.ai";

function buildLiveVoicePayload(
  tier: CallInVoiceTierId,
  rate: CallInSpeechRate,
): Record<string, unknown> {
  const applied = applySpeechRateToVoice(voiceTierInfo(tier).vapi, rate);
  const voice: Record<string, unknown> = {
    provider: applied.provider,
    voiceId: applied.voiceId,
  };
  if (applied.model) voice.model = applied.model;
  if (applied.language) voice.language = applied.language;
  if (applied.experimentalControls) {
    voice.experimentalControls = applied.experimentalControls;
  }
  if (typeof applied.speed === "number") voice.speed = applied.speed;
  return voice;
}

/**
 * Attempt to update the live call's voice speed. Returns true only if VAPI
 * accepted the PATCH; false (never throws) otherwise.
 */
export async function patchLiveCallSpeechRate(input: {
  callId: string | null | undefined;
  tier: CallInVoiceTierId;
  rate: CallInSpeechRate;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const apiKey = process.env.VAPI_API_KEY?.trim();
  if (
    !apiKey ||
    !input.callId ||
    process.env.MOCK_INTEGRATIONS === "true"
  ) {
    return false;
  }
  const doFetch = input.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${VAPI_BASE}/call/${input.callId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ voice: buildLiveVoicePayload(input.tier, input.rate) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
