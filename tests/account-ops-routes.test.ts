import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  dataExportRequest: {
    create: vi.fn(),
    update: vi.fn(),
  },
  organizationMember: {
    findFirst: vi.fn(),
  },
  accountDeletionRequest: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  mailbox: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  mailboxOAuthToken: { deleteMany: vi.fn() },
  mailboxImapCredentials: { deleteMany: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({
    id: "user_1",
    email: "patron@gmail.com",
  }),
}));
vi.mock("@/lib/mail/tenant-context", () => ({
  resolveUserMailboxScope: vi.fn().mockResolvedValue({
    organizationId: "org_1",
    workspaceId: "workspace_1",
  }),
}));
vi.mock("@/lib/db-node", () => ({
  getNodePrisma: () => db,
}));
vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/gmail/tokens", () => ({
  getDecryptedMailboxTokensForTenant: vi.fn().mockResolvedValue(null),
}));

import {
  DELETE as cancelDeletion,
  GET as getDeletion,
  POST as scheduleDeletion,
} from "@/app/api/account/delete/route";
import { POST as requestExport } from "@/app/api/account/export/route";
import { DELETE as disconnectMailbox } from "@/app/api/mail/disconnect/route";

describe("one-button account operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockResolvedValue([]);
    db.dataExportRequest.create.mockResolvedValue({ id: "export_1" });
    db.dataExportRequest.update.mockResolvedValue({ id: "export_1" });
    db.organizationMember.findFirst.mockResolvedValue({ id: "membership_1" });
    db.accountDeletionRequest.findFirst.mockResolvedValue(null);
    db.accountDeletionRequest.create.mockResolvedValue({ id: "deletion_1" });
    db.accountDeletionRequest.updateMany.mockResolvedValue({ count: 1 });
    db.mailbox.findFirst.mockResolvedValue({
      id: "mailbox_1",
      emailAddress: "patron@gmail.com",
      provider: "gmail",
    });
  });

  it("creates an immediately downloadable export", async () => {
    const response = await requestExport();
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.downloadUrl).toBe("/api/account/export/export_1");
  });

  it("schedules deletion without form jargon and can cancel it", async () => {
    const scheduled = await scheduleDeletion(
      new Request("https://inbox-chief.test/api/account/delete", {
        method: "POST",
      }),
    );
    expect((await scheduled.json()).ok).toBe(true);

    db.accountDeletionRequest.findFirst.mockResolvedValue({
      id: "deletion_1",
      coolOffEndsAt: new Date("2026-08-22T12:00:00.000Z"),
    });
    const status = await getDeletion();
    expect(await status.json()).toMatchObject({ ok: true, scheduled: true });

    const canceled = await cancelDeletion();
    expect(await canceled.json()).toMatchObject({ ok: true });
    expect(db.accountDeletionRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "CANCELED" },
      }),
    );
  });

  it("disconnects only the signed-in patron's mailbox", async () => {
    const response = await disconnectMailbox(
      new Request("https://inbox-chief.test/api/mail/disconnect", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailboxId: "mailbox_1" }),
      }),
    );
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.message).toMatch(/disconnected/i);
    expect(db.mailbox.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "mailbox_1",
          organizationId: "org_1",
          ownerId: "user_1",
        }),
      }),
    );
  });
});
