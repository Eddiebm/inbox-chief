/**
 * Resolve the signed-in user's primary organization + workspace for mailbox connect.
 * Never hardcodes tenant ids. Technical admins do not get mailbox scope by default.
 */
export async function resolveUserMailboxScope(userId: string): Promise<{
  organizationId: string;
  workspaceId: string;
  userId: string;
} | null> {
  if (!userId || userId === "mock_user") {
    return null;
  }

  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();

  const membership = await prisma.organizationMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: {
      role: true,
      organization: {
        include: {
          workspaces: {
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
      },
    },
  });

  if (!membership) return null;

  if (!membership.role.grantsMailboxAccessByDefault) {
    return null;
  }

  const workspace = membership.organization.workspaces[0];
  if (!workspace) return null;

  return {
    organizationId: membership.organizationId,
    workspaceId: workspace.id,
    userId,
  };
}

/** @deprecated Prefer resolveUserMailboxScope — kept for Gmail route compatibility */
export const resolveUserGmailScope = resolveUserMailboxScope;
