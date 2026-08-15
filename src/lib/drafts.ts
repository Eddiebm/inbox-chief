import { tenantWhere, type TenantScope } from "@/lib/tenant";

export type DraftItem = {
  id: string;
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  subject: string;
  toAddresses: string[];
  bodyText: string;
  status: "GENERATED" | "EDITING" | "AWAITING_APPROVAL" | "DISCARDED";
};

export function demoDrafts(scope: TenantScope): DraftItem[] {
  const items: DraftItem[] = [
    {
      id: "dr_1",
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: scope.mailboxId ?? "demo_mb",
      subject: "Re: Quick question about the proposal",
      toAddresses: ["client@example.com"],
      bodyText:
        "Thanks for reaching out. Next week works on my side — does Tuesday or Wednesday afternoon suit you?",
      status: "GENERATED",
    },
    {
      id: "dr_2",
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: scope.mailboxId ?? "demo_mb",
      subject: "Re: Thursday confirmation",
      toAddresses: ["scheduler@example.com"],
      bodyText: "Confirmed for 2pm Thursday. Looking forward to it.",
      status: "EDITING",
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

export function updateDraft(
  item: DraftItem,
  action: "edit" | "request_approval" | "discard",
  scope: TenantScope,
  bodyText?: string,
): { item: DraftItem; spoken: string } {
  if (
    item.organizationId !== scope.organizationId ||
    item.workspaceId !== scope.workspaceId
  ) {
    throw new Error("Cross-tenant draft access blocked");
  }

  if (action === "discard") {
    return {
      item: { ...item, status: "DISCARDED" },
      spoken: `Discarded draft: ${item.subject}. It will not be sent.`,
    };
  }

  if (action === "edit") {
    return {
      item: {
        ...item,
        bodyText: bodyText ?? item.bodyText,
        status: "EDITING",
      },
      spoken: `Draft updated: ${item.subject}.`,
    };
  }

  return {
    item: { ...item, status: "AWAITING_APPROVAL" },
    spoken: `Sent to approvals: ${item.subject}. Nothing leaves the mailbox until you approve and confirm send.`,
  };
}
