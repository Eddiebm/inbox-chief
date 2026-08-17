import { isPrimaryInboxMessage } from "@/lib/call-in/primary-inbox";
import { tenantWhere, type TenantScope } from "@/lib/tenant";

export type TriageMessage = {
  id: string;
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  fromAddress: string;
  subject: string;
  snippet: string;
  category: string;
  needsAttention: boolean;
  status: "NEW" | "TRIAGED" | "DEFERRED" | "ARCHIVED";
  /** ISO received time — spoken when selecting a message; never invented */
  receivedAt?: string | null;
};

export function demoInbox(scope: TenantScope): TriageMessage[] {
  const items: TriageMessage[] = [
    {
      id: "msg_1",
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: scope.mailboxId ?? "demo_mb",
      fromAddress: "client@example.com",
      subject: "Quick question about the proposal",
      snippet: "Can we move the kickoff to next week?",
      category: "Needs Reply",
      needsAttention: true,
      status: "NEW",
      receivedAt: "2026-08-12T15:41:00-05:00",
    },
    {
      id: "msg_2",
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: scope.mailboxId ?? "demo_mb",
      fromAddress: "scheduler@example.com",
      subject: "Thursday confirmation",
      snippet: "Please confirm 2pm still works.",
      category: "Scheduling",
      needsAttention: true,
      status: "NEW",
      receivedAt: "2026-08-11T10:15:00-05:00",
    },
    {
      id: "msg_3",
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: scope.mailboxId ?? "demo_mb",
      fromAddress: "news@example.com",
      subject: "This week in industry news",
      snippet: "Top stories and links inside.",
      category: "Newsletters",
      needsAttention: false,
      status: "NEW",
      receivedAt: "2026-08-10T09:00:00-05:00",
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

export function triageMessage(
  item: TriageMessage,
  action: "mark_triaged" | "defer" | "archive",
  scope: TenantScope,
): { item: TriageMessage; spoken: string } {
  if (
    item.organizationId !== scope.organizationId ||
    item.workspaceId !== scope.workspaceId
  ) {
    throw new Error("Cross-tenant inbox access blocked");
  }

  if (action === "mark_triaged") {
    return {
      item: { ...item, status: "TRIAGED", needsAttention: false },
      spoken: `Triaged: ${item.subject}. Category ${item.category}.`,
    };
  }
  if (action === "defer") {
    return {
      item: { ...item, status: "DEFERRED" },
      spoken: `Deferred: ${item.subject}. A follow-up reminder is due in 3 days.`,
    };
  }
  return {
    item: { ...item, status: "ARCHIVED", needsAttention: false },
    spoken: `Archived in Inbox Chief: ${item.subject}. Gmail is unchanged.`,
  };
}

export function toTriageMessage(row: {
  id: string;
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  fromAddress: string;
  subject: string;
  snippet: string | null;
  categoryName: string | null;
  needsAttention: boolean;
  triageStatus: TriageMessage["status"];
  receivedAt: Date;
  bodyText?: string | null;
  metadata?: unknown;
}): TriageMessage {
  const category =
    row.categoryName?.trim() ||
    (isPrimaryInboxMessage(row) ? "Primary" : "Other");
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    mailboxId: row.mailboxId,
    fromAddress: row.fromAddress,
    subject: row.subject,
    snippet: (row.snippet ?? row.bodyText ?? "").slice(0, 280),
    category,
    needsAttention: row.needsAttention && row.triageStatus === "NEW",
    status: row.triageStatus,
    receivedAt: row.receivedAt.toISOString(),
  };
}
