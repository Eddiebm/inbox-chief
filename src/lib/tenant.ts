/**
 * Tenant context required on every data access path.
 * Technical admins do not automatically receive mailbox scope.
 */
export type TenantScope = {
  organizationId: string;
  workspaceId: string;
  mailboxId?: string;
  userId: string;
};

export class TenantAccessError extends Error {
  constructor(message = "Cross-tenant access denied") {
    super(message);
    this.name = "TenantAccessError";
  }
}

export function assertTenantMatch(
  scope: TenantScope,
  record: {
    organizationId: string;
    workspaceId?: string | null;
    mailboxId?: string | null;
  },
): void {
  if (record.organizationId !== scope.organizationId) {
    throw new TenantAccessError("Organization mismatch");
  }
  if (
    record.workspaceId != null &&
    scope.workspaceId &&
    record.workspaceId !== scope.workspaceId
  ) {
    throw new TenantAccessError("Workspace mismatch");
  }
  if (
    record.mailboxId != null &&
    scope.mailboxId &&
    record.mailboxId !== scope.mailboxId
  ) {
    throw new TenantAccessError("Mailbox mismatch");
  }
}

/** Always include tenant ids in Prisma where clauses */
export function tenantWhere(scope: TenantScope, extra: Record<string, unknown> = {}) {
  return {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    ...(scope.mailboxId ? { mailboxId: scope.mailboxId } : {}),
    ...extra,
  };
}

export function mailboxTenantWhere(scope: Required<Pick<TenantScope, "organizationId" | "workspaceId" | "mailboxId">> & { userId: string }, extra: Record<string, unknown> = {}) {
  return {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    mailboxId: scope.mailboxId,
    ...extra,
  };
}
