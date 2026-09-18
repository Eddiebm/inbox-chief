import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  resolveUserGmailScope: vi.fn(),
  mailboxFindFirst: vi.fn(),
  draftFindMany: vi.fn(),
  draftUpdateMany: vi.fn(),
  mailboxPermissionFindFirst: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));

vi.mock("@/lib/gmail/tenant-context", () => ({
  resolveUserGmailScope: mocks.resolveUserGmailScope,
}));

vi.mock("@/lib/db-node", () => ({
  getNodePrisma: () => ({
    mailbox: { findFirst: mocks.mailboxFindFirst },
    draft: { findMany: mocks.draftFindMany, updateMany: mocks.draftUpdateMany },
    mailboxPermission: { findFirst: mocks.mailboxPermissionFindFirst },
  }),
}));

vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));

// The confirm_send action delegates to sendApprovedDraft, which needs a much
// larger Gmail-side dependency graph. It is covered separately; here we only
// need it to not blow up when action !== "confirm_send".
vi.mock("@/lib/email-send", () => ({
  sendApprovedDraft: vi.fn().mockRejectedValue(new Error("not_exercised")),
}));

import { PATCH } from "@/app/api/approvals/route";

const OWNER_ID = "user_owner";
const DELEGATE_ID = "user_delegate";
const OUTSIDER_ID = "user_outsider";
const MAILBOX_ID = "mb_1";

function patchRequest(body: unknown) {
  return new Request("https://inboxchief.email/api/approvals", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("approvals route — owner vs delegated approve_messages permission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveUserGmailScope.mockResolvedValue({
      organizationId: "org_1",
      workspaceId: "ws_1",
      userId: undefined,
    });
    mocks.draftUpdateMany.mockResolvedValue({ count: 1 });
    mocks.writeAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("still lets the mailbox owner approve (safe-by-default behavior is unchanged)", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: OWNER_ID, email: "owner@example.com" });
    mocks.mailboxFindFirst.mockResolvedValue({ id: MAILBOX_ID, ownerId: OWNER_ID });

    const response = await PATCH(patchRequest({ id: "draft_1", action: "approve" }));
    expect(response.status).toBe(200);
    expect(mocks.mailboxPermissionFindFirst).not.toHaveBeenCalled();
    expect(mocks.draftUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "APPROVED", approvedById: OWNER_ID }),
      }),
    );
  });

  it("blocks a user without an approve_messages grant, even if they can reach the mailbox", async () => {
    // Not the owner; context() only finds this mailbox because of a
    // send_approved_messages grant (not approve_messages).
    mocks.getCurrentUser.mockResolvedValue({ id: DELEGATE_ID, email: "delegate@example.com" });
    mocks.mailboxFindFirst.mockResolvedValue({ id: MAILBOX_ID, ownerId: OWNER_ID });
    mocks.mailboxPermissionFindFirst.mockResolvedValue(null);

    const response = await PATCH(patchRequest({ id: "draft_1", action: "approve" }));
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json).toEqual({ ok: false, message: "permission_denied" });
    expect(mocks.draftUpdateMany).not.toHaveBeenCalled();
  });

  it("lets a non-owner delegate with a live approve_messages grant approve", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: DELEGATE_ID, email: "delegate@example.com" });
    mocks.mailboxFindFirst.mockResolvedValue({ id: MAILBOX_ID, ownerId: OWNER_ID });
    mocks.mailboxPermissionFindFirst.mockResolvedValue({ id: "grant_1" });

    const response = await PATCH(patchRequest({ id: "draft_1", action: "approve" }));
    expect(response.status).toBe(200);
    expect(mocks.mailboxPermissionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: DELEGATE_ID,
          mailboxId: MAILBOX_ID,
          permission: { key: "approve_messages" },
        }),
      }),
    );
    expect(mocks.draftUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "APPROVED", approvedById: DELEGATE_ID }),
      }),
    );
  });

  it("never lets an unrelated user reach the mailbox at all (no owner match, no grant)", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: OUTSIDER_ID, email: "outsider@example.com" });
    // Simulates the Prisma OR filter finding nothing for this user.
    mocks.mailboxFindFirst.mockResolvedValue(null);

    const response = await PATCH(patchRequest({ id: "draft_1", action: "approve" }));
    expect(response.status).toBe(401);
    expect(mocks.draftUpdateMany).not.toHaveBeenCalled();
  });
});
