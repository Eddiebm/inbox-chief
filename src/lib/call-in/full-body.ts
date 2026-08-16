/**
 * Guarantee the message about to be spoken has its whole body.
 *
 * Sync stores the plain-text body, but rows can predate the larger body cap or
 * hold only a Gmail snippet. Fetching on demand (never for the whole window)
 * keeps a full read possible without paying to download mail nobody asked for.
 */

import type { CallInReadableEmail } from "@/lib/call-in/assistant";
import { fetchGmailMessageBodyText } from "@/lib/gmail/client";
import { getNodePrisma } from "@/lib/db-node";

/** Sync marks a clipped body with a trailing ellipsis. */
export function isBodyIncompleteForSpeech(email: CallInReadableEmail): boolean {
  if (email.contentSource !== "body") return true;
  const text = email.readableText.trim();
  if (!text) return true;
  return text.endsWith("…") || text.endsWith("...");
}

export async function ensureFullBodyForSpeech(input: {
  email: CallInReadableEmail;
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  userId: string;
}): Promise<CallInReadableEmail> {
  const { email } = input;
  if (!isBodyIncompleteForSpeech(email)) return email;
  if (!email.gmailMessageId) return email;
  if (!input.mailboxId || input.mailboxId === "unknown_mb") return email;
  if (!input.userId) return email;

  try {
    const body = await fetchGmailMessageBodyText({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      mailboxId: input.mailboxId,
      userId: input.userId,
      gmailMessageId: email.gmailMessageId,
    });
    const trimmed = body?.trim() ?? "";
    if (!trimmed || trimmed.length <= email.readableText.trim().length) {
      return email;
    }
    email.readableText = trimmed;
    email.contentSource = "body";
    await persistBody(email.messageId, trimmed);
  } catch (err) {
    console.warn("[call-in] full body fetch failed; reading what we have", err);
  }
  return email;
}

/** Best-effort cache so the next call does not refetch the same body. */
async function persistBody(messageId: string | undefined, bodyText: string) {
  if (!messageId || !process.env.DATABASE_URL) return;
  try {
    await getNodePrisma().message.update({
      where: { id: messageId },
      data: { bodyText },
    });
  } catch (err) {
    console.warn("[call-in] full body persist failed", err);
  }
}
