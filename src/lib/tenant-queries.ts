import { assertTenantMatch, tenantWhere, TenantAccessError, type TenantScope } from "@/lib/tenant";
import { ROLES } from "@/lib/rbac";

/**
 * Simulated repository gate used by API routes and jobs.
 * Always filters by tenant ids before returning records.
 */
export function getMessagesForTenant(scope: TenantScope, messages: Array<{
  id: string;
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  subject: string;
}>) {
  const where = tenantWhere(scope);
  return messages.filter((m) => {
    try {
      assertTenantMatch(scope, m);
      if (scope.mailboxId && m.mailboxId !== scope.mailboxId) return false;
      return (
        m.organizationId === where.organizationId &&
        m.workspaceId === where.workspaceId
      );
    } catch (e) {
      if (e instanceof TenantAccessError) return false;
      throw e;
    }
  });
}

export function technicalAdminHasAutomaticMailboxAccess() {
  const role = ROLES.find((r) => r.key === "technical_administrator");
  return role?.grantsMailboxAccessByDefault ?? true;
}
