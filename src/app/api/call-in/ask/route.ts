import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  emptyCallMinuteUsage,
  loadCallMinuteUsageForOrg,
} from "@/lib/billing/call-usage-server";
import {
  answerCallInQuestionWithLlm,
  demoMailboxSnapshot,
  isUnrecognizedCaller,
  openingPrompt,
} from "@/lib/call-in/assistant";
import { resolveSnapshotForUser } from "@/lib/call-in/identity";
import { resolveSpeechTimeZone } from "@/lib/call-in/speak-received";
import { resolveCallInVoiceForUser } from "@/lib/call-in/voice-preference";
import { getDefaultPlan } from "@/lib/plans";
import { product } from "@/lib/product";
import { queueAttachmentDelivery } from "@/lib/attachment-deliveries";

const askSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  preferredName: z.string().trim().min(1).max(80).optional(),
  sessionId: z.string().trim().min(1).max(120).optional(),
  timeZone: z.string().trim().min(1).max(80).optional(),
});

export function attachmentRouteNumbers(question: string): {
  emailNumber: number;
  attachmentNumber: number;
} | null {
  const normalized = question.toLowerCase();
  const explicitRoute =
    /\b(?:route|send|put)\b.*\b(?:attachment|file)\b/.test(normalized);
  const deviceDownload =
    /\bdownload\b.*\b(?:computer|laptop|downloads?|pc)\b/.test(normalized) ||
    /\b(?:computer|laptop|pc)\b.*\bdownload\b/.test(normalized);
  if (!explicitRoute && !deviceDownload) {
    return null;
  }
  const email = normalized.match(/\b(?:email|message)\s*(\d+)\b/);
  const attachment = normalized.match(/\b(?:attachment|file)\s*(\d+)\b/);
  return {
    emailNumber: email?.[1] ? Number(email[1]) : 1,
    attachmentNumber: attachment?.[1] ? Number(attachment[1]) : 1,
  };
}

/**
 * Anytime ask endpoint shared by web voice and future authenticated clients.
 * Uses the signed-in user's real mailbox when available; demo only in mock mode
 * or when no mailbox is connected. Never sends email.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = askSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ask a question in plain language." },
      { status: 400 },
    );
  }

  const user = await getCurrentUser();
  const snapshot =
    user && user.id !== "mock_user"
      ? await resolveSnapshotForUser(user.id, parsed.data.preferredName)
      : demoMailboxSnapshot(parsed.data.preferredName ?? "there");
  snapshot.speechTimeZone = resolveSpeechTimeZone(parsed.data.timeZone);

  if (
    user &&
    user.id !== "mock_user" &&
    snapshot.organizationId !== "demo_org" &&
    snapshot.organizationId !== "unrecognized" &&
    snapshot.organizationId !== "no_mailbox"
  ) {
    try {
      const voice = await resolveCallInVoiceForUser({
        userId: user.id,
        organizationId: snapshot.organizationId,
      });
      snapshot.voiceTier = voice.effective;
    } catch {
      snapshot.voiceTier = "standard";
    }
  }

  const routeNumbers = attachmentRouteNumbers(parsed.data.question);
  const answer = routeNumbers
    ? await queueAttachmentDelivery({
        snapshot,
        requestedById: user?.id === "mock_user" ? "" : (user?.id ?? ""),
        ...routeNumbers,
      }).then((result) => ({
        intent: "attachment_delivery" as const,
        spoken: result.spoken,
        llmAssisted: false,
        llmProvider: undefined,
      }))
    : await answerCallInQuestionWithLlm({
        question: parsed.data.question,
        snapshot,
      });

  let spoken = answer.spoken;
  if (
    user &&
    user.id !== "mock_user" &&
    snapshot.organizationId !== "demo_org" &&
    snapshot.organizationId !== "unrecognized" &&
    snapshot.organizationId !== "no_mailbox"
  ) {
    try {
      const usage = await loadCallMinuteUsageForOrg(snapshot.organizationId);
      if (usage.warningLevel !== "none" && usage.spokenWarning) {
        spoken = `${spoken} ${usage.spokenWarning}`;
      }
    } catch {
      /* keep the email speech — never drop it for usage */
    }
  }

  return NextResponse.json({
    ok: true,
    product: product.name,
    sessionId: parsed.data.sessionId ?? `web_${Date.now()}`,
    intent: answer.intent,
    spoken,
    llmAssisted: answer.llmAssisted ?? false,
    llmProvider: answer.llmProvider ?? null,
    identityStatus: snapshot.identityStatus,
    mailboxEmail: snapshot.mailboxEmail,
    // Hint for screen readers / UI
    canContinue: answer.intent !== "goodbye",
  });
}

export async function GET() {
  const user = await getCurrentUser();
  const snapshot =
    user && user.id !== "mock_user"
      ? await resolveSnapshotForUser(user.id)
      : demoMailboxSnapshot("there");

  let usage = emptyCallMinuteUsage(getDefaultPlan());
  let opening = openingPrompt(snapshot);

  if (
    user &&
    user.id !== "mock_user" &&
    !isUnrecognizedCaller(snapshot) &&
    snapshot.organizationId !== "demo_org"
  ) {
    try {
      usage = await loadCallMinuteUsageForOrg(snapshot.organizationId);
      if (usage.warningLevel !== "none" && usage.spokenWarning) {
        opening = `${opening} ${usage.spokenWarning}`;
      }
    } catch {
      /* keep default opening */
    }
  }

  return NextResponse.json({
    ok: true,
    product: product.name,
    opening,
    usage,
    identityStatus: snapshot.identityStatus,
    mailboxEmail: snapshot.mailboxEmail,
    examples: [
      "Give me a briefing",
      "What needs attention?",
      "Any drafts waiting?",
      "Is my Gmail connected?",
      "What can you do?",
    ],
  });
}
