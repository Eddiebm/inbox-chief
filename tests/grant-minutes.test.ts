import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = {
  user: { findFirst: vi.fn() },
  callInIdentity: { findFirst: vi.fn() },
  mailbox: { findFirst: vi.fn() },
  organization: { findUnique: vi.fn() },
  callMinutePackPurchase: { findUnique: vi.fn(), create: vi.fn() },
  callMinuteBalance: { findUnique: vi.fn(), upsert: vi.fn() },
  workspace: { findFirst: vi.fn() },
  $transaction: vi.fn(),
};

vi.mock("@/lib/db-node", () => ({
  getNodePrisma: () => prisma,
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { writeAuditLog } from "@/lib/audit";
import {
  grantOperatorMinutes,
  resolveOrgForGrant,
} from "@/lib/billing/grant-minutes";

describe("resolveOrgForGrant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://test";
  });

  it("resolves by patron email", async () => {
    prisma.user.findFirst.mockResolvedValue({
      email: "patron@example.com",
      memberships: [{ organizationId: "org_1" }],
    });
    prisma.organization.findUnique.mockResolvedValue({
      id: "org_1",
      name: "Patron Org",
      workspaces: [{ id: "ws_1" }],
    });

    const result = await resolveOrgForGrant({ email: "patron@example.com" });
    expect(result).toEqual({
      found: true,
      organizationId: "org_1",
      organizationName: "Patron Org",
      workspaceId: "ws_1",
      label: "patron@example.com",
    });
  });

  it("returns not found when no match", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.callInIdentity.findFirst.mockResolvedValue(null);
    prisma.mailbox.findFirst.mockResolvedValue(null);

    const result = await resolveOrgForGrant({ email: "missing@example.com" });
    expect(result).toEqual({ found: false, reason: "organization_not_found" });
  });
});

describe("grantOperatorMinutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://test";
  });

  it("credits balance and writes audit log", async () => {
    prisma.callMinutePackPurchase.findUnique.mockResolvedValue(null);
    prisma.callMinuteBalance.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (fn) =>
      fn({
        callMinuteBalance: {
          upsert: vi.fn().mockResolvedValue({
            id: "bal_1",
            purchasedMinutesRemaining: 120,
          }),
        },
        callMinutePackPurchase: {
          create: vi.fn().mockResolvedValue({ id: "purchase_1" }),
        },
      }),
    );
    prisma.workspace.findFirst.mockResolvedValue({ id: "ws_1" });

    const result = await grantOperatorMinutes({
      organizationId: "org_1",
      minutes: 120,
      grantedBy: "eddie@coareholdings.com",
      reason: "Founder comp",
    });

    expect(result).toMatchObject({
      granted: true,
      minutes: 120,
      purchasedMinutesBefore: 0,
      purchasedMinutesRemaining: 120,
      purchaseId: "purchase_1",
      idempotent: false,
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        workspaceId: "ws_1",
        action: "MANAGE_BILLING",
        resourceType: "CallMinutePackPurchase",
      }),
    );
  });

  it("is idempotent when idempotencyKey repeats", async () => {
    prisma.callMinutePackPurchase.findUnique.mockResolvedValue({
      id: "purchase_existing",
      minutesCredited: 120,
    });
    prisma.callMinuteBalance.findUnique.mockResolvedValue({
      purchasedMinutesRemaining: 120,
    });

    const result = await grantOperatorMinutes({
      organizationId: "org_1",
      minutes: 120,
      idempotencyKey: "courtney-aug-2026",
    });

    expect(result).toMatchObject({
      granted: true,
      idempotent: true,
      purchaseId: "purchase_existing",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});
