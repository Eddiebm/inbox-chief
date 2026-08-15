import { tenantWhere, type TenantScope } from "@/lib/tenant";

export type ApprovalItem = {
  id: string;
  organizationId: string;
  workspaceId: string;
  mailboxId: string;
  subject: string;
  toAddresses: string[];
  bodyPreview: string;
  status: "AWAITING_APPROVAL" | "APPROVED" | "REJECTED" | "SENT";
};

/** Demo queue only — never personal production data */
export function demoApprovalQueue(scope: TenantScope): ApprovalItem[] {
  const items: ApprovalItem[] = [
    {
      id: "draft_demo_1",
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: scope.mailboxId ?? "demo_mb",
      subject: "Re: Schedule confirmation",
      toAddresses: ["colleague@example.com"],
      bodyPreview: "Thanks for the update. Thursday afternoon works on my side.",
      status: "AWAITING_APPROVAL",
    },
    {
      id: "draft_demo_2",
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      mailboxId: scope.mailboxId ?? "demo_mb",
      subject: "Re: Proposal question",
      toAddresses: ["client@example.com"],
      bodyPreview: "Happy to clarify the timeline. I can send details tomorrow.",
      status: "AWAITING_APPROVAL",
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
 * Hard rule: sending only happens after explicit APPROVE.
 * This helper never contacts Gmail — it only transitions state.
 */
export function applyApprovalDecision(
  item: ApprovalItem,
  decision: "approve" | "reject",
  scope: TenantScope,
): { item: ApprovalItem; spoken: string; maySend: boolean } {
  if (
    item.organizationId !== scope.organizationId ||
    item.workspaceId !== scope.workspaceId
  ) {
    throw new Error("Cross-tenant approval blocked");
  }

  if (decision === "reject") {
    return {
      item: { ...item, status: "REJECTED" },
      spoken: `Rejected draft: ${item.subject}. It will not be sent.`,
      maySend: false,
    };
  }

  return {
    item: { ...item, status: "APPROVED" },
    spoken: `Approved draft: ${item.subject}. Ready to send only after you confirm Send.`,
    maySend: false, // still requires a separate send confirmation step
  };
}

export function confirmSend(
  item: ApprovalItem,
  scope: TenantScope,
): { item: ApprovalItem; spoken: string } {
  if (
    item.organizationId !== scope.organizationId ||
    item.workspaceId !== scope.workspaceId
  ) {
    throw new Error("Cross-tenant send blocked");
  }
  if (item.status !== "APPROVED") {
    throw new Error("Send blocked: draft is not approved");
  }
  return {
    item: { ...item, status: "SENT" },
    spoken: `Sent to ${item.toAddresses.join(", ")}: ${item.subject}.`,
  };
}
