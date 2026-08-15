import { NextResponse } from "next/server";
import { z } from "zod";
import {
  applyVoiceLearningAction,
  defaultVoiceLearningState,
  type VoiceLearningState,
} from "@/lib/voice/learning-consent";
import { product } from "@/lib/product";

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("enable"),
    consentAcknowledged: z.boolean(),
  }),
  z.object({ type: z.literal("disable") }),
  z.object({ type: z.literal("reset_profile") }),
  z.object({ type: z.literal("delete_learned_data") }),
]);

const bodySchema = z.object({
  action: actionSchema,
  /** Client may echo current state for mock/local persistence */
  state: z
    .object({
      learningEnabled: z.boolean(),
      consentGranted: z.boolean(),
      consentGrantedAt: z.string().nullable(),
      hasLearnedData: z.boolean(),
      profile: z.object({
        greeting: z.string().nullable(),
        signature: z.string().nullable(),
        tone: z.string().nullable(),
      }),
    })
    .optional(),
});

/**
 * Voice learning consent API.
 * Enable is consent-gated; disable / reset / delete never train globally.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    state: defaultVoiceLearningState(),
    message: `${product.name} never enables voice learning silently.`,
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid voice learning request." },
      { status: 400 },
    );
  }

  const current: VoiceLearningState =
    parsed.data.state ?? defaultVoiceLearningState();
  const result = applyVoiceLearningAction(current, parsed.data.action);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const messages: Record<string, string> = {
    enable: "Voice learning enabled. Preferences stay in your account only.",
    disable: "Voice learning paused. Existing preferences are kept until deleted.",
    reset_profile: "Voice profile reset. Tone and signature cleared.",
    delete_learned_data:
      "Learned voice data deleted. Consent cleared; learning is off.",
  };

  return NextResponse.json({
    ok: true,
    state: result.state,
    message: messages[parsed.data.action.type],
    persisted: process.env.MOCK_INTEGRATIONS !== "true",
  });
}
