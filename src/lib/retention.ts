import { isPrimaryInboxMessage } from "@/lib/call-in/primary-inbox";
import { tenantWhere, type TenantScope } from "@/lib/tenant";

export const DEFAULT_RETAIN_DAYS = 90;

const PROTECTED_CATEGORY_NAMES = new Set([
  "PRIMARY",
  "PERSONAL",
  "LEGAL",
  "MEDICAL",
  "FINANCIAL",
  "FAMILY",
]);

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
    spoken: `Approved for Trash: ${item.subject}. Inbox Chief does not delete Gmail.`,
  };
}

export function isRetentionProtected(row: {
  fromAddress: string;
  subject?: string | null;
  snippet?: string | null;
  bodyText?: string | null;
  categoryName?: string | null;
  metadata?: unknown;
}): boolean {
  if (isPrimaryInboxMessage(row)) return true;
  const name = (row.categoryName ?? "").trim().toUpperCase();
  return PROTECTED_CATEGORY_NAMES.has(name);
}

export function toRetentionCandidate(
  row: {
    id: string;
    organizationId: string;
    workspaceId: string;
    mailboxId: string;
    subject: string;
    categoryName: string | null;
    receivedAt: Date;
    retentionDecision: RetentionCandidate["status"] | null;
    fromAddress: string;
    snippet?: string | null;
    bodyText?: string | null;
    metadata?: unknown;
  },
  now = new Date(),
): RetentionCandidate {
  const ageDays = Math.max(
    0,
    Math.floor((now.getTime() - row.receivedAt.getTime()) / 86_400_000),
  );
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    mailboxId: row.mailboxId,
    subject: row.subject,
    category: row.categoryName?.trim() || "Other",
    ageDays,
    neverDelete: isRetentionProtected(row),
    status: row.retentionDecision ?? "CANDIDATE",
  };
}
