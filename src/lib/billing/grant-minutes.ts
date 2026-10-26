/**
 * Operator-granted prepaid call minutes (no Stripe).
 *
 * Credits CallMinuteBalance and records a CallMinutePackPurchase audit row
 * with packId `operator_grant` and amountUsdCents 0.
 */

import { writeAuditLog } from "@/lib/audit";

export type GrantOperatorMinutesResult =
  | {
      granted: true;
      organizationId: string;
      minutes: number;
      purchasedMinutesBefore: number;
      purchasedMinutesRemaining: number;
      purchaseId: string;
      idempotent: boolean;
    }
  | { granted: false; reason: string };

export type ResolveOrgForGrantInput = {
  email?: string;
  phone?: string;
  mailbox?: string;
  organizationId?: string;
};

export type ResolveOrgForGrantResult =
  | {
      found: true;
      organizationId: string;
      organizationName: string;
      workspaceId: string;
      label: string;
    }
  | { found: false; reason: string };

function roundMinutes(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Resolve an organization for an operator grant by explicit id, patron email,
 * call-in phone, or connected mailbox address.
 */
export async function resolveOrgForGrant(
  input: ResolveOrgForGrantInput,
): Promise<ResolveOrgForGrantResult> {
  if (!process.env.DATABASE_URL) {
    return { found: false, reason: "no_database" };
  }

  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();

  let organizationId = input.organizationId?.trim() || null;
  let label =
    input.email ?? input.phone ?? input.mailbox ?? input.organizationId ?? "";

  if (!organizationId && input.email) {
    const user = await prisma.user.findFirst({
      where: { email: { equals: input.email.trim(), mode: "insensitive" } },
      include: { memberships: { take: 1 } },
    });
    organizationId = user?.memberships[0]?.organizationId ?? null;
    if (user) label = user.email;
  }

  if (!organizationId && input.phone) {
    const identity = await prisma.callInIdentity.findFirst({
      where: { phoneE164: input.phone.trim() },
      select: { organizationId: true, phoneE164: true },
    });
    organizationId = identity?.organizationId ?? null;
    if (identity) label = identity.phoneE164;
  }

  if (!organizationId && input.mailbox) {
    const mailbox = await prisma.mailbox.findFirst({
      where: {
        emailAddress: { equals: input.mailbox.trim(), mode: "insensitive" },
      },
      select: {
        emailAddress: true,
        workspace: { select: { organizationId: true } },
      },
    });
    organizationId = mailbox?.workspace.organizationId ?? null;
    if (mailbox) label = mailbox.emailAddress;
  }

  if (!organizationId) {
    return { found: false, reason: "organization_not_found" };
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      workspaces: { take: 1, select: { id: true } },
    },
  });

  if (!org) {
    return { found: false, reason: "organization_not_found" };
  }

  const workspaceId = org.workspaces[0]?.id;
  if (!workspaceId) {
    return { found: false, reason: "no_workspace" };
  }

  return {
    found: true,
    organizationId: org.id,
    organizationName: org.name,
    workspaceId,
    label,
  };
}

/**
 * Credit prepaid minutes without Stripe. Idempotent when idempotencyKey is set
 * (stored on CallMinutePackPurchase.stripeCheckoutSessionId).
 */
export async function grantOperatorMinutes(input: {
  organizationId: string;
  minutes: number;
  grantedBy?: string | null;
  reason?: string | null;
  idempotencyKey?: string | null;
  workspaceId?: string | null;
  actorId?: string | null;
}): Promise<GrantOperatorMinutesResult> {
  const minutes = Math.round(input.minutes);
  if (!input.organizationId) {
    return { granted: false, reason: "no_organization" };
  }
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return { granted: false, reason: "invalid_minutes" };
  }
  if (!process.env.DATABASE_URL) {
    return { granted: false, reason: "no_database" };
  }

  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();

  const idempotencySessionId = input.idempotencyKey
    ? `operator_grant:${input.idempotencyKey}`
    : null;

  if (idempotencySessionId) {
    const existing = await prisma.callMinutePackPurchase.findUnique({
      where: { stripeCheckoutSessionId: idempotencySessionId },
    });
    if (existing) {
      const balance = await prisma.callMinuteBalance.findUnique({
        where: { organizationId: input.organizationId },
      });
      return {
        granted: true,
        organizationId: input.organizationId,
        minutes: existing.minutesCredited,
        purchasedMinutesBefore: roundMinutes(
          (balance?.purchasedMinutesRemaining ?? 0) -
            existing.minutesCredited,
        ),
        purchasedMinutesRemaining:
          balance?.purchasedMinutesRemaining ?? existing.minutesCredited,
        purchaseId: existing.id,
        idempotent: true,
      };
    }
  }

  const existingBalance = await prisma.callMinuteBalance.findUnique({
    where: { organizationId: input.organizationId },
  });
  const purchasedMinutesBefore =
    existingBalance?.purchasedMinutesRemaining ?? 0;

  const result = await prisma.$transaction(async (tx) => {
    const balance = await tx.callMinuteBalance.upsert({
      where: { organizationId: input.organizationId },
      create: {
        organizationId: input.organizationId,
        purchasedMinutesRemaining: minutes,
        purchasedMinutesLifetime: minutes,
      },
      update: {
        purchasedMinutesRemaining: { increment: minutes },
        purchasedMinutesLifetime: { increment: minutes },
      },
    });

    const purchase = await tx.callMinutePackPurchase.create({
      data: {
        organizationId: input.organizationId,
        balanceId: balance.id,
        packId: "operator_grant",
        minutesCredited: minutes,
        amountUsdCents: 0,
        stripeCheckoutSessionId: idempotencySessionId,
        stripePaymentIntentId: null,
      },
    });

    return { balance, purchase };
  });

  let workspaceId = input.workspaceId ?? null;
  if (!workspaceId) {
    const workspace = await prisma.workspace.findFirst({
      where: { organizationId: input.organizationId },
      select: { id: true },
    });
    workspaceId = workspace?.id ?? null;
  }

  if (workspaceId) {
    const summaryParts = [
      `Operator granted ${minutes} prepaid call minutes`,
      input.grantedBy ? `(by ${input.grantedBy})` : null,
      input.reason ? `— ${input.reason}` : null,
    ].filter(Boolean);

    await writeAuditLog({
      organizationId: input.organizationId,
      workspaceId,
      actorId: input.actorId ?? null,
      action: "MANAGE_BILLING",
      summary: summaryParts.join(" "),
      resourceType: "CallMinutePackPurchase",
      resourceId: result.purchase.id,
      metadata: {
        kind: "operator_grant",
        minutes,
        purchasedMinutesBefore,
        purchasedMinutesRemaining: result.balance.purchasedMinutesRemaining,
        grantedBy: input.grantedBy ?? null,
        reason: input.reason ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
  }

  return {
    granted: true,
    organizationId: input.organizationId,
    minutes,
    purchasedMinutesBefore: roundMinutes(purchasedMinutesBefore),
    purchasedMinutesRemaining: result.balance.purchasedMinutesRemaining,
    purchaseId: result.purchase.id,
    idempotent: false,
  };
}
