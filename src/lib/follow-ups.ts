import { tenantWhere, type TenantScope } from "@/lib/tenant";

export type FollowUpItem = {
  id: string;
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  subject: string;
  counterparty: string;
  dueLabel: string;
  note: string;
  status: "OPEN" | "COMPLETED" | "SNOOZED";
};

export function demoFollowUps(scope: TenantScope): FollowUpItem[] {
  const items: FollowUpItem[] = [
    {
      id: "fu_1",
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: scope.mailboxId ?? "demo_mb",
      subject: "Waiting on scheduling reply",
      counterparty: "colleague@example.com",
      dueLabel: "today",
      note: "Nudge if no reply by end of day.",
      status: "OPEN",
    },
    {
      id: "fu_2",
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: scope.mailboxId ?? "demo_mb",
      subject: "Invoice confirmation",
      counterparty: "billing@example.com",
      dueLabel: "in 2 days",
      note: "Confirm payment received before closing.",
      status: "OPEN",
    },
    {
      id: "fu_3",
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: scope.mailboxId ?? "demo_mb",
      subject: "Travel itinerary check",
      counterparty: "family@example.com",
      dueLabel: "in 5 days",
      note: "Confirm flight times.",
      status: "OPEN",
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

export function updateFollowUp(
  item: FollowUpItem,
  action: "complete" | "snooze",
  scope: TenantScope,
): { item: FollowUpItem; spoken: string } {
  if (
    item.organizationId !== scope.organizationId ||
    item.workspaceId !== scope.workspaceId
  ) {
    throw new Error("Cross-tenant follow-up blocked");
  }

  if (action === "complete") {
    return {
      item: { ...item, status: "COMPLETED" },
      spoken: `Marked complete: ${item.subject}.`,
    };
  }

  return {
    item: { ...item, status: "SNOOZED", dueLabel: "in 3 days" },
    spoken: `Snoozed: ${item.subject}. Reminder moved to 3 days from now.`,
  };
}
