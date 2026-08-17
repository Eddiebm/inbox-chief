import { getCurrentUser } from "@/lib/auth";
import { getNodePrisma } from "@/lib/db-node";
import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";
import type { TenantScope } from "@/lib/tenant";

export type SignedInMailboxContext = {
  user: { id: string };
  prisma: ReturnType<typeof getNodePrisma>;
  scope: TenantScope & { mailboxId: string };
};

/**
 * Signed-in mailbox owner with org + workspace + mailbox.
 * Mock sessions and technical admins get null — never demo mail.
 */
export async function loadSignedInMailbox(): Promise<SignedInMailboxContext | null> {
  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") return null;
  const scope = await resolveUserMailboxScope(user.id);
  if (!scope) return null;
  const prisma = getNodePrisma();
  const mailbox = await prisma.mailbox.findFirst({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      ownerId: user.id,
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!mailbox) return null;
  return {
    user,
    prisma,
    scope: { ...scope, mailboxId: mailbox.id },
  };
}
