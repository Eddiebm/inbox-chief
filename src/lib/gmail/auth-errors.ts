/**
 * Detect Gmail OAuth token failures that require the patron to Connect Gmail again.
 * Never expose Google/Cloud jargon to patrons.
 */

export const GMAIL_NEEDS_RECONNECT_SPOKEN =
  "Your mailbox needs reconnecting. Open Settings and tap Connect Gmail, then try again. Nothing sends without your approval.";

export function isGmailAuthFailure(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : JSON.stringify(error ?? "");
  const lower = message.toLowerCase();
  return (
    lower.includes("invalid_grant") ||
    lower.includes("invalid_rapt") ||
    lower.includes("token has been expired or revoked") ||
    lower.includes("token_revoked") ||
    lower.includes("unauthorized") ||
    /\b401\b/.test(lower) ||
    lower.includes("login required") ||
    lower.includes("invalid_client")
  );
}

export async function markMailboxNeedsReconnect(input: {
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
}): Promise<void> {
  if (!input.organizationId || !input.workspaceId || !input.mailboxId) return;
  try {
    const { getNodePrisma } = await import("@/lib/db-node");
    const prisma = getNodePrisma();
    await prisma.mailbox.updateMany({
      where: {
        id: input.mailboxId,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
      },
      data: { connectionStatus: "error" },
    });
  } catch (error) {
    console.warn("[gmail] markMailboxNeedsReconnect failed", error);
  }
}
