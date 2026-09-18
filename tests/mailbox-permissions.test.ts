import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mailboxPermissionFindFirst: vi.fn(),
}));

vi.mock("@/lib/db-node", () => ({
  getNodePrisma: () => ({
    mailboxPermission: { findFirst: mocks.mailboxPermissionFindFirst },
  }),
}));

import { hasMailboxPermission, requireMailboxPermission } from "@/lib/mailbox-permissions";

const scope = {
  organizationId: "org_1",
  workspaceId: "ws_1",
  mailboxId: "mb_1",
  userId: "user_delegate",
};

describe("hasMailboxPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("always grants the mailbox owner, without querying the grant table", async () => {
    const allowed = await hasMailboxPermission({
      ...scope,
      userId: "user_owner",
      ownerId: "user_owner",
      permission: "approve_messages",
    });
    expect(allowed).toBe(true);
    expect(mocks.mailboxPermissionFindFirst).not.toHaveBeenCalled();
  });

  it("denies a non-owner with no MailboxPermission row", async () => {
    mocks.mailboxPermissionFindFirst.mockResolvedValue(null);
    const allowed = await hasMailboxPermission({
      ...scope,
      ownerId: "user_owner",
      permission: "approve_messages",
    });
    expect(allowed).toBe(false);
  });

  it("grants a non-owner with a live MailboxPermission row scoped to this mailbox", async () => {
    mocks.mailboxPermissionFindFirst.mockResolvedValue({ id: "grant_1" });
    const allowed = await hasMailboxPermission({
      ...scope,
      ownerId: "user_owner",
      permission: "approve_messages",
    });
    expect(allowed).toBe(true);
    expect(mocks.mailboxPermissionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org_1",
          workspaceId: "ws_1",
          mailboxId: "mb_1",
          userId: "user_delegate",
          permission: { key: "approve_messages" },
        }),
      }),
    );
  });

  it("never grants access based on an organization-scoped permission key", async () => {
    // manage_billing is not mailbox-scoped — never checked against MailboxPermission
    const allowed = await hasMailboxPermission({
      ...scope,
      ownerId: "user_owner",
      permission: "manage_billing",
    });
    expect(allowed).toBe(false);
    expect(mocks.mailboxPermissionFindFirst).not.toHaveBeenCalled();
  });

  it("requireMailboxPermission throws permission_denied when the check fails", async () => {
    mocks.mailboxPermissionFindFirst.mockResolvedValue(null);
    await expect(
      requireMailboxPermission({
        ...scope,
        ownerId: "user_owner",
        permission: "send_approved_messages",
      }),
    ).rejects.toThrow("permission_denied");
  });

  it("requireMailboxPermission resolves silently when the check passes", async () => {
    mocks.mailboxPermissionFindFirst.mockResolvedValue({ id: "grant_1" });
    await expect(
      requireMailboxPermission({
        ...scope,
        ownerId: "user_owner",
        permission: "send_approved_messages",
      }),
    ).resolves.toBeUndefined();
  });
});
