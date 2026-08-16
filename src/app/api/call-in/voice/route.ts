import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  getCallInVoicePreferenceForUser,
  setCallInVoicePreference,
  setCallInSpeechRateForUser,
} from "@/lib/call-in/voice-preference";
import {
  CALL_IN_VOICE_TIERS,
  voiceTierUpgradeHint,
} from "@/lib/call-in/voice-tiers";
import {
  CALL_IN_SPEECH_RATES,
  DEFAULT_CALL_IN_SPEECH_RATE,
  speechRateLabel,
} from "@/lib/call-in/speech-rate";

const SPEECH_RATE_OPTIONS = CALL_IN_SPEECH_RATES.map((rate) => ({
  id: rate,
  label: speechRateLabel(rate),
}));

/**
 * GET current call-in voice tier preference + plan gating.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  if (process.env.MOCK_INTEGRATIONS === "true" || !process.env.DATABASE_URL) {
    return NextResponse.json({
      ok: true,
      preferred: "standard",
      effective: "standard",
      allowsPremium: false,
      planId: "patron",
      tiers: CALL_IN_VOICE_TIERS.map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
      })),
      speechRate: DEFAULT_CALL_IN_SPEECH_RATE,
      speechRates: SPEECH_RATE_OPTIONS,
      persisted: false,
    });
  }

  const pref = await getCallInVoicePreferenceForUser(user.id);
  return NextResponse.json({
    ok: true,
    preferred: pref?.preferred ?? "standard",
    effective: pref?.effective ?? "standard",
    allowsPremium: pref?.allowsPremium ?? false,
    costGuardActive: pref?.costGuardActive ?? false,
    costGuardPreferStandard: pref?.costGuardPreferStandard ?? false,
    planId: pref?.planId ?? "patron",
    costImpact: "Premium uses more of your included minutes.",
    tiers: CALL_IN_VOICE_TIERS.map((t) => ({
      id: t.id,
      label: t.label,
      description: t.description,
    })),
    speechRate: pref?.speechRate ?? DEFAULT_CALL_IN_SPEECH_RATE,
    speechRates: SPEECH_RATE_OPTIONS,
    persisted: true,
  });
}

const putSchema = z.object({
  tier: z.enum(["standard", "premium"]).optional(),
  speechRate: z.enum(CALL_IN_SPEECH_RATES).optional(),
});

/**
 * PUT preferred call-in voice. Premium blocked on Patron (returns upgrade hint).
 */
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = putSchema.safeParse(body);
  if (!parsed.success || (!parsed.data.tier && !parsed.data.speechRate)) {
    return NextResponse.json(
      { error: "Choose a voice tier or a reading speed." },
      { status: 400 },
    );
  }

  // Reading speed is available to every plan and does not affect tier gating.
  if (parsed.data.speechRate) {
    if (process.env.MOCK_INTEGRATIONS === "true" || !process.env.DATABASE_URL) {
      return NextResponse.json({
        ok: true,
        speechRate: parsed.data.speechRate,
        message: "Demo mode — reading speed is not saved.",
      });
    }
    const rate = await setCallInSpeechRateForUser({
      userId: user.id,
      rate: parsed.data.speechRate,
    });
    return NextResponse.json({
      ok: true,
      speechRate: rate,
      message: `Reading speed saved: ${speechRateLabel(rate)}. It applies on your next call and you can also say faster, slower, or normal speed while on a call.`,
    });
  }

  if (process.env.MOCK_INTEGRATIONS === "true" || !process.env.DATABASE_URL) {
    return NextResponse.json({
      ok: true,
      preferred: "standard",
      effective: "standard",
      allowsPremium: false,
      message: "Demo mode — voice preference is not saved.",
    });
  }

  const result = await setCallInVoicePreference({
    userId: user.id,
    tier: parsed.data.tier!,
  });

  if (result.blocked === "premium_requires_pro") {
    return NextResponse.json({
      ok: true,
      preferred: result.preferred,
      effective: result.effective,
      allowsPremium: false,
      planId: result.planId,
      blocked: "premium_requires_pro",
      message: voiceTierUpgradeHint(),
    });
  }

  return NextResponse.json({
    ok: true,
    preferred: result.preferred,
    effective: result.effective,
    allowsPremium: result.allowsPremium,
    costGuardActive: result.costGuardActive,
    planId: result.planId,
    message:
      result.costGuardActive
        ? "Preference saved. Near your included minutes — Standard voice is used on calls until the period resets. Premium uses more of your included minutes."
        : result.effective === "premium"
          ? "Premium voice saved. Richer sound; Premium uses more of your included minutes. Overage is still the same per-minute rate."
          : "Standard voice saved. Clear speech at lower cost.",
  });
}
