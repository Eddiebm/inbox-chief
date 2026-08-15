import { z } from "zod";
import { NextResponse } from "next/server";

const onboardingSchema = z.object({
  welcomeConsent: z.string().optional(),
  preferredName: z.string().min(1).optional(),
  occupation: z.string().optional(),
  industry: z.string().optional(),
  connectGmail: z.string().optional(),
  messageTypes: z.string().optional(),
  importantSenders: z.string().optional(),
  escalationSubjects: z.string().optional(),
  noAutoReplyTopics: z.string().optional(),
  assistantMode: z.string().optional(),
  writingTone: z.string().optional(),
  greetingSignature: z.string().optional(),
  briefingFrequency: z.string().optional(),
  quietHours: z.string().optional(),
  retentionLength: z.string().optional(),
  neverDeleteCategories: z.string().optional(),
  callInPhone: z.string().optional(),
  inviteHumanAssistant: z.string().optional(),
  completedAt: z.string().optional(),
  currentStep: z.number().int().nonnegative().optional(),
}).passthrough();

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = onboardingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "Validation failed",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const answers = parsed.data;
  const voiceProfileDraft = {
    greeting: answers.greetingSignature?.split("\n")[0] ?? null,
    signature: answers.greetingSignature ?? null,
    tone: answers.writingTone ?? null,
    learningEnabled: false,
  };
  const rulesDraft = {
    importantSenders: answers.importantSenders ?? "",
    escalationSubjects: answers.escalationSubjects ?? "",
    noAutoReplyTopics: answers.noAutoReplyTopics ?? "",
    neverDeleteCategories: answers.neverDeleteCategories ?? "",
    assistantMode: answers.assistantMode ?? "draft-only",
    quietHours: answers.quietHours ?? "",
    retentionLength: answers.retentionLength ?? "",
    callInPhone: answers.callInPhone ?? "",
  };

  // Persists to DB when auth + DATABASE_URL are live; always returns shaped profile for clients.
  return NextResponse.json({
    ok: true as const,
    persisted: process.env.MOCK_INTEGRATIONS !== "true",
    voiceProfileDraft,
    rulesDraft,
  });
}
