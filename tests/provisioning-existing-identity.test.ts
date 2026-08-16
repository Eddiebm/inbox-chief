import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  callInIdentity: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  provisioningRequest: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  mailbox: {
    findFirst: vi.fn(),
  },
}));

vi.mock("@/lib/db-node", () => ({
  getNodePrisma: () => prisma,
}));

import { provisionSignup } from "@/lib/provisioning";

describe("provisionSignup existing identity handoff", () => {
  const previousAuthSecret = process.env.AUTH_SECRET;
  const previousPublished = process.env.GOOGLE_OAUTH_PUBLISHED;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = "existing-identity-test-secret";
    process.env.GOOGLE_OAUTH_PUBLISHED = "false";
  });

  afterEach(() => {
    if (previousAuthSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousAuthSecret;
    if (previousPublished === undefined) {
      delete process.env.GOOGLE_OAUTH_PUBLISHED;
    } else {
      process.env.GOOGLE_OAUTH_PUBLISHED = previousPublished;
    }
  });

  it("creates a fresh handoff instead of rejecting the existing email", async () => {
    const identity = {
      id: "identity_1",
      organizationId: "org_1",
      workspaceId: "workspace_1",
      userId: "user_1",
      mailboxId: null,
      phoneE164: "+14055550123",
    };
    prisma.callInIdentity.findFirst.mockResolvedValue(identity);
    prisma.user.findUnique.mockResolvedValue({ email: "patron@gmail.com" });
    prisma.provisioningRequest.findUnique.mockResolvedValue(null);
    prisma.mailbox.findFirst.mockResolvedValue(null);
    prisma.provisioningRequest.upsert.mockImplementation(
      async ({ create }: { create: Record<string, unknown> }) => ({
        id: "provision_1",
        ...create,
        provisionedReady: false,
      }),
    );

    const result = await provisionSignup({
      gmail: "patron@gmail.com",
      phoneE164: "+1 (405) 555-0123",
    });

    expect(result.created).toBe(false);
    expect(result.status).toBe("needs_google_test_user");
    expect(result.magicLink).toMatch(/\/api\/provision\/connect\?token=/);
    expect(result.provisionUrl).toMatch(/\/provision\/[A-Z2-9]{8}$/);
    expect(prisma.provisioningRequest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { callInIdentityId: "identity_1" },
        create: expect.objectContaining({
          organizationId: "org_1",
          workspaceId: "workspace_1",
          userId: "user_1",
          gmail: "patron@gmail.com",
          phoneE164: "+14055550123",
        }),
      }),
    );
  });

  it("hands off an existing Gmail account when caller ID does not match", async () => {
    const priorIdentity = {
      id: "identity_2",
      organizationId: "org_2",
      workspaceId: "workspace_2",
      userId: "user_2",
      mailboxId: null,
      phoneE164: "+14055559999",
    };
    // No enabled identity matches the new caller ID…
    prisma.callInIdentity.findFirst
      .mockResolvedValueOnce(null)
      // …but the Gmail owner has a prior voice identity to reuse.
      .mockResolvedValueOnce(priorIdentity);
    prisma.user.findUnique.mockResolvedValue({ id: "user_2" });
    prisma.provisioningRequest.findUnique.mockResolvedValue(null);
    prisma.mailbox.findFirst.mockResolvedValue(null);
    prisma.provisioningRequest.upsert.mockImplementation(
      async ({ create }: { create: Record<string, unknown> }) => ({
        id: "provision_2",
        ...create,
        provisionedReady: false,
      }),
    );

    const result = await provisionSignup({
      gmail: "returning@gmail.com",
      phoneE164: "+1 (405) 555-0000",
    });

    expect(result.created).toBe(false);
    expect(result.userId).toBe("user_2");
    expect(result.status).toBe("needs_google_test_user");
    expect(result.magicLink).toMatch(/\/api\/provision\/connect\?token=/);
    expect(prisma.provisioningRequest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { callInIdentityId: "identity_2" },
        create: expect.objectContaining({
          organizationId: "org_2",
          workspaceId: "workspace_2",
          userId: "user_2",
          gmail: "returning@gmail.com",
        }),
      }),
    );
  });

  it("still rejects a web-only Gmail account with no voice identity", async () => {
    // No enabled identity for the caller ID, and the Gmail owner never used voice.
    prisma.callInIdentity.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.user.findUnique.mockResolvedValue({ id: "user_web" });

    await expect(
      provisionSignup({
        gmail: "webonly@gmail.com",
        phoneE164: "+1 (405) 555-1212",
      }),
    ).rejects.toThrow("email_in_use");
    expect(prisma.provisioningRequest.upsert).not.toHaveBeenCalled();
  });
});
