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
import { dispatchTalkAction } from "@/lib/call-in/talk-dispatch";
import { speakResearchForOwner } from "@/lib/research/from-voice";
import { product } from "@/lib/product";
import { queueAttachmentDelivery } from "@/lib/attachment-deliveries";

export const askSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  preferredName: z.string().trim().min(1).max(80).optional(),
  sessionId: z.string().trim().min(1).max(120).optional(),
  timeZone: z.string().trim().min(1).max(80).optional(),
  pendingDraftId: z.string().trim().min(1).max(80).nullish(),
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
 * or when no mailbox is connected. A new email is only a draft until the
 * caller explicitly says send it for that draft.
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
  if (
    !routeNumbers &&
    user &&
    user.id !== "mock_user" &&
    snapshot.identityStatus === "matched" &&
    snapshot.organizationId !== "demo_org" &&
    snapshot.organizationId !== "unrecognized"
  ) {
    const researchSpoken = await speakResearchForOwner({
      scope: {
        organizationId: snapshot.organizationId,
        workspaceId: snapshot.workspaceId,
        userId: user.id,
        email: user.email,
        mailboxId: snapshot.mailboxId,
      },
      text: parsed.data.question,
    });
    if (researchSpoken) {
      return NextResponse.json({
        ok: true,
        product: product.name,
        sessionId: parsed.data.sessionId ?? `web_${Date.now()}`,
        intent: "research",
        spoken: researchSpoken,
        llmAssisted: false,
        llmProvider: null,
        identityStatus: snapshot.identityStatus,
        mailboxEmail: snapshot.mailboxEmail,
        draftId: null,
        speechRate: null,
        canContinue: true,
      });
    }
  }

  if (!routeNumbers) {
    const talkAction = await dispatchTalkAction({
      text: parsed.data.question,
      snapshot,
      userId: user && user.id !== "mock_user" ? user.id : "demo_listener",
      pendingDraftId: parsed.data.pendingDraftId ?? null,
      callId: parsed.data.sessionId ?? null,
    });
    if (talkAction) {
      return NextResponse.json({
        ok: true,
        product: product.name,
        sessionId: parsed.data.sessionId ?? `web_${Date.now()}`,
        intent: talkAction.intent,
        spoken: talkAction.spoken,
        llmAssisted: false,
        llmProvider: null,
        identityStatus: snapshot.identityStatus,
        mailboxEmail: snapshot.mailboxEmail,
        draftId: talkAction.draftId,
        speechRate: talkAction.speechRate,
        canContinue: talkAction.intent !== "goodbye",
      });
    }
  }
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
      if (usage.hardCapReached) {
        opening = usage.spokenCapReached;
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
