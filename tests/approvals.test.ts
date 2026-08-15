import { describe, expect, it } from "vitest";
import {
  applyApprovalDecision,
  confirmSend,
  demoApprovalQueue,
} from "@/lib/approvals";

const scope = {
  organizationId: "demo_org",
  workspaceId: "demo_ws",
  mailboxId: "demo_mb",
  userId: "u1",
};

describe("approval before send", () => {
  it("does not allow send until approved", () => {
    const [draft] = demoApprovalQueue(scope);
    expect(draft).toBeTruthy();
    expect(() => confirmSend(draft!, scope)).toThrow(/not approved/i);
  });

  it("requires a separate confirm send after approve", () => {
    const [draft] = demoApprovalQueue(scope);
    const approved = applyApprovalDecision(draft!, "approve", scope);
    expect(approved.maySend).toBe(false);
    expect(approved.item.status).toBe("APPROVED");
    const sent = confirmSend(approved.item, scope);
    expect(sent.item.status).toBe("SENT");
  });

  it("blocks cross-tenant approval", () => {
    const [draft] = demoApprovalQueue(scope);
    expect(() =>
      applyApprovalDecision(draft!, "approve", {
        ...scope,
        organizationId: "other_org",
      }),
    ).toThrow(/cross-tenant/i);
  });
});
