import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  getCallInVoicePreferenceForUser,
  setCallInVoicePreference,
} from "@/lib/call-in/voice-preference";
import {
  CALL_IN_VOICE_TIERS,
  voiceTierUpgradeHint,
} from "@/lib/call-in/voice-tiers";

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
    persisted: true,
  });
}

const putSchema = z.object({
  tier: z.enum(["standard", "premium"]),
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
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose standard or premium voice." },
      { status: 400 },
    );
  }

  if (process.env.MOCK_INTEGRATIONS === "true" || !process.env.DATABASE_URL) {
    return NextResponse.json({
      ok: true,
      preferred: parsed.data.tier === "premium" ? "standard" : "standard",
      effective: "standard",
      allowsPremium: false,
      message: "Demo mode — voice preference is not saved.",
    });
  }

  const result = await setCallInVoicePreference({
    userId: user.id,
    tier: parsed.data.tier,
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
