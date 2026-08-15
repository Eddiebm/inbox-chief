import { tenantWhere, type TenantScope } from "@/lib/tenant";
import { syncMailbox } from "@/lib/gmail/client";
import { assertSyncOperationsSafe, GMAIL_SYNC_ALLOWED_OPERATIONS } from "@/lib/gmail/scopes";

export type GmailSyncJobParams = {
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  /** Actor initiating the job (for audit); required for TenantScope completeness */
  userId: string;
};

/**
 * Background Gmail sync job.
 * REQUIRES organizationId + workspaceId + mailboxId — never sync without full tenant scope.
 * Uses `tenantWhere` so every DB read/write is organization- and workspace-scoped.
 * Never sends mail.
 */
export async function runGmailSyncJob(params: GmailSyncJobParams) {
  const { organizationId, workspaceId, mailboxId, userId } = params;

  if (!organizationId || !workspaceId || !mailboxId) {
    throw new Error(
      "Gmail sync requires organizationId, workspaceId, and mailboxId",
    );
  }

  assertSyncOperationsSafe(GMAIL_SYNC_ALLOWED_OPERATIONS);

  const scope: TenantScope = {
    organizationId,
    workspaceId,
    mailboxId,
    userId,
  };

  const where = tenantWhere(scope);

  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();
  const mailbox = await prisma.mailbox.findFirst({ where });
  if (!mailbox) {
    throw new Error("Mailbox not found for tenant scope");
  }

  const result = await syncMailbox({
    organizationId,
    workspaceId,
    mailboxId,
    userId,
  });

  return {
    ...result,
    scope: {
      organizationId,
      workspaceId,
      mailboxId,
    },
  };
}
