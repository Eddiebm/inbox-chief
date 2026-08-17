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

export const FOLLOW_UP_SNOOZE_DAYS = 3;

export function speakDueLabel(dueAt: Date, now = new Date()): string {
  const days = Math.round((dueAt.getTime() - now.getTime()) / 86_400_000);
  if (days <= -2) return `overdue by ${Math.abs(days)} days`;
  if (days === -1) return "overdue by 1 day";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export function toFollowUpItem(
  row: {
    id: string;
    organizationId: string;
    workspaceId: string;
    mailboxId: string;
    dueAt: Date;
    note: string | null;
    completedAt: Date | null;
    message: {
      subject: string;
      fromAddress: string;
    } | null;
  },
  now = new Date(),
): FollowUpItem {
  const snoozed =
    !row.completedAt && row.dueAt.getTime() - now.getTime() > 86_400_000;
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    mailboxId: row.mailboxId,
    subject: row.message?.subject ?? "Follow-up",
    counterparty: row.message?.fromAddress ?? "unknown sender",
    dueLabel: speakDueLabel(row.dueAt, now),
    note: row.note ?? "",
    status: row.completedAt ? "COMPLETED" : snoozed ? "SNOOZED" : "OPEN",
  };
}

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
