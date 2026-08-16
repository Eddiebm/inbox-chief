import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: "user_1" }),
}));
vi.mock("@/lib/mail/tenant-context", () => ({
  resolveUserMailboxScope: vi.fn().mockResolvedValue({
    organizationId: "org_1",
    workspaceId: "workspace_1",
  }),
}));
vi.mock("@/lib/gmail/config", () => ({
  getGmailOAuthConfig: vi.fn().mockReturnValue({ ok: true }),
}));
vi.mock("@/lib/outlook/config", () => ({
  getOutlookOAuthConfig: vi.fn().mockReturnValue({ ok: false, reason: "missing" }),
}));
vi.mock("@/lib/db-node", () => ({
  getNodePrisma: () => ({
    mailbox: { findMany: mocks.findMany },
  }),
}));

import { GET } from "@/app/api/mail/status/route";

describe("mail status reconnect UI data", () => {
  const previousPublished = process.env.GOOGLE_OAUTH_PUBLISHED;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_OAUTH_PUBLISHED = "false";
    mocks.findMany.mockResolvedValue([
      {
        id: "mailbox_1",
        emailAddress: "patron@gmail.com",
        provider: "gmail",
        connectionStatus: "error",
        lastSyncedAt: null,
        oauthToken: { id: "token_1" },
        imapCredentials: null,
      },
    ]);
  });

  afterEach(() => {
    if (previousPublished === undefined) {
      delete process.env.GOOGLE_OAUTH_PUBLISHED;
    } else {
      process.env.GOOGLE_OAUTH_PUBLISHED = previousPublished;
    }
  });

  it("returns an errored Gmail mailbox so Settings can offer reconnect", async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.connected).toBe(false);
    expect(data.mailboxes).toEqual([
      expect.objectContaining({
        id: "mailbox_1",
        connectionStatus: "error",
      }),
    ]);
    expect(data.oauth.googleOauthPublished).toBe(false);
  });

  it("removes testing guidance signal when the server flag flips", async () => {
    process.env.GOOGLE_OAUTH_PUBLISHED = "true";
    const response = await GET();
    const data = await response.json();
    expect(data.oauth.googleOauthPublished).toBe(true);
  });
});
