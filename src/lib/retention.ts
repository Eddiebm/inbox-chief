import { tenantWhere, type TenantScope } from "@/lib/tenant";

export type RetentionCandidate = {
  id: string;
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  subject: string;
  category: string;
  ageDays: number;
  neverDelete: boolean;
  status: "CANDIDATE" | "KEPT" | "TRASH_APPROVED";
};

export function demoRetentionCandidates(scope: TenantScope): RetentionCandidate[] {
  const items: RetentionCandidate[] = [
    {
      id: "ret_1",
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: scope.mailboxId ?? "demo_mb",
      subject: "Weekly newsletter digest",
      category: "Newsletters",
      ageDays: 120,
      neverDelete: false,
      status: "CANDIDATE",
    },
    {
      id: "ret_2",
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: scope.mailboxId ?? "demo_mb",
      subject: "Store receipt — office supplies",
      category: "Receipts",
      ageDays: 95,
      neverDelete: false,
      status: "CANDIDATE",
    },
    {
      id: "ret_3",
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: scope.mailboxId ?? "demo_mb",
      subject: "Signed agreement copy",
      category: "Legal",
      ageDays: 400,
      neverDelete: true,
      status: "CANDIDATE",
    },
  ];

  return items.filter((item) => {
    const where = tenantWhere(scope);
    return (
      item.organizationId === where.organizationId &&
      item.workspaceId === where.workspaceId
    );
  });
}

/**
 * Retention actions always require human review.
 * neverDelete categories cannot move to trash.
 */
export function decideRetention(
  item: RetentionCandidate,
  decision: "keep" | "approve_trash",
  scope: TenantScope,
): { item: RetentionCandidate; spoken: string } {
  if (
    item.organizationId !== scope.organizationId ||
    item.workspaceId !== scope.workspaceId
  ) {
    throw new Error("Cross-tenant retention blocked");
  }

  if (decision === "keep") {
    return {
      item: { ...item, status: "KEPT" },
      spoken: `Kept: ${item.subject}. It will not be deleted.`,
    };
  }

  if (item.neverDelete) {
    throw new Error(
      `Cannot trash “${item.subject}”: category ${item.category} is protected.`,
    );
  }

  return {
    item: { ...item, status: "TRASH_APPROVED" },
    spoken: `Approved for Trash: ${item.subject}. Move to Trash only after you confirm in Gmail sync.`,
  };
}
