import { getNodePrisma } from "@/lib/db-node";
import type { CallInMailboxSnapshot } from "@/lib/call-in/assistant";
import type { CallInSpeechRate } from "@/lib/call-in/speech-rate";
import {
  confirmationDraftId,
  parseTalkAction,
  phoneToolForUtterance,
} from "@/lib/call-in/talk-actions";
import { handleCallInTool } from "@/lib/call-in/vapi-tools";

export type TalkDispatchResult = {
  spoken: string;
  intent: string;
  draftId: string | null;
  speechRate: CallInSpeechRate | null;
};

async function identityIdForUser(
  userId: string,
  organizationId: string,
): Promise<string | null> {
  const prisma = getNodePrisma();
  const scoped = await prisma.callInIdentity.findFirst({
    where: { userId, organizationId },
    select: { id: true },
  });
  if (scoped) return scoped.id;
  const fallback = await prisma.callInIdentity.findFirst({
    where: { userId, enabled: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  return fallback?.id ?? null;
}

function toolResult(result: {
  spoken: string;
  intent: string;
  speechRate?: CallInSpeechRate;
}, draftId: string | null): TalkDispatchResult {
  return {
    spoken: result.spoken,
    intent: result.intent,
    draftId,
    speechRate: result.speechRate ?? null,
  };
}

/**
 * Run a Talk request through the same phone tools the handset uses.
 * Returns null only when the words are not a phone action (research stays
 * on its own path). A spoken plan is never returned in place of a tool call.
 */
export async function dispatchTalkAction(input: {
  text: string;
  snapshot: CallInMailboxSnapshot;
  userId: string;
  pendingDraftId?: string | null;
  /** Talk session id. The phone read cursor advances inside one session. */
  callId?: string | null;
}): Promise<TalkDispatchResult | null> {
  const action = parseTalkAction(input.text);
  if (action) {
    switch (action.kind) {
      case "decline_send":
        if (!input.pendingDraftId) return null;
        return {
          spoken: "Nothing was sent. Tell me the new message when you are ready.",
          intent: "decline_send",
          draftId: null,
          speechRate: null,
        };
      case "confirm_send":
        if (!input.pendingDraftId) {
          return {
            spoken: "I do not have a draft waiting. Nothing was sent.",
            intent: "send_email",
            draftId: null,
            speechRate: null,
          };
        }
        {
          const sent = await handleCallInTool({
            name: "confirm_email_send",
            args: { confirmed: true, draftId: input.pendingDraftId },
            snapshot: input.snapshot,
            requestedById: input.userId,
            callId: input.callId ?? null,
            callInIdentityId: await identityIdForUser(
              input.userId,
              input.snapshot.organizationId,
            ),
          });
          return toolResult(sent, null);
        }
      case "need_message":
        return {
          spoken: action.replyToCurrent
            ? "What should I say in the reply? Nothing was sent."
            : "Who is it for, and what should I say? Nothing was sent.",
          intent: "compose_email",
          draftId: null,
          speechRate: null,
        };
      case "calendar": {
        const calendar = await handleCallInTool({
          name: "get_calendar",
          args: { range: action.range },
          snapshot: input.snapshot,
          requestedById: input.userId,
          callId: input.callId ?? null,
          callInIdentityId: await identityIdForUser(
            input.userId,
            input.snapshot.organizationId,
          ),
        });
        return toolResult(calendar, null);
      }
      case "compose": {
        const callInIdentityId = await identityIdForUser(
          input.userId,
          input.snapshot.organizationId,
        );
        const drafted = await handleCallInTool({
          name: "compose_email",
          args: {
            recipient: action.recipient,
            subject: action.subject,
            body: action.body,
            replyToCurrent: action.replyToCurrent,
          },
          snapshot: input.snapshot,
          requestedById: input.userId,
          callId: input.callId ?? null,
          callInIdentityId,
        });
        return toolResult(drafted, confirmationDraftId(drafted.spoken));
      }
      default: {
        const neverAction: never = action;
        return neverAction;
      }
    }
  }

  const tool = phoneToolForUtterance(input.text);
  if (!tool) return null;
  const ran = await handleCallInTool({
    name: tool.name,
    args: tool.args,
    snapshot: input.snapshot,
    requestedById: input.userId,
    callId: input.callId ?? null,
    callInIdentityId: await identityIdForUser(
      input.userId,
      input.snapshot.organizationId,
    ),
  });
  return toolResult(
    ran,
    ran.intent === "compose_email" ? confirmationDraftId(ran.spoken) : null,
  );
}
