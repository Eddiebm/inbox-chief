import type { AuditAction, Prisma } from "@/generated/prisma/client";

export type WriteAuditLogInput = {
  organizationId: string;
  workspaceId: string;
  mailboxId?: string | null;
  actorId?: string | null;
  action: AuditAction;
  summary: string;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
};

/**
 * Persist an audit event. organizationId and workspaceId are required —
 * never write unscoped audit rows.
 */
export async function writeAuditLog(input: WriteAuditLogInput) {
  if (!input.organizationId || !input.workspaceId) {
    throw new Error("writeAuditLog requires organizationId and workspaceId");
  }

  if (process.env.MOCK_INTEGRATIONS === "true") {
    return {
      id: `mock_audit_${Date.now()}`,
      ...input,
      createdAt: new Date(),
    };
  }

  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();
  return prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      mailboxId: input.mailboxId ?? null,
      actorId: input.actorId ?? null,
      action: input.action,
      summary: input.summary,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      metadata: input.metadata ?? undefined,
    },
  });
}
