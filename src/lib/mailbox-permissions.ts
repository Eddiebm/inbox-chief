import { getNodePrisma } from "@/lib/db-node";
import { PERMISSIONS, type PermissionKey } from "@/lib/rbac";

export type MailboxPermissionCheck = {
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  userId: string;
  /** The mailbox's ownerId, when already known — avoids a redundant lookup. */
  ownerId?: string | null;
  permission: PermissionKey;
};

/**
 * True when `userId` may exercise `permission` on this exact mailbox.
 *
 * The mailbox owner is always granted every mailbox-scoped permission
 * implicitly (owner is a strict superset — this never narrows what an
 * owner can already do). Anyone else must hold a matching, unexpired
 * `MailboxPermission` row for this organization/workspace/mailbox — the
 * grant table is the only source of delegated access; a role name or
 * membership alone is never sufficient.
 */
export async function hasMailboxPermission(
  input: MailboxPermissionCheck,
): Promise<boolean> {
  if (input.ownerId && input.ownerId === input.userId) return true;

  const definition = PERMISSIONS.find((p) => p.key === input.permission);
  if (!definition?.mailbox) return false;

  if (
    !input.organizationId ||
    !input.workspaceId ||
    !input.mailboxId ||
    !input.userId
  ) {
    return false;
  }

  const prisma = getNodePrisma();
  const grant = await prisma.mailboxPermission.findFirst({
    where: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      mailboxId: input.mailboxId,
      userId: input.userId,
      permission: { key: input.permission },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  return grant !== null;
}

/** Throws `permission_denied` instead of returning a boolean. */
export async function requireMailboxPermission(
  input: MailboxPermissionCheck,
): Promise<void> {
  if (!(await hasMailboxPermission(input))) {
    throw new Error("permission_denied");
  }
}
