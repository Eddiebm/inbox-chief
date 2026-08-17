/**
 * Server-side organization binding for billing routes.
 *
 * A client-supplied `organizationId` decides who gets charged and who gets
 * credited, so it is never trusted on its own: it must match an organization
 * the session actually belongs to.
 */

import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";

export type ResolvedBillingOrg =
  | { ok: true; organizationId: string | null }
  | { ok: false; status: number; error: string };

/** Direct membership check — `resolveUserMailboxScope` only returns the first org. */
export async function isOrganizationMember(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  if (!process.env.DATABASE_URL?.trim()) return false;
  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();
  const membership = await prisma.organizationMember.findFirst({
    where: { userId, organizationId },
    select: { id: true },
  });
  return Boolean(membership);
}

/**
 * Resolve the organization a billing action applies to.
 *
 * The session's own organization wins. A different `organizationId` is only
 * honoured when the signed-in user is a member of it; an anonymous caller
 * cannot name an organization at all.
 */
export async function resolveBillingOrganization(input: {
  userId: string | null | undefined;
  requestedOrganizationId?: string | null;
}): Promise<ResolvedBillingOrg> {
  const requested = input.requestedOrganizationId?.trim() || null;
  const userId =
    input.userId && input.userId !== "mock_user" ? input.userId : null;

  if (!userId) {
    if (requested) {
      return {
        ok: false,
        status: 401,
        error: "Sign in to manage billing for your organization.",
      };
    }
    return { ok: true, organizationId: null };
  }

  const scope = await resolveUserMailboxScope(userId);

  if (!requested || requested === scope?.organizationId) {
    return { ok: true, organizationId: scope?.organizationId ?? null };
  }

  if (await isOrganizationMember(userId, requested)) {
    return { ok: true, organizationId: requested };
  }

  return {
    ok: false,
    status: 403,
    error: "You do not have access to that organization.",
  };
}
