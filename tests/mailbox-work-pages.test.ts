import { beforeEach, describe, expect, it, vi } from "vitest";
import { speakDueLabel, toFollowUpItem } from "@/lib/follow-ups";
import { toTriageMessage } from "@/lib/inbox";
import { isRetentionProtected, toRetentionCandidate } from "@/lib/retention";

const db = vi.hoisted(() => ({
  mailbox: { findFirst: vi.fn() },
  message: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  draft: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  followUp: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  voiceProfile: { findUnique: vi.fn() },
  retentionPolicy: { findFirst: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));
vi.mock("@/lib/mail/tenant-context", () => ({
  resolveUserMailboxScope: vi.fn(),
}));
vi.mock("@/lib/db-node", () => ({
  getNodePrisma: () => db,
}));
vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ai/draft", () => ({
  generateDraft: vi.fn().mockResolvedValue({
    ok: true,
    stub: true,
    subject: "Re: Thursday confirmation",
    bodyText: "Thanks — Thursday works.",
  }),
}));

import { getCurrentUser } from "@/lib/auth";
import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";
import { GET as getInbox, PATCH as patchInbox } from "@/app/api/inbox/route";
import {
  GET as getDrafts,
  POST as postDrafts,
} from "@/app/api/drafts/route";
import { GET as getFollowUps } from "@/app/api/follow-ups/route";
import { GET as getRetention } from "@/app/api/retention/route";

const signedIn = {
  id: "user_1",
  email: "patron@gmail.com",
};

describe("live mailbox work pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUser).mockResolvedValue(signedIn);
    vi.mocked(resolveUserMailboxScope).mockResolvedValue({
      organizationId: "org_1",
      workspaceId: "workspace_1",
      userId: "user_1",
    });
    db.mailbox.findFirst.mockResolvedValue({ id: "mailbox_1" });
  });

  it("does not invent sample mail when no mailbox is connected", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const response = await getInbox();
    const data = await response.json();
    expect(data.mailboxConnected).toBe(false);
    expect(data.items).toEqual([]);
  });

  it("lists Primary messages and persists triage", async () => {
    db.message.findMany.mockResolvedValue([
      {
        id: "msg_1",
        organizationId: "org_1",
        workspaceId: "workspace_1",
        mailboxId: "mailbox_1",
        fromAddress: "jordan@client.com",
        subject: "Schedule confirmation",
        snippet: "Are we still on for Thursday?",
        bodyText: "Are we still on for Thursday?",
        categoryName: "PRIMARY",
        needsAttention: true,
        triageStatus: "NEW",
        receivedAt: new Date("2026-08-12T15:41:00-05:00"),
        metadata: { labelIds: ["INBOX", "CATEGORY_PERSONAL"] },
      },
    ]);
    const listed = await (await getInbox()).json();
    expect(listed.mailboxConnected).toBe(true);
    expect(listed.items[0].subject).toBe("Schedule confirmation");
    expect(listed.items[0].fromAddress).toBe("jordan@client.com");

    db.message.findFirst.mockResolvedValue({
      id: "msg_1",
      organizationId: "org_1",
      workspaceId: "workspace_1",
      mailboxId: "mailbox_1",
      fromAddress: "jordan@client.com",
      subject: "Schedule confirmation",
      snippet: "Are we still on for Thursday?",
      bodyText: "Are we still on for Thursday?",
      categoryName: "PRIMARY",
      needsAttention: true,
      triageStatus: "NEW",
      receivedAt: new Date("2026-08-12T15:41:00-05:00"),
      metadata: { labelIds: ["INBOX", "CATEGORY_PERSONAL"] },
    });
    db.message.updateMany.mockResolvedValue({ count: 1 });
    db.followUp.findFirst.mockResolvedValue(null);
    db.followUp.create.mockResolvedValue({ id: "fu_1" });

    const patched = await patchInbox(
      new Request("http://localhost/api/inbox", {
        method: "PATCH",
        body: JSON.stringify({ id: "msg_1", action: "defer" }),
      }),
    );
    const body = await patched.json();
    expect(patched.status).toBe(200);
    expect(body.item.status).toBe("DEFERRED");
    expect(db.followUp.create).toHaveBeenCalled();
  });

  it("creates a draft from a live message without sending", async () => {
    db.message.findFirst.mockResolvedValue({
      id: "msg_1",
      organizationId: "org_1",
      workspaceId: "workspace_1",
      mailboxId: "mailbox_1",
      fromAddress: "Jordan Lee <jordan@client.com>",
      subject: "Schedule confirmation",
      snippet: "Thursday?",
      bodyText: "Thursday?",
    });
    db.voiceProfile.findUnique.mockResolvedValue(null);
    db.draft.create.mockResolvedValue({
      id: "dr_1",
      organizationId: "org_1",
      workspaceId: "workspace_1",
      mailboxId: "mailbox_1",
      subject: "Re: Schedule confirmation",
      toAddresses: ["jordan@client.com"],
      bodyText: "Thanks — Thursday works.",
      status: "GENERATED",
    });
    const response = await postDrafts(
      new Request("http://localhost/api/drafts", {
        method: "POST",
        body: JSON.stringify({ messageId: "msg_1" }),
      }),
    );
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.spoken).toMatch(/Nothing was sent/i);
    expect(db.draft.create).toHaveBeenCalled();
  });

  it("returns empty drafts instead of fixtures", async () => {
    db.draft.findMany.mockResolvedValue([]);
    const data = await (await getDrafts()).json();
    expect(data.items).toEqual([]);
    expect(data.mailboxConnected).toBe(true);
  });

  it("lists follow-ups from the mailbox", async () => {
    db.followUp.findMany.mockResolvedValue([
      {
        id: "fu_1",
        organizationId: "org_1",
        workspaceId: "workspace_1",
        mailboxId: "mailbox_1",
        dueAt: new Date("2026-08-19T12:00:00Z"),
        note: "Deferred from Inbox.",
        completedAt: null,
        message: {
          subject: "Schedule confirmation",
          fromAddress: "jordan@client.com",
        },
      },
    ]);
    const data = await (await getFollowUps()).json();
    expect(data.items[0].subject).toBe("Schedule confirmation");
    expect(data.items[0].counterparty).toBe("jordan@client.com");
  });

  it("lists old mail for retention without deleting Gmail", async () => {
    db.retentionPolicy.findFirst.mockResolvedValue(null);
    db.message.findMany.mockResolvedValue([
      {
        id: "msg_old",
        organizationId: "org_1",
        workspaceId: "workspace_1",
        mailboxId: "mailbox_1",
        subject: "Weekly deals",
        categoryName: "PROMOTIONS",
        receivedAt: new Date("2026-01-01T00:00:00Z"),
        retentionDecision: null,
        fromAddress: "deals@store.com",
        snippet: "Unsubscribe",
        bodyText: null,
        metadata: { labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] },
      },
    ]);
    const data = await (await getRetention()).json();
    expect(data.items[0].subject).toBe("Weekly deals");
    expect(data.items[0].neverDelete).toBe(false);
  });
});

describe("work-page mappers", () => {
  it("maps a Primary row to a spoken triage item", () => {
    const item = toTriageMessage({
      id: "msg_1",
      organizationId: "org_1",
      workspaceId: "workspace_1",
      mailboxId: "mailbox_1",
      fromAddress: "jordan@client.com",
      subject: "Schedule confirmation",
      snippet: "Thursday?",
      categoryName: "PRIMARY",
      needsAttention: true,
      triageStatus: "NEW",
      receivedAt: new Date("2026-08-12T15:41:00-05:00"),
      metadata: { labelIds: ["INBOX", "CATEGORY_PERSONAL"] },
    });
    expect(item.category).toBe("PRIMARY");
    expect(item.needsAttention).toBe(true);
  });

  it("speaks follow-up due dates in words", () => {
    const now = new Date("2026-08-16T12:00:00Z");
    expect(speakDueLabel(new Date("2026-08-16T18:00:00Z"), now)).toBe("today");
    expect(speakDueLabel(new Date("2026-08-19T12:00:00Z"), now)).toBe("in 3 days");
  });

  it("protects Primary mail from retention trash", () => {
    expect(
      isRetentionProtected({
        fromAddress: "jordan@client.com",
        subject: "Schedule",
        categoryName: "PRIMARY",
        metadata: { labelIds: ["INBOX", "CATEGORY_PERSONAL"] },
      }),
    ).toBe(true);
    const candidate = toRetentionCandidate({
      id: "msg_1",
      organizationId: "org_1",
      workspaceId: "workspace_1",
      mailboxId: "mailbox_1",
      subject: "Schedule",
      categoryName: "PRIMARY",
      receivedAt: new Date("2025-01-01T00:00:00Z"),
      retentionDecision: null,
      fromAddress: "jordan@client.com",
      metadata: { labelIds: ["INBOX", "CATEGORY_PERSONAL"] },
    });
    expect(candidate.neverDelete).toBe(true);
  });

  it("maps an open follow-up to the list shape", () => {
    const item = toFollowUpItem({
      id: "fu_1",
      organizationId: "org_1",
      workspaceId: "workspace_1",
      mailboxId: "mailbox_1",
      dueAt: new Date("2026-08-16T12:00:00Z"),
      note: "Nudge",
      completedAt: null,
      message: {
        subject: "Schedule confirmation",
        fromAddress: "jordan@client.com",
      },
    }, new Date("2026-08-16T12:00:00Z"));
    expect(item.status).toBe("OPEN");
    expect(item.dueLabel).toBe("today");
  });
});
